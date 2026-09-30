/**
 * buildComponent in isolation: what each kind of rejection costs, which session and checkout the
 * next launch gets, and what the worker is handed. Agents and Maven are scripted fakes.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { buildComponent, createSemaphore, previewFollowUp, scheduleOrder } from './fanout.mjs';
import { prepareCrops } from './inputs.mjs';
import { readTokenManifest } from './static-checks.mjs';
import { watchTree } from './workspaces.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-check-'));
const repoRoot = path.join(sandbox, 'repo');
const evidenceDir = path.join(sandbox, 'evidence');
const ids = ['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta'];
for (const id of ids) {
  fs.mkdirSync(path.join(repoRoot, 'ui.apps', 'components', id), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'ui.apps', 'components', id, 'placeholder.txt'), 'before');
}
fs.mkdirSync(path.join(repoRoot, 'ui.frontend', 'src', 'main', 'webpack', 'site'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'ui.frontend', 'src', 'main', 'webpack', 'site', '_tokens.scss'),
  ':root {\n  --space-m: 16px;\n  --color-ink: #111;\n}\n');

const discovery = {
  source: { final_url: 'https://example.com' },
  breakpoints: [1440],
  instances: ids.map((id, index) => ({ id: `i-${id}`, order: index, label: id, rect: { 1440: { x: 0, y: index * 10, w: 10, h: 10 } } })),
};
const instanceOrder = new Map(discovery.instances.map((instance) => [instance.id, instance.order]));
const components = ids.map((id) => ({
  id,
  tier: 4,
  role: 'content',
  instances: [`i-${id}`],
  resource_type: `demo/components/${id}`,
  owned_paths: [`ui.apps/components/${id}`],
  contribution: { kind: 'page-fragment', path: '/content/page/jcr:content/root/main' },
}));
const byId = new Map(components.map((component) => [component.id, component]));

// An inline SVG and a source crop, so the inputs a worker is handed can be checked from inside it.
const svgFile = path.join(evidenceDir, 'discovery', 'svg', 'abc.svg');
fs.mkdirSync(path.dirname(svgFile), { recursive: true });
fs.writeFileSync(svgFile, '<svg xmlns="http://www.w3.org/2000/svg"/>');
const cropFile = path.join(evidenceDir, 'crops', 'i-alpha-1440.png');
fs.mkdirSync(path.dirname(cropFile), { recursive: true });
fs.writeFileSync(cropFile, 'png');
const assets = {
  manifest: [{
    kind: 'inline-svg', source_url: 'inline-svg:sha256:abc', dam_path: '/content/dam/page/logo-abc12345.svg',
    local_file: svgFile, mime: 'image/svg+xml', instances: ['i-alpha'],
  }],
};

const launches = [];
const seenInside = {};
const cssFor = (id, text) => `.cmp-${id} { ${text} }`;

/** Scripted agent: what it writes depends on the component and on which launch of it this is. */
function behaviour({ id, cwd, prompt, resultPath, env }) {
  const count = launches.filter((entry) => entry.id === id).length;
  const own = (file) => path.join(cwd, 'ui.apps', 'components', id, file);
  let css = cssFor(id, 'padding: var(--space-m);');
  if (id === 'alpha') {
    const inputs = path.join(cwd, '.migration');
    const tokens = JSON.parse(fs.readFileSync(path.join(inputs, 'tokens.json'), 'utf8'));
    const assetList = JSON.parse(fs.readFileSync(path.join(inputs, 'assets.json'), 'utf8'));
    seenInside.alpha = {
      evidence: JSON.parse(fs.readFileSync(path.join(inputs, 'evidence.json'), 'utf8')).instances.map((entry) => entry.id),
      tokens: Object.keys(tokens.tokens),
      fonts: tokens.fonts,
      svg: fs.existsSync(path.join(inputs, 'svg', 'logo-abc12345.svg')),
      svgInTask: prompt.includes('logo-abc12345.svg') && assetList[0].local_file.startsWith(cwd),
      crop: fs.existsSync(path.join(inputs, 'source', 'i-alpha-1440.png')),
      git: fs.existsSync(path.join(cwd, '.git')),
      ceiling: env.GIT_CEILING_DIRECTORIES,
      absoluteResult: prompt.includes(JSON.stringify(resultPath).slice(1, -1)),
    };
  }
  if (id === 'gamma' && count === 1) {
    const stray = path.join(cwd, 'ui.apps', 'components', 'alpha', 'stolen.txt');
    fs.writeFileSync(stray, 'out of scope');
  }
  if (id === 'eps' && count === 1) css = cssFor(id, 'padding: var(--nope);');
  if (id === 'zeta' && count === 2) css = cssFor(id, 'padding: var(--space-m); margin: 0;');
  fs.mkdirSync(path.dirname(own('x')), { recursive: true });
  fs.writeFileSync(own(`${id}.css`), css);
  fs.writeFileSync(resultPath, JSON.stringify({
    role: 'component',
    component_id: id,
    status: 'PASS',
    checks: [
      { name: 'dialog_authorable', status: 'PASS' },
      { name: 'model_and_htl_complete', status: 'PASS' },
      { name: 'focused_test_declared', status: 'PASS' },
      { name: 'contributions_declared', status: 'PASS' },
    ],
    contributions: {
      clientlib_entries: [`${id}.css`],
      page_node: { name: id, instance: `i-${id}`, resource_type: `demo/components/${id}` },
    },
  }));
}

function spawnFn(executable, args, options) {
  const emitter = new EventEmitter();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  const id = options.env.MIGRATION_AGENT_ID;
  const resultPath = options.env.MIGRATION_RESULT_PATH;
  const prompt = fs.readFileSync(path.join(path.dirname(resultPath), 'prompt.md'), 'utf8');
  const sessionId = args[args.indexOf('--session-id') + 1];
  launches.push({ id, cwd: options.cwd, prompt, sessionId });
  setImmediate(() => {
    behaviour({ id, cwd: options.cwd, prompt, resultPath, env: options.env });
    emitter.stdout.end();
    emitter.stderr.end();
    emitter.emit('close', 0);
  });
  return emitter;
}

const execCalls = [];
function execFn(command, args, options) {
  const emitter = new EventEmitter();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  const cwd = String(options.cwd);
  execCalls.push({ cwd, args: args.join(' ') });
  const earlier = execCalls.filter((call) => call.cwd === cwd).length;
  let code = 0;
  let output = '';
  if (cwd.includes('beta-attempt-1') && earlier === 1) {
    code = 1;
    output = '[ERROR] /apps/demo/components/beta/beta.html: HTL syntax error at line 3\n';
  } else if (cwd.includes('delta-attempt')) {
    code = 1;
    output = 'The JAVA_HOME environment variable is not defined correctly,\nthis environment variable is needed to run this program.\n';
  }
  setImmediate(() => {
    emitter.stdout.write(output);
    emitter.stdout.end();
    emitter.stderr.end();
    emitter.emit('close', code);
  });
  return emitter;
}

const previewChecks = [];
const preview = {
  async check({ component, round }) {
    previewChecks.push({ id: component.id, round });
    if (component.id !== 'zeta') return { skipped: 'not this one' };
    return {
      status: 'FAIL',
      outDir: path.join(evidenceDir, 'preview', `zeta-${round}`),
      summary: { status: 'FAIL', min_ratio: 0.71, failed_breakpoints: [1440], owning_layer_hint: 'spacing' },
      parity: {
        threshold: 0.85,
        results: [{
          component_id: 'zeta', breakpoint: 1440, status: 'FAIL', visual_match_ratio: 0.71,
          deltas: { rect: { dh: 40 } }, side_by_side: 'evidence/zeta-sbs.png',
        }],
      },
    };
  },
};

const invocations = [];
const noop = new Proxy({}, { get: () => () => {} });
const context = (overrides = {}) => ({
  copilot: { executable: 'fake-copilot', version: 'fake' },
  options: { componentAttempts: 3, breakpoints: [1440], previewRounds: 1 },
  repoRoot,
  evidenceDir,
  discovery,
  byId,
  assets,
  renderer: noop,
  spawnFn,
  execFn,
  track: (invocation, extra) => invocations.push({ id: invocation.id, status: invocation.status, ...extra }),
  readPrompt: (name) => `# ${name}`,
  instanceOrder,
  guard: watchTree(repoRoot),
  claimed: new Map(),
  treeLock: createSemaphore(1),
  agentSlots: createSemaphore(2),
  validationSlots: createSemaphore(1),
  tokens: readTokenManifest(repoRoot),
  fonts: { families: ['Inter'] },
  crops: { 'i-alpha': { 1440: cropFile } },
  preview: null,
  mergedResults: () => [],
  agentOptions: { idleTimeoutMs: 60000 },
  ...overrides,
});
const of = (id) => launches.filter((entry) => entry.id === id);

// 1. A clean worker: everything it needs is inside its own checkout, and nothing else is.
const alpha = await buildComponent(context(), 'alpha', 0);
expect(alpha.status === 'PASS' && alpha.attempts === 1, `alpha should pass first time, got ${alpha.status}/${alpha.attempts}`);
expect(fs.readFileSync(path.join(repoRoot, 'ui.apps/components/alpha/alpha.css'), 'utf8').includes('--space-m'), 'alpha must be merged');
expect(JSON.stringify(seenInside.alpha?.evidence) === '["i-alpha"]', `the evidence slice must hold only the worker's instances, got ${JSON.stringify(seenInside.alpha?.evidence)}`);
expect(seenInside.alpha?.tokens.includes('--space-m') && seenInside.alpha?.fonts.includes('Inter'), 'tokens.json must name the tokens and fonts');
expect(seenInside.alpha?.svg && seenInside.alpha?.svgInTask, 'an inline SVG must be copied into the workspace and named in the task');
expect(seenInside.alpha?.crop, 'the source crop must be in the workspace');
expect(seenInside.alpha?.git, 'the workspace must be its own git repository');
expect(seenInside.alpha?.ceiling === path.join(evidenceDir, 'workspaces'), `git must stop at the workspace, got ${seenInside.alpha?.ceiling}`);
expect(seenInside.alpha?.absoluteResult, 'the task must give the result path absolutely');
expect(!fs.existsSync(path.join(repoRoot, '.migration')) && !fs.existsSync(path.join(evidenceDir, 'workspaces', 'alpha-attempt-1')),
  'inputs must never reach the repository and the checkout must be removed');

// 2. A build error is the worker's to fix, in the session and checkout that still hold its work.
const beta = await buildComponent(context(), 'beta', 0);
const [betaFirst, betaSecond] = of('beta');
expect(beta.status === 'PASS' && beta.attempts === 2, `beta should pass on its second attempt, got ${beta.status}/${beta.attempts}`);
expect(betaSecond && betaFirst.sessionId === betaSecond.sessionId, 'a build rejection must continue the same session');
expect(betaSecond && betaFirst.cwd === betaSecond.cwd, 'a build rejection must keep the same checkout');
expect(betaSecond?.prompt.includes('Your workspace still holds everything you wrote') && betaSecond.prompt.includes('HTL syntax error'),
  'the follow-up must carry the build error and say the work is still there');
expect(beta.history[1]?.resumed === true, 'the resumed attempt must be recorded as such');

// 3. Writing outside scope starts over: a new checkout and a new session.
const gamma = await buildComponent(context(), 'gamma', 0);
const [gammaFirst, gammaSecond] = of('gamma');
expect(gamma.status === 'PASS' && gamma.attempts === 2, `gamma should pass on its second attempt, got ${gamma.status}/${gamma.attempts}`);
expect(gammaSecond && gammaFirst.sessionId !== gammaSecond.sessionId, 'a scope violation must start a new session');
expect(gammaSecond?.cwd.endsWith('gamma-attempt-2'), `a scope violation must get a fresh checkout, got ${gammaSecond?.cwd}`);
expect(gammaSecond?.prompt.includes('## Attempt 1 of 3 was rejected') && gammaSecond.prompt.includes('outside your scope'),
  'the fresh attempt must be told why the last one was rejected');
expect(!fs.existsSync(path.join(repoRoot, 'ui.apps/components/alpha/stolen.txt')), 'an out-of-scope write must never be merged');

// 4. A broken machine is not the worker's fault: no retry, no attempt spent, and it says so.
const delta = await buildComponent(context(), 'delta', 0);
expect(delta.status === 'BLOCKED' && delta.environment === true, `delta should be BLOCKED by the environment, got ${delta.status}`);
expect(of('delta').length === 1, `an environment failure must not relaunch the worker, got ${of('delta').length}`);
expect(/environment: .*JAVA_HOME/.test(delta.error), `the error must name the environment fault, got ${delta.error}`);

// 5. An undeclared token is caught before Maven runs, and fixed in the same session.
const eps = await buildComponent(context(), 'eps', 0);
const [epsFirst, epsSecond] = of('eps');
expect(eps.status === 'PASS' && eps.attempts === 2, `eps should pass on its second attempt, got ${eps.status}/${eps.attempts}`);
expect(epsSecond?.prompt.includes('--nope') && epsFirst.sessionId === epsSecond.sessionId,
  'the static rejection must name the undeclared property and continue the session');
expect(execCalls.filter((call) => call.cwd === epsFirst.cwd).length === 1,
  'Maven must run only once for eps: never for the change the static check rejected');

// 6. A merged component that measures badly is handed its deltas in its own session.
const zeta = await buildComponent(context({ preview }), 'zeta', 0);
const [zetaFirst, zetaSecond] = of('zeta');
expect(zeta.status === 'PASS' && zeta.previews?.[0]?.status === 'FAIL', `zeta should pass with one failed preview, got ${JSON.stringify(zeta.previews)}`);
expect(zetaSecond?.sessionId === zetaFirst.sessionId && zetaSecond.prompt.includes('## Preview measurement 1'),
  'the preview deltas must go back to the same session');
expect(zetaSecond?.prompt.includes('"min_ratio": 0.71')
  && zetaSecond.prompt.includes(JSON.stringify(path.join(evidenceDir, 'preview', 'zeta-1')).slice(1, -1)),
'the follow-up must carry the measured ratio and absolute evidence paths');
expect(fs.readFileSync(path.join(repoRoot, 'ui.apps/components/zeta/zeta.css'), 'utf8').includes('margin: 0'),
  'the fix made after the preview must be merged');
expect(previewChecks.filter((entry) => entry.id === 'zeta').length === 1, 'one preview round means one measurement');

// Follow-up text on its own: relative evidence paths become absolute.
const text = previewFollowUp({
  outDir: '/tmp/p', parity: { threshold: 0.85, results: [{ component_id: 'x', side_by_side: 'evidence/a.png', deltas: {} }] }, summary: {},
}, { id: 'x' }, '/r/result.json', 2);
expect(text.includes('## Preview measurement 2') && text.includes(JSON.stringify(path.resolve('/tmp/p', 'evidence/a.png')).slice(1, -1)),
  'previewFollowUp must resolve evidence against the preview directory');

// Scheduling: long, new work first; a quick reuse last; ties stable by id.
const order = scheduleOrder(['reuse', 'chrome', 'content-b', 'content-a'], new Map([
  ['reuse', { tier: 1, instances: ['1'] }],
  ['chrome', { tier: 4, role: 'chrome', instances: ['1', '2'] }],
  ['content-a', { tier: 4, instances: ['1'] }],
  ['content-b', { tier: 4, instances: ['1'] }],
]));
expect(order.join(',') === 'chrome,content-a,content-b,reuse', `longest first, got ${order.join(',')}`);

const gate = createSemaphore(2);
let active = 0;
let peak = 0;
await Promise.all([1, 2, 3, 4, 5].map(async () => {
  const release = await gate.acquire();
  active += 1;
  peak = Math.max(peak, active);
  await new Promise((resolve) => setTimeout(resolve, 5));
  active -= 1;
  release();
  release();
}));
expect(peak === 2, `the semaphore must cap concurrency at 2, got ${peak}`);

// Source crops: CSS-pixel rects cut from a device-pixel screenshot, clamped to the image.
const { cropPng, readPng } = await import('../tools/lib/png-crop.mjs');
const shotDir = path.join(sandbox, 'shots');
fs.mkdirSync(shotDir, { recursive: true });
fs.writeFileSync(path.join(shotDir, 'full-1440.png'),
  cropPng({ width: 200, height: 600, data: Buffer.alloc(200 * 600 * 4, 255) }, { x: 0, y: 0, w: 200, h: 600 }));
const crops = await prepareCrops({
  discovery: {
    dpr: 2,
    breakpoints: [1440],
    screenshots: { 1440: 'full-1440.png' },
    instances: [
      { id: 'i-top', rect: { 1440: { x: 0, y: 0, w: 50, h: 40 } } },
      { id: 'i-edge', rect: { 1440: { x: 80, y: 280, w: 50, h: 40 } } },
      { id: 'i-off', rect: { 1440: { x: 0, y: 900, w: 50, h: 40 } } },
    ],
  },
  discoveryDir: shotDir,
  outDir: path.join(sandbox, 'crops-out'),
  renderer: noop,
});
const size = (file) => { const image = readPng(file); return `${image.width}x${image.height}`; };
expect(crops['i-top'] && size(crops['i-top'][1440]) === '100x80', `a crop must be scaled by dpr, got ${crops['i-top'] && size(crops['i-top'][1440])}`);
expect(crops['i-edge'] && size(crops['i-edge'][1440]) === '40x40', `a crop must be clamped to the image, got ${crops['i-edge'] && size(crops['i-edge'][1440])}`);
expect(!crops['i-off'], 'a rect below the image must produce no crop');

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('fan-out worker assertions: all passed');
}
