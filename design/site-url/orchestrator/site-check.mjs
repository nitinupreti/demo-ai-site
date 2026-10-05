/**
 * End-to-end check of site mode. The crawl, capture and extract tools, Maven and AEM are all fakes,
 * so the phase graph, the review gate, page writing, the filter root, resume and verification are
 * exercised without a browser, a build or an instance.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { createRenderer } from './console.mjs';
import { CONTENT_FILTER, CONTENT_ROOT } from './pages.mjs';
import { PAGE_TREE_PHASES, orchestrateSite } from './site.mjs';
import { checkSiteBuild } from './site-build-check.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'site-check-'));
const repoRoot = path.join(sandbox, 'repo');
const write = (relativePath, text) => {
  const file = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};
const NS = 'xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"';
const TEMPLATE = '/conf/demo/settings/wcm/templates/page';
const SITE = '/content/demo/site';
const SOURCE = 'https://www.example.test';

write(`${CONTENT_ROOT}/content/demo/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page">
    <jcr:content cq:template="${TEMPLATE}" jcr:primaryType="cq:PageContent" sling:resourceType="demo/components/page"/>
</jcr:root>
`);
const templateBody = (editable) => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page">
    <jcr:content cq:template="${TEMPLATE}" jcr:primaryType="cq:PageContent" sling:resourceType="demo/components/page">
        <root jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid"${editable}/>
    </jcr:content>
</jcr:root>
`;
write(`${CONTENT_ROOT}${TEMPLATE}/structure/.content.xml`, templateBody(' editable="{Boolean}true"'));
write(`${CONTENT_ROOT}${TEMPLATE}/initial/.content.xml`, templateBody(''));
write(CONTENT_FILTER, `<?xml version="1.0" encoding="UTF-8"?>
<workspaceFilter version="1.0">
    <filter root="/content/demo" mode="merge"/>
</workspaceFilter>
`);

const PAGES = [
  { id: 'p-001', pathname: '/', title: 'Home | Example' },
  { id: 'p-002', pathname: '/about/', title: 'About | Example' },
  { id: 'p-003', pathname: '/about/team/', title: 'Team | Example' },
];
const url = (pathname) => `${SOURCE}${pathname}`;
const inventory = {
  schema_version: 1,
  seed: { requested_url: SOURCE, final_url: url('/'), http_status: 200 },
  scope: {
    hosts: ['www.example.test', 'example.test'], canonical_origin: SOURCE, seed_path_prefix: '', max_pages: 50, max_depth: 5, keep_query: false,
    include: [], exclude: [], include_hosts: [],
  },
  pages: PAGES.map((entry, index) => ({
    id: entry.id,
    url: url(entry.pathname),
    key: url(entry.pathname.replace(/\/$/, '') || '/'),
    http_status: 200,
    depth: entry.pathname.split('/').filter(Boolean).length,
    sources: index ? ['link'] : ['seed'],
    sitemap_index: null,
    title: entry.title,
    lang: 'en',
  })),
  aliases: [{ url: url('/home'), key: url('/home'), alias_of: 'p-001', reason: 'redirect' }],
  excluded: [],
  external_links: [{ host: 'social.example', links: 1, pages: 1 }],
  documents: [],
  link_order: [url('/about')],
  coverage: { pages_from_sitemap: 0, pages_from_links: 3, sitemap_only: [], links_only: [] },
  fingerprint: 'sha256:inventory',
  status: 'PASS',
  failures: [],
};

const toolCalls = [];
const failingCaptures = new Set([url('/about/team/')]);
const argument = (args, flag) => args[args.indexOf(flag) + 1];
const runTool = async (name, args) => {
  toolCalls.push({ name, url: argument(args, '--url') });
  if (name === 'crawl') {
    writeJson(path.join(argument(args, '--out'), 'inventory.json'), inventory);
    return { name, code: 0 };
  }
  if (name === 'discover') {
    const source = argument(args, '--url');
    const failing = failingCaptures.has(source);
    writeJson(path.join(argument(args, '--out'), 'discovery.json'), {
      schema_version: 1,
      source: { requested_url: source, final_url: source },
      source_fingerprint: `sha256:${source}`,
      breakpoints: [1440],
      instances: [{ id: 'inst-001', label: 'hero', selector: { 1440: { css: 'section.hero', match_index: 0 } } }],
      status: failing ? 'FAIL' : 'PASS',
      failures: failing ? ['coverage 1440px: unclaimed gap of 64px'] : [],
    });
    return { name, code: failing ? 1 : 0 };
  }
  const discovery = readJson(argument(args, '--discovery'));
  writeJson(path.join(argument(args, '--out'), 'content.json'), {
    schema_version: 1,
    source: { url: discovery.source.final_url, source_fingerprint: discovery.source_fingerprint },
    instances: [{
      id: 'inst-001', found: true, breakpoint: 1440, items: [{ type: 'heading', level: 1, text: 'Hello' }], links: [], html: '<section></section>',
    }],
    status: 'PASS',
    failures: [],
  });
  return { name, code: 0 };
};

const execCalls = [];
const execFn = (command, args) => {
  execCalls.push(`${command} ${args.join(' ')}`);
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  setImmediate(() => {
    child.stdout.end();
    child.stderr.end();
    child.emit('close', 0);
  });
  return child;
};

const titles = new Map(PAGES.map((entry) => [`${SITE}${entry.pathname.replace(/\/$/, '')}.html`, entry.title]));
const fetchFn = async (address) => {
  const { pathname } = new URL(address);
  if (pathname.startsWith('/system/console/bundles')) {
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 1, symbolicName: 'demo.core', version: '1', state: 'Active' }] }) };
  }
  const title = titles.get(pathname);
  return { status: title ? 200 : 404, text: async () => `<html><head><title>${title || ''}</title></head></html>` };
};

const options = {
  siteUrl: SOURCE,
  targetPath: SITE,
  aemHost: 'localhost',
  aemPort: 4502,
  aemUser: 'admin',
  breakpoints: [1440],
  settleMs: 0,
  maxPages: 50,
  maxDepth: 5,
  crawlDelayMs: 0,
  include: [],
  exclude: [],
  includeHosts: [],
  pagesOnly: true,
};
const lines = [];
const services = (overrides = {}) => ({
  renderer: createRenderer({ stageIds: PAGE_TREE_PHASES }),
  runId: 'site-check',
  evidenceDir: path.join(sandbox, 'evidence'),
  runTool,
  repoRoot,
  print: (line) => lines.push(line),
  execFn,
  fetchFn,
  ...overrides,
});
const pageFile = (jcrPath) => path.join(repoRoot, CONTENT_ROOT, ...jcrPath.split('/').filter(Boolean), '.content.xml');
const phaseStatus = (outcome) => outcome.phases.map((phase) => `${phase.name}:${phase.status}`).join(' ');

// --crawl-only stops before anything is asked or written.
let outcome = await orchestrateSite({ ...options, crawlOnly: true }, services());
expect(outcome.status === 'PASS' && outcome.stopped === 'crawl' && outcome.phases.length === 1,
  `--crawl-only must stop after the crawl, got ${phaseStatus(outcome)}`);
expect(!fs.existsSync(pageFile(SITE)), '--crawl-only must write no page');

// Declining at the prompt writes nothing, and so does a run with no terminal and no --yes.
outcome = await orchestrateSite(options, services({ confirm: async () => false }));
expect(outcome.status === 'BLOCKED' && outcome.phases.at(-1).name === 'review', `declining must stop at review, got ${phaseStatus(outcome)}`);
outcome = await orchestrateSite(options, services());
expect(outcome.status === 'BLOCKED', `no terminal and no --yes must stop at review, got ${phaseStatus(outcome)}`);
expect(!fs.existsSync(pageFile(SITE)) && !fs.readFileSync(path.join(repoRoot, CONTENT_FILTER), 'utf8').includes(SITE),
  'nothing may be written before the tree is approved');
expect(!toolCalls.some((call) => call.name === 'discover'), 'nothing may be captured before the tree is approved');

// Approved: every page is captured, written, deployed and checked; one capture fails and is reported.
const questions = [];
toolCalls.length = 0;
outcome = await orchestrateSite(options, services({ confirm: async (question) => { questions.push(question); return true; } }));
expect(questions.length === 1 && questions[0].includes(`${PAGES.length} page(s) under ${SITE}`), `the prompt must say what will be created, got ${questions[0]}`);
expect(phaseStatus(outcome) === 'crawl:PASS review:PASS capture:FAIL pages:PASS deploy:PASS verify:PASS',
  `a failed capture must not stop the pages, got ${phaseStatus(outcome)}`);
expect(outcome.status === 'FAIL', 'a run with a page still to capture is not a pass');
expect(toolCalls.filter((call) => call.name === 'discover').length === PAGES.length
  && toolCalls.filter((call) => call.name === 'extract').length === PAGES.length, 'every page must be captured and extracted');
expect(PAGES.every((entry) => fs.existsSync(pageFile(`${SITE}${entry.pathname.replace(/\/$/, '')}`))), 'every page must be written');
const filter = fs.readFileSync(path.join(repoRoot, CONTENT_FILTER), 'utf8');
expect(filter.indexOf(`<filter root="${SITE}"/>`) >= 0 && filter.indexOf(`<filter root="${SITE}"/>`) < filter.indexOf('<filter root="/content/demo" mode="merge"/>'),
  'the site root must get its own replace-mode filter, ahead of the merge root that covers it');
expect(execCalls.some((call) => call.includes('-pl ui.content') && call.includes('filevault-package:validate-files')),
  'the written pages must be validated before the deploy');
expect(execCalls.some((call) => call.includes('-PautoInstallSinglePackage') && call.includes('-Daem.port=4502')), 'the deploy must run');
const evidence = (name) => readJson(path.join(sandbox, 'evidence', name));
expect(evidence('verify.json').checked === PAGES.length && evidence('verify.json').failed === 0, 'every page must be checked in AEM');
expect(evidence('link-map.json').some((entry) => entry.source_url === url('/home') && entry.aem_path === SITE), 'aliases must be in the link map');
expect(evidence('pages.json').content_container === 'root', `the content container must be recorded, got ${evidence('pages.json').content_container}`);
expect(evidence('capture.json').find((entry) => entry.url === url('/about/team/'))?.status === 'FAIL', 'the failed capture must be recorded');
expect(lines.some((line) => line.includes('--resume site-check')), 'the run must say how to retry the missing capture');

// Resumed after the cause is fixed: the crawl and approval are reused, and only the failed page is captured again.
failingCaptures.clear();
toolCalls.length = 0;
let asked = false;
outcome = await orchestrateSite(options, services({ resumed: true, confirm: async () => { asked = true; return true; } }));
expect(outcome.status === 'PASS', `the resumed run must pass, got ${phaseStatus(outcome)}`);
expect(!toolCalls.some((call) => call.name === 'crawl'), 'an unchanged crawl must be reused on resume');
expect(!asked, 'an approved tree must not be asked about again');
expect(toolCalls.filter((call) => call.name === 'discover').map((call) => call.url).join() === url('/about/team/'),
  `only the failed page may be captured again, got ${toolCalls.filter((call) => call.name === 'discover').map((call) => call.url).join()}`);

// A resume that asks a different question crawls again.
toolCalls.length = 0;
outcome = await orchestrateSite({ ...options, maxPages: 10, yes: true }, services({ resumed: true }));
expect(toolCalls.some((call) => call.name === 'crawl'), 'a resume with different crawl settings must crawl again');

// A page AEM does not serve fails the run.
titles.delete(`${SITE}/about.html`);
outcome = await orchestrateSite({ ...options, yes: true }, services({ resumed: true }));
expect(outcome.status === 'FAIL' && outcome.phases.at(-1).name === 'verify' && outcome.phases.at(-1).status === 'FAIL',
  `a page AEM does not serve must fail verification, got ${phaseStatus(outcome)}`);

fs.rmSync(sandbox, { recursive: true, force: true });

failures.push(...await checkSiteBuild());

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nsite mode end-to-end assertions: all passed');
}
