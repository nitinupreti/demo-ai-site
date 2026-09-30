/**
 * Early previews and the deploy helpers they rest on: the content package Package Manager is given,
 * the upload itself, the serialized preview flow with its fakes, environment classification,
 * scoped redeploys, the preflight, and the choice of pages for the regression capture.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import {
  checkEnvironment, classifyFailure, planScopedDeployment, runValidation,
} from './deploy.mjs';
import {
  buildContentPackage, crc32, createPreview, createZip, installPackage,
} from './preview.mjs';
import { regressionPages } from './run.mjs';
import { createSemaphore } from './fanout.mjs';
import { watchTree } from './workspaces.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

/** Reads a stored zip back: name → bytes, verifying every CRC on the way. */
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`bad central header at ${offset}`);
    const crc = buffer.readUInt32LE(offset + 16);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localName = buffer.readUInt16LE(local + 26);
    const data = buffer.subarray(local + 30 + localName, local + 30 + localName + size);
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    entries.set(name, data);
    offset += 46 + nameLength;
  }
  return entries;
}

const fakeProcess = (code, output = '') => {
  const emitter = new EventEmitter();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  setImmediate(() => {
    emitter.stdout.write(output);
    emitter.stdout.end();
    emitter.stderr.end();
    emitter.emit('close', code);
  });
  return emitter;
};

// CRC-32 of "123456789" is the standard check value.
expect(crc32(Buffer.from('123456789')) === 0xCBF43926, `crc32 check value, got ${crc32(Buffer.from('123456789')).toString(16)}`);

const zip = readZip(createZip([{ name: 'a/b.txt', data: 'hello' }, { name: 'c\\d.bin', data: Buffer.from([0, 1, 2]) }]));
expect(zip.get('a/b.txt')?.toString() === 'hello' && zip.get('c/d.bin')?.length === 3,
  `a stored zip must read back byte for byte, got ${[...zip.keys()].join(', ')}`);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-check-'));
const repoRoot = path.join(sandbox, 'repo');
const contentRoot = 'ui.content/src/main/content/jcr_root';
const write = (relative, text) => {
  const absolute = path.join(repoRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text, 'utf8');
};
const pageXml = (extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content jcr:primaryType="cq:PageContent" jcr:title="Fixture">
        <root jcr:primaryType="nt:unstructured">
            <main jcr:primaryType="nt:unstructured"/>${extra}
        </root>
    </jcr:content>
</jcr:root>
`;
write(`${contentRoot}/content/page/.content.xml`, pageXml());
write(`${contentRoot}/content/site/en/other/.content.xml`, pageXml('\n            <x sling:resourceType="demo/components/alpha"/>'));
write(`${contentRoot}/content/site/en/.content.xml`, pageXml());
write(`${contentRoot}/content/site/en/other/_jcr_content/image/.content.xml`, '<jcr:root jcr:primaryType="nt:unstructured"/>');
write(`${contentRoot}/content/experience-fragments/site/header/master/.content.xml`, pageXml());
write(`${contentRoot}/content/page/child/.content.xml`, pageXml());
write('ui.apps/src/main/content/jcr_root/apps/demo/components/alpha/alpha.html', '<div class="cmp-alpha"></div>');
write('ui.apps/src/main/content/jcr_root/apps/demo/clientlibs/clientlib-site/css/site.css', '/* built */');
write('pom.xml', '<project><modules><module>ui.apps</module><module>ui.content</module></modules></project>');

// The package holds exactly the composed documents, each its own replace root.
const built = buildContentPackage({
  root: repoRoot,
  files: [`${contentRoot}/content/page/.content.xml`, 'ui.apps/src/main/content/jcr_root/apps/demo/components/alpha/alpha.html'],
  name: 'preview',
  version: '3',
});
const packaged = readZip(built.zip);
const filter = packaged.get('META-INF/vault/filter.xml')?.toString() || '';
expect(JSON.stringify(built.roots) === '["/content/page"]', `only content documents become roots, got ${JSON.stringify(built.roots)}`);
expect(filter.includes('<filter root="/content/page"/>') && !filter.includes('mode='), `the root must replace, got ${filter}`);
expect(packaged.has('jcr_root/content/page/.content.xml') && packaged.get('META-INF/vault/properties.xml')?.toString().includes('>3<'),
  'the page and a versioned properties.xml must be in the package');
expect(buildContentPackage({ root: repoRoot, files: ['ui.apps/x.html'], name: 'p', version: '1' }) === null,
  'nothing to install must produce no package');

// The upload: multipart POST with basic auth, success read from the service's own status element.
let request = null;
const installed = await installPackage({
  aemUrl: 'http://localhost:4506',
  username: 'admin',
  password: 'secret',
  zip: built.zip,
  name: 'preview',
  fetchFn: async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, text: async () => '<crx><response><status code="200">ok</status></response></crx>' };
  },
});
expect(installed.ok, `a 200 status element must count as installed, got ${JSON.stringify(installed)}`);
expect(request.url === 'http://localhost:4506/crx/packmgr/service.jsp' && request.init.method === 'POST',
  `the package must be POSTed to the package service, got ${request?.url}`);
expect(request.init.headers.authorization === `Basic ${Buffer.from('admin:secret').toString('base64')}`, 'basic auth must be sent');
expect(request.init.body.get('install') === 'true' && request.init.body.get('force') === 'true' && request.init.body.get('file'),
  'the form must upload the file and ask for install');
const refused = await installPackage({
  aemUrl: 'http://x', username: 'a', password: 'b', zip: built.zip, name: 'p',
  fetchFn: async () => ({ ok: true, status: 200, text: async () => '<status code="500">Error</status>' }),
});
expect(!refused.ok && refused.detail.includes('500'), 'a failing status element must not count as installed');
const unreachable = await installPackage({
  aemUrl: 'http://x', username: 'a', password: 'b', zip: built.zip, name: 'p',
  fetchFn: async () => { throw new Error('ECONNREFUSED'); },
});
expect(!unreachable.ok && unreachable.status === null, 'a network failure must not throw');

// The preview flow, end to end over fakes.
const evidenceDir = path.join(sandbox, 'evidence');
const plan = {
  shared: { page_path: '/content/page', compose_targets: {} },
  components: [{
    id: 'alpha',
    tier: 4,
    role: 'content',
    instances: ['i-1'],
    owned_paths: ['ui.apps/src/main/content/jcr_root/apps/demo/components/alpha'],
    resource_type: 'demo/components/alpha',
    contribution: { kind: 'page-fragment', path: '/content/page/jcr:content/root/main' },
    parity_targets: [{ instance: 'i-1', source: { css: '.a' }, target: { css: '.cmp-alpha' } }],
  }],
};
const discovery = { source: { final_url: 'https://example.com' }, instances: [{ id: 'i-1', order: 0 }] };
const results = [{
  role: 'component',
  component_id: 'alpha',
  status: 'PASS',
  contributions: { page_node: { name: 'alpha', instance: 'i-1', resource_type: 'demo/components/alpha', properties: {} } },
}];
const execCalls = [];
let firstDeployCode = 0;
const execFn = (command, args, options) => {
  execCalls.push({ cwd: String(options.cwd), args: args.join(' ') });
  if (args.includes('-PautoInstallSinglePackage')) {
    // The frontend build rewrites its own output in the tree.
    write('ui.apps/src/main/content/jcr_root/apps/demo/clientlibs/clientlib-site/css/site.css', `/* rebuilt ${execCalls.length} */`);
    return fakeProcess(firstDeployCode);
  }
  return fakeProcess(0);
};
const uploads = [];
const fetchFn = async (url, init) => {
  uploads.push(init.body.get('file'));
  return { ok: true, status: 200, text: async () => '<status code="200">ok</status>' };
};
const parityRuns = [];
const runTool = async (name, args) => {
  const out = args[args.indexOf('--out') + 1];
  const config = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
  parityRuns.push({ name, config });
  fs.writeFileSync(path.join(out, 'parity.json'), JSON.stringify({
    preflight: {},
    components: [{ component_id: 'alpha', status: parityRuns.length === 1 ? 'FAIL' : 'PASS', min_ratio: 0.8 }],
    results: [],
  }));
  return { code: 0 };
};
const notes = [];
const renderer = { note: (text) => notes.push(text), warn: (text) => notes.push(`warn ${text}`) };
const guard = watchTree(repoRoot);
let baselines = 0;
const options = {
  aemHost: 'localhost', aemPort: 4506, targetPath: '/content/page', breakpoints: [1440], threshold: 0.85, aemUser: 'admin',
};
const preview = createPreview({
  repoRoot,
  evidenceDir,
  plan,
  discovery,
  options,
  execFn,
  fetchFn,
  runTool,
  renderer,
  treeLock: createSemaphore(1),
  instanceOrder: new Map([['i-1', 0]]),
  workspaceOptions: {},
  toolsDir: path.join(sandbox, 'tools'),
  guard,
  beforeFirstDeploy: async () => { baselines += 1; },
});
const [one, two] = await Promise.all([
  preview.check({ component: plan.components[0], results, round: 1 }),
  preview.check({ component: plan.components[0], results, round: 2 }),
]);
expect(one.status === 'FAIL' && two.status === 'PASS', `two checks must both be measured, in order, got ${one.status}/${two.status}`);
expect(baselines === 1, `the regression baseline must be taken once, before the first deploy, got ${baselines}`);
const fullDeploys = execCalls.filter((call) => call.args.includes('-PautoInstallSinglePackage'));
const previewBuilds = execCalls.filter((call) => call.args.includes('-pl core,ui.apps'));
expect(fullDeploys.length === 1 && fullDeploys[0].cwd === repoRoot, `one full deploy from the tree, got ${fullDeploys.length}`);
expect(previewBuilds.length === 2 && previewBuilds.every((call) => call.cwd.endsWith(path.join('workspaces', '_preview'))),
  'each preview must build core and ui.apps in the preview copy, not the tree');
expect(uploads.length === 2, `each preview must install its composed content, got ${uploads.length}`);
const composed = fs.readFileSync(path.join(evidenceDir, 'workspaces', '_preview', contentRoot, 'content/page/.content.xml'), 'utf8');
expect(composed.includes('<alpha') && !fs.readFileSync(path.join(repoRoot, contentRoot, 'content/page/.content.xml'), 'utf8').includes('<alpha'),
  'composition must happen in the preview copy only');
expect(parityRuns[0].config.composite === false && parityRuns[0].config.components.every((entry) => entry.id === 'alpha')
  && parityRuns[0].config.targets[0].url === 'http://localhost:4506/content/page.html?wcmmode=disabled',
'a preview scores only its component, against the deployed page, without the page composite');
expect(guard.drift().length === 0, `rebuilt clientlib output must not read as an edit, got ${guard.drift().join(', ')}`);
write('ui.apps/src/main/content/jcr_root/apps/demo/components/alpha/alpha.html', '<div>edited</div>');
expect(guard.drift().includes('ui.apps/src/main/content/jcr_root/apps/demo/components/alpha/alpha.html'),
  'a real edit must still be seen');

// A first deploy that fails turns previews off for the rest of the run, without touching anything else.
firstDeployCode = 1;
execCalls.length = 0;
const offline = createPreview({
  repoRoot, evidenceDir: path.join(sandbox, 'evidence-2'), plan, discovery, options, execFn, fetchFn, runTool, renderer,
  treeLock: createSemaphore(1), instanceOrder: new Map([['i-1', 0]]), workspaceOptions: {}, toolsDir: sandbox,
});
const skipped = await offline.check({ component: plan.components[0], results, round: 1 });
const again = await offline.check({ component: plan.components[0], results, round: 2 });
expect(skipped.skipped && again.skipped && offline.disabled, 'a failed first deploy must disable previews');
expect(execCalls.length === 1, `nothing may run after previews are disabled, got ${execCalls.length} command(s)`);

// Environment classification: the machine, not the code.
expect(classifyFailure('The JAVA_HOME environment variable is not defined correctly') === 'environment', 'JAVA_HOME');
expect(classifyFailure("'mvn' is not recognized as an internal or external command") === 'environment', 'missing mvn');
expect(classifyFailure('Could not transfer artifact com.adobe:x:1 from/to central') === 'environment', 'offline repository');
expect(classifyFailure('[ERROR] HTL: unknown option in expression') === 'code', 'an HTL error is code');
const validation = await runValidation({
  workspaceRoot: sandbox,
  steps: [{ label: 'HTL syntax', command: 'mvn', args: ['x'] }],
  execFn: () => fakeProcess(1, 'Error: JAVA_HOME should point to a JDK not a JRE\n'),
});
expect(validation.kind === 'environment', `runValidation must classify, got ${validation.kind}`);

// Scoped redeploys: touched modules plus all; anything unknown falls back to the full build.
const scoped = planScopedDeployment(4506, ['ui.frontend/src/main/webpack/site/_tokens.scss', 'ui.apps/src/x.html']);
expect(scoped[0].args.join(' ').includes('-pl ui.frontend,ui.apps,all') && scoped[0].args.includes('-PautoInstallSinglePackage'),
  `frontend changes rebuild ui.frontend and ui.apps, got ${scoped[0].args.join(' ')}`);
expect(planScopedDeployment(4506, ['core/src/A.java'])[0].args.join(' ').includes('-pl core,all'), 'core alone');
expect(!planScopedDeployment(4506, ['dispatcher/src/x.any'])[0].args.includes('-pl'), 'an unknown module falls back to the full build');
expect(!planScopedDeployment(4506, [])[0].args.includes('-pl'), 'no files falls back to the full build');

// Preflight: Maven must run; an unreachable instance only warns.
const healthy = await checkEnvironment({
  repoRoot: sandbox,
  execFn: () => fakeProcess(0, 'Apache Maven 3.9.9\n'),
  fetchFn: async () => ({ status: 200 }),
  aemUrl: 'http://localhost:4506',
});
expect(healthy.status === 'PASS' && healthy.aem_reachable && healthy.maven === 'Apache Maven 3.9.9', `healthy preflight, got ${JSON.stringify(healthy)}`);
const noMaven = await checkEnvironment({
  repoRoot: sandbox,
  execFn: () => fakeProcess(1, "'mvn' is not recognized as an internal or external command\n"),
  fetchFn: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); },
  aemUrl: 'http://localhost:4506',
});
expect(noMaven.status === 'FAIL' && /Maven cannot run/.test(noMaven.problems[0]), 'a missing Maven must fail the preflight');
expect(!noMaven.aem_reachable && noMaven.warnings.some((warning) => warning.includes('ECONNREFUSED')), 'an unreachable AEM only warns');

// Regression pages: other pages, never the target or its children, fragments or page nodes.
const pages = regressionPages(repoRoot, plan, '/content/page');
expect(JSON.stringify(pages) === JSON.stringify(['/content/site/en/other', '/content/site/en']),
  `pages using the plan's types first, then deeper pages, got ${JSON.stringify(pages)}`);
expect(regressionPages(repoRoot, plan, '/content/page', 1).length === 1, 'the page count is capped');

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('preview and deploy assertions: all passed');
}
