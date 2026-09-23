/**
 * End-to-end orchestrator check. Agents, the discovery tool, the parity tool and Maven are all
 * replaced by deterministic fakes, so the phase graph, fan-out, isolation, composition, routing
 * and the bounded ledger are exercised without a single model call.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import {
  AGENT_ROLES, DEFAULTS, agentTuning, describeModel, orchestrate, parseArgs, preferredModelIndex,
  readCheckpoint, selectTuning, thresholdForEffort,
} from './run.mjs';
import { createRenderer } from './console.mjs';
import { describeBrokenBundles, verifyBundles } from './deploy.mjs';

const PHASES_FOR_CHECK = ['discover', 'plan', 'foundations', 'assets', 'fanout', 'compose', 'deploy', 'parity', 'remediation', 'report'];

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// Out of the box, without any flag, a component gets four attempts.
expect(DEFAULTS.componentAttempts === 4, `default component attempts should be 4, got ${DEFAULTS.componentAttempts}`);
expect(DEFAULTS.maxParallel === 4, `default max parallel should be 4, got ${DEFAULTS.maxParallel}`);
expect(DEFAULTS.threshold === 0.85, `default threshold should be 0.85, got ${DEFAULTS.threshold}`);
expect(DEFAULTS.maxParityRetries === 2,
  `default parity retries should be 2, got ${DEFAULTS.maxParityRetries}`);
expect(DEFAULTS.planRepairs === 2, `default plan repairs should be 2, got ${DEFAULTS.planRepairs}`);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-e2e-'));
const evidenceDir = path.join(sandbox, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

// Deliberately arbitrary ids: the pipeline must not depend on any project's naming.
const repoRoot = path.join(sandbox, 'repo');
const CONTENT_A = 'alpha-band';
const CONTENT_B = 'beta-grid';
const CHROME = 'global-masthead';
const componentIds = [CONTENT_A, CONTENT_B, CHROME];
for (const id of componentIds) {
  fs.mkdirSync(path.join(repoRoot, 'ui.apps', 'components', id), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'ui.apps', 'components', id, 'placeholder.txt'), 'before');
}
fs.mkdirSync(path.join(repoRoot, 'core', 'src', 'main', 'java'), { recursive: true });

const discovery = {
  schema_version: 1,
  source: { requested_url: 'https://example.com', final_url: 'https://example.com' },
  source_fingerprint: 'sha256:fixture',
  breakpoints: [1440],
  instances: [
    { id: 'inst-001', label: 'hero', media: { 1440: [{ tag: 'img', src: '/hero.png', alt: 'Hero', intrinsic: { width: 20, height: 10 } }] } },
    { id: 'inst-002', label: 'cta' },
    { id: 'inst-003', label: 'nav' },
  ],
  status: 'PASS',
};

function planFor() {
  return {
    run_id: 'e2e',
    source_fingerprint: 'sha256:fixture',
    breakpoints: [1440],
    shared: { compose_targets: {}, policies_file: null, page_path: '/content/page' },
    components: [
      {
        id: CONTENT_A,
        tier: 4,
        role: 'content',
        instances: ['inst-001'],
        owned_paths: [`ui.apps/components/${CONTENT_A}`],
        contribution: { kind: 'page-fragment', path: '/content/page/jcr:content/root/main', order_index: 1 },
        parity_targets: [{ instance: 'inst-001', source: { css: '.a' }, target: { css: '.cmp-a' } }],
        depends_on: [],
      },
      {
        id: CONTENT_B,
        tier: 4,
        role: 'content',
        instances: ['inst-002'],
        owned_paths: [`ui.apps/components/${CONTENT_B}`],
        contribution: { kind: 'page-fragment', path: '/content/page/jcr:content/root/main', order_index: 2 },
        parity_targets: [{ instance: 'inst-002', source: { css: '.b' }, target: { css: '.cmp-b' } }],
        depends_on: [CONTENT_A],
      },
      {
        id: CHROME,
        tier: 4,
        role: 'chrome',
        instances: ['inst-003'],
        owned_paths: [`ui.apps/components/${CHROME}`],
        contribution: { kind: 'experience-fragment', path: '/content/experience-fragments/site/masthead/master/jcr:content/root' },
        parity_targets: [{ instance: 'inst-003', source: { css: 'nav' }, target: { css: '.cmp-chrome' } }],
        depends_on: [],
      },
    ],
  };
}

/** Fake agent: writes its result envelope and a file inside its own scope. */
function makeSpawnFn(behaviour) {
  return (executable, args, spawnOptions) => {
    const emitter = new EventEmitter();
    emitter.stdout = new PassThrough();
    emitter.stderr = new PassThrough();

    const role = spawnOptions.env.MIGRATION_ROLE;
    const id = spawnOptions.env.MIGRATION_AGENT_ID;
    const resultPath = spawnOptions.env.MIGRATION_RESULT_PATH;
    const promptPath = path.join(path.dirname(resultPath), 'prompt.md');
    const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';
    setImmediate(() => {
      behaviour({
        role, id, resultPath, prompt, cwd: spawnOptions.cwd,
      });
      emitter.stdout.end();
      emitter.stderr.end();
      emitter.emit('close', 0);
    });
    return emitter;
  };
}

let parityCycle = 0;
const parityDir = path.join(evidenceDir, 'parity');
const instanceFor = (id) => ({ [CONTENT_A]: 'inst-001', [CONTENT_B]: 'inst-002', [CHROME]: 'inst-003' }[id]);
// One component is made to fail its first attempt so the retry path is exercised.
const attemptsSeen = new Map();
const retryPrompts = [];
const remediationPrompts = [];

function writeParity(passing, compositePassing = true, cycle = 0) {
  const components = componentIds.map((id) => ({
    component_id: id,
    status: passing.includes(id) ? 'PASS' : 'FAIL',
    min_ratio: passing.includes(id) ? 0.97 : 0.88,
    owning_layer_hint: passing.includes(id) ? null : (id === CHROME ? 'color-tokens' : 'spacing'),
    failed_gates: passing.includes(id) ? [] : ['spacing'],
    // Budgets are held per width, so the ledger reads status from here, not from the roll-up.
    breakpoints: {
      '1440-disabled': {
        status: passing.includes(id) ? 'PASS' : 'FAIL',
        ratio: passing.includes(id) ? 0.97 : 0.88,
      },
    },
  }));
  fs.mkdirSync(parityDir, { recursive: true });
  fs.writeFileSync(path.join(parityDir, 'parity.json'), JSON.stringify({
    schema_version: 1,
    cycle,
    tool: { name: 'parity.mjs', version: 'fake' },
    threshold: 0.9,
    runner_revision: 'sha256:fake',
    source_url: 'https://example.com',
    breakpoints: [1440],
    results: componentIds.map((id) => ({
      component_id: id,
      breakpoint: 1440,
      mode: 'disabled',
      status: passing.includes(id) ? 'PASS' : 'FAIL',
      // Routing is per width, so the layer that owns the defect is read from the row.
      owning_layer_hint: passing.includes(id) ? null : (id === CHROME ? 'color-tokens' : 'spacing'),
      side_by_side: `evidence/${id}-1440-disabled-side-by-side.png`,
      diff_mask: `evidence/${id}-1440-disabled-mask.png`,
      source: { selector: '.a', screenshot: `evidence/${id}-1440-disabled-source.png` },
      target: { selector: '.cmp-a', screenshot: `evidence/${id}-1440-disabled-target.png` },
    })),
    components,
    page_composite: {
      '1440-disabled': {
        ratio: compositePassing ? 0.99 : 0.71,
        status: compositePassing ? 'PASS' : 'FAIL',
        height_delta: compositePassing ? 0 : -820,
        source: 'evidence/full-1440-source.png',
        target: 'evidence/full-1440-disabled-target.png',
        side_by_side: 'evidence/full-1440-disabled-side-by-side.png',
      },
    },
    summary: {
      components_total: componentIds.length,
      components_passed: passing.length,
      components_failed: componentIds.length - passing.length,
      min_ratio: passing.length === componentIds.length ? 0.97 : 0.88,
    },
    status: passing.length === componentIds.length && compositePassing ? 'PASS' : 'FAIL',
  }, null, 2));
}

const runTool = async (name, args = []) => {
  if (name === 'discover') {
    const target = path.join(evidenceDir, 'discovery');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'discovery.json'), JSON.stringify(discovery, null, 2));
    return { name, code: 0 };
  }
  // First run fails two components; after one remediation round everything passes.
  // Cycle 1 then passes every component while the page is still wrong — the dead end a page batch owns.
  const requested = Number(args[args.indexOf('--cycle') + 1] ?? parityCycle);
  writeParity(parityCycle === 0 ? [CONTENT_A] : componentIds, parityCycle >= 2, requested);
  parityCycle += 1;
  return { name, code: 0 };
};

const execCalls = [];
const execFn = (command, args) => {
  execCalls.push(`${command} ${args.join(' ')}`);
  const emitter = new EventEmitter();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  setImmediate(() => {
    emitter.stdout.end();
    emitter.stderr.end();
    emitter.emit('close', 0);
  });
  return emitter;
};

const agentBehaviour = ({ role, id, resultPath, prompt, cwd }) => {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  if (role === 'planner') {
    fs.writeFileSync(path.join(evidenceDir, 'plan.json'), JSON.stringify(planFor(), null, 2));
    fs.writeFileSync(resultPath, JSON.stringify({
      role,
      status: 'PASS',
      checks: [
        { name: 'every_instance_claimed', status: 'PASS' },
        { name: 'ownership_disjoint', status: 'PASS' },
        { name: 'chrome_uses_experience_fragments', status: 'PASS' },
      ],
    }, null, 2));
    return;
  }
  if (role === 'foundations') {
    // The real foundations agent writes the page and fragment skeletons the composer merges into,
    // plus the filter roots that let them deploy at all.
    const filterFile = path.join(repoRoot, 'ui.content/src/main/content/META-INF/vault/filter.xml');
    fs.mkdirSync(path.dirname(filterFile), { recursive: true });
    // Deliberately omits the page root: the orchestrator must add that itself.
    fs.writeFileSync(filterFile, `<?xml version="1.0" encoding="UTF-8"?>
<workspaceFilter version="1.0">
    <filter root="/content/experience-fragments/site/masthead/master"/>
    <filter root="/content" mode="merge"/>
</workspaceFilter>
`, 'utf8');
    for (const [file, container] of [
      ['ui.content/src/main/content/jcr_root/content/page/.content.xml', 'main'],
      ['ui.content/src/main/content/jcr_root/content/experience-fragments/site/masthead/master/.content.xml', null],
    ]) {
      const absolute = path.join(repoRoot, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content jcr:primaryType="cq:PageContent" jcr:title="Fixture">
        <root jcr:primaryType="nt:unstructured">${container ? `\n            <${container} jcr:primaryType="nt:unstructured"/>\n        ` : ''}</root>
    </jcr:content>
</jcr:root>
`, 'utf8');
    }
    fs.writeFileSync(resultPath, JSON.stringify({
      role,
      status: 'PASS',
      checks: [
        { name: 'tokens_defined', status: 'PASS' },
        { name: 'template_and_policy_ready', status: 'PASS' },
      ],
    }, null, 2));
    return;
  }
  if (role === 'component') {
    const attempt = (attemptsSeen.get(id) || 0) + 1;
    attemptsSeen.set(id, attempt);
    if (attempt > 1) retryPrompts.push({ id, attempt, prompt });

    // First attempt for one component writes outside its scope and must be rejected.
    if (id === CONTENT_B && attempt === 1) {
      const stray = path.join(cwd, 'ui.apps', 'components', CONTENT_A, 'stolen.txt');
      fs.mkdirSync(path.dirname(stray), { recursive: true });
      fs.writeFileSync(stray, 'out of scope');
    }
    const file = path.join(cwd, 'ui.apps', 'components', id, 'built.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `built ${id}`);
    fs.writeFileSync(path.join(path.dirname(file), `${id}.css`), `.cmp-${id} { color: red; }`);
    fs.writeFileSync(resultPath, JSON.stringify({
      role,
      component_id: id,
      status: 'PASS',
      checks: [
        { name: 'dialog_authorable', status: 'PASS' },
        { name: 'model_and_htl_complete', status: 'PASS' },
        { name: 'focused_test_declared', status: 'PASS' },
        { name: 'contributions_declared', status: 'PASS' },
      ],
      focused_test: { tests: [`${id}Test`] },
      contributions: {
        clientlib_entries: [`${id}.css`],
        [id === CHROME ? 'experience_fragment_node' : 'page_node']: {
          name: id,
          instance: instanceFor(id),
          resource_type: `demo/components/${id}`,
          properties: {},
        },
      },
    }, null, 2));
    return;
  }
  const ids = id.replace('fix-', '');
  remediationPrompts.push(prompt);
  const file = path.join(cwd, 'ui.apps', 'components', ids, 'fixed.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'fixed');
  fs.writeFileSync(resultPath, JSON.stringify({
    role,
    status: 'PASS',
    checks: [
      { name: 'diagnosis_recorded', status: 'PASS' },
      { name: 'hypothesis_applied', status: 'PASS' },
    ],
    notes: 'padding corrected from deltas',
  }, null, 2));
};

const spawnFn = makeSpawnFn(agentBehaviour);

const renderer = createRenderer({ stageIds: PHASES_FOR_CHECK });

const fetchFn = async (url) => {
  // The deploy gate asks the instance what actually started; everything else is an asset fetch.
  if (String(url).includes('/system/console/bundles')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 1, symbolicName: 'com.adobe.granite.core', version: '1.0.0', state: 'Active' },
          { id: 2, symbolicName: 'demo.core', version: '1.0.0.SNAPSHOT', state: 'Active' },
        ],
      }),
    };
  }
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => new TextEncoder().encode('png-bytes').buffer,
  };
};

const outcome = await orchestrate(
  {
    siteUrl: 'https://example.com',
    aemHost: 'localhost',
    aemPort: 4506,
    breakpoints: [1440],
    maxParallel: 3,
    targetPath: '/content/page',
    fetchFn,
  },
  {
    copilot: { executable: 'fake-copilot', version: 'fake' },
    renderer,
    runId: 'e2e',
    evidenceDir,
    runTool,
    spawnFn,
    execFn,
    repoRoot,
  },
);

const phaseNames = outcome.phases.map((phase) => phase.name);
expect(phaseNames.join(',') === 'discover,plan,foundations,assets,fanout,compose,deploy,parity,remediation,report',
  `all phases should run in order, got ${phaseNames.join(',')}`);
const phaseStatus = Object.fromEntries(outcome.phases.map((phase) => [phase.name, phase.status]));
// Parity legitimately fails on the first cycle; remediation is what must recover it.
expect(phaseStatus.parity === 'FAIL', 'the seeded first parity cycle should fail');
expect(phaseStatus.remediation === 'PASS', 'remediation should recover the failing components');
expect(['discover', 'plan', 'foundations', 'assets', 'fanout', 'compose', 'deploy', 'report']
  .every((name) => phaseStatus[name] === 'PASS'),
`every other phase should pass: ${JSON.stringify(phaseStatus)}`);
expect(outcome.status === 'COMPLETE', `run should complete, got ${outcome.status}`);
expect(outcome.plan.components.length === 3, 'plan should carry three components');

// The page must get its own replace-mode root, ahead of the merge root that would swallow it.
const deployedFilter = fs.readFileSync(path.join(repoRoot, 'ui.content/src/main/content/META-INF/vault/filter.xml'), 'utf8');
expect(deployedFilter.includes('<filter root="/content/page"/>'),
  `the orchestrator must add a replace-mode root for the target page, got:\n${deployedFilter}`);
expect(deployedFilter.indexOf('/content/page"') < deployedFilter.indexOf('"/content" mode="merge"'),
  'the page root must precede the ancestor merge root');

// Remediation only ever sees cropped components, so the page-level view must be handed to it too,
// and every evidence image must be openable from a workspace that excludes the evidence directory.
expect(remediationPrompts.length > 0, 'remediation should have been invoked');
const fixPrompt = remediationPrompts[0];
expect(fixPrompt.includes('"page_composite"'), 'the remediation prompt must carry the page composite');
expect(fixPrompt.includes(JSON.stringify(path.join(parityDir, 'evidence', 'full-1440-disabled-side-by-side.png')).slice(1, -1)),
  'the page composite image must be given as an absolute path');
expect(!/"side_by_side": "evidence\//.test(fixPrompt),
  'no evidence path may stay relative to the parity directory');

// Fan-out honoured the dependency wave ordering.
const fanout = outcome.phases.find((phase) => phase.name === 'fanout');
expect(fanout.status === 'PASS', 'fan-out should succeed');

// Every worker ran in its own checkout and was merged back.
for (const id of componentIds) {
  expect(fs.existsSync(path.join(repoRoot, 'ui.apps', 'components', id, 'built.txt')),
    `merged output missing for ${id}`);
}
expect(!fs.existsSync(path.join(evidenceDir, 'workspaces')) || fs.readdirSync(path.join(evidenceDir, 'workspaces')).length === 0,
  'no worker checkout should be left behind');

// The out-of-scope first attempt was rejected, retried, and the reason was fed back.
expect(attemptsSeen.get(CONTENT_B) === 2, `${CONTENT_B} should have taken two attempts, got ${attemptsSeen.get(CONTENT_B)}`);
expect(attemptsSeen.get(CONTENT_A) === 1, 'a clean component should not retry');
const retry = retryPrompts.find((entry) => entry.id === CONTENT_B);
expect(Boolean(retry), 'the retry prompt should have been captured');
expect(/## Attempt 1 of \d+ was rejected/.test(retry.prompt), 'the retry prompt must state which attempt was rejected');
expect(retry.prompt.includes('outside your scope') && retry.prompt.includes(CONTENT_A),
  'the retry prompt must name the out-of-scope path');
expect(retry.prompt.includes(`ui.apps/components/${CONTENT_B}`),
  'the retry prompt must restate the paths the worker may write');
expect(!fs.existsSync(path.join(repoRoot, 'ui.apps', 'components', CONTENT_A, 'stolen.txt')),
  'the rejected out-of-scope write must never reach the shared tree');

// Focused tests were declared by workers and executed once by the orchestrator.
expect(execCalls.some((call) => call.includes('-Dtest=') && call.includes(`${CONTENT_A}Test`)),
  `focused tests should be deduplicated into one command, got ${execCalls[0]}`);
expect(execCalls.filter((call) => call.includes('autoInstallSinglePackage')).length > 0,
  'the full reactor build should be installed as one package');
expect(execCalls.some((call) => call.includes('clean') && call.includes('install')),
  'the deploy must clean, so stale generated sources cannot survive a rename');

// Remediation routed the failures, recorded attempts, and terminated. One budget covers a
// component at every breakpoint.
const ledger = outcome.ledger.components;
const passingFirst = ledger.find((entry) => entry.id === CONTENT_A);
const failingFirst = ledger.find((entry) => entry.id === CONTENT_B);
expect(passingFirst.status === 'PASS' && passingFirst.history.length === 0,
  'a passing component must not consume an attempt');
expect(failingFirst.status === 'PASS' && failingFirst.history.length === 1,
  `failing component should record one attempt, got ${failingFirst.history.length}`);
expect(failingFirst.history[0].layer === 'spacing',
  `attempt should record the owning layer, got ${failingFirst.history[0].layer}`);

// A page that fails while every component passes must still be worked, and charged to the page.
const pageEntry = outcome.ledger.page;
expect(pageEntry && pageEntry.status === 'PASS', `the page should recover, got ${pageEntry && pageEntry.status}`);
expect(pageEntry.history.length === 1, `the page should record exactly one attempt, got ${pageEntry.history.length}`);
expect(pageEntry.history[0].layer === 'page-composition',
  `the page attempt must record its layer, got ${pageEntry.history[0].layer}`);
expect(fs.existsSync(path.join(evidenceDir, 'agents', 'remediation-1-page')),
  'a page batch must use the page scope label, not every component id concatenated');
expect(remediationPrompts.some((entry) => entry.includes('"owning_layer": "page-composition"')),
  'a page batch must tell the agent which layer it owns');

// The report is generated from artefacts.
const reportPath = path.join(evidenceDir, 'completion-report.md');
expect(fs.existsSync(reportPath), 'completion report should be written');
const report = fs.readFileSync(reportPath, 'utf8');
expect(report.includes('Components created: **3**'), 'report should count components');
expect(report.includes('VISUAL PARITY GATE: PASSED'), 'report should emit the passing status line');
expect(fs.existsSync(path.join(evidenceDir, 'remediation-ledger.json')), 'ledger should be persisted');

// Timing: every stage, every agent, every deploy step, and the run total.
expect(/\*\*Total run time: \d/.test(report), 'the report must state the total run time');
expect(report.includes('| Stage | Status | Duration | Share of run |'), 'the report must carry a per-stage timing table');
for (const phase of ['discover', 'plan', 'foundations', 'assets', 'fanout', 'compose', 'deploy', 'parity', 'remediation', 'report']) {
  expect(new RegExp(`\\| ${phase} \\|`).test(report), `stage ${phase} should appear in the timing table`);
}
expect(report.includes('Slowest agent invocations'), 'the report should rank agent invocations by duration');
expect(report.includes('Build and deploy steps'), 'the report should list deploy step timings');
expect(report.includes('| Component | Tier | Role | Instances | Build time |'), 'component rows should carry build time');

const summary = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'completion-summary.json'), 'utf8'));
expect(typeof summary.timings.total_seconds === 'number', 'summary should carry the run total');
expect(Object.keys(summary.timings.phases).length === 10, `summary should time all ten phases, got ${Object.keys(summary.timings.phases).length}`);
expect(summary.timings.invocations.length >= 5,
  `summary should list every agent invocation, got ${summary.timings.invocations.length}`);
expect(componentIds.every((id) => id in summary.timings.components),
  'summary should carry a build time for every component');
expect(typeof summary.timings.deploy_seconds === 'number', 'summary should carry deploy time');

// Resume: a second run over the same evidence must reuse every verified phase and spawn no agent.
const spawnedOnResume = [];
const resumeOutcome = await orchestrate(
  {
    siteUrl: 'https://example.com',
    aemHost: 'localhost',
    aemPort: 4506,
    breakpoints: [1440],
    maxParallel: 3,
    targetPath: '/content/page',
    fetchFn,
    resume: true,
  },
  {
    copilot: { executable: 'fake-copilot', version: 'fake' },
    renderer: createRenderer({ stageIds: PHASES_FOR_CHECK }),
    runId: 'e2e',
    evidenceDir,
    runTool: async (name, args) => {
      if (name === 'discover') throw new Error('discovery must not re-run on resume');
      return runTool(name, args);
    },
    spawnFn: makeSpawnFn((context) => {
      spawnedOnResume.push(context.role);
      return agentBehaviour(context);
    }),
    execFn,
    repoRoot,
  },
);
expect(resumeOutcome.status === 'COMPLETE', `resumed run should complete, got ${resumeOutcome.status}`);
const reused = resumeOutcome.phases.filter((entry) => entry.reused).map((entry) => entry.name);
expect(reused.join(',') === 'discover,plan,foundations,assets,fanout',
  `every finished phase should be reused, got ${reused.join(',') || 'none'}`);
expect(!spawnedOnResume.includes('component') && !spawnedOnResume.includes('planner')
  && !spawnedOnResume.includes('foundations'),
`resume must not re-spawn a completed role, got ${spawnedOnResume.join(',') || 'none'}`);

// A resume pointed at a different source must refuse the stale evidence and start over.
const wrongSource = readCheckpoint({ evidenceDir, siteUrl: 'https://somewhere-else.test' });
expect(wrongSource.discovery === null, 'a different source URL must invalidate the checkpoint');

// The plan encodes the page it authors, so retargeting the run must not reuse it.
const wrongTarget = readCheckpoint({ evidenceDir, siteUrl: 'https://example.com', targetPath: '/content/somewhere/else' });
expect(wrongTarget.discovery !== null && wrongTarget.plan === null,
  'a different target page must invalidate the cached plan but keep the discovery');

// Cancellation: components finished before the kill are banked and must not be rebuilt.
const banked = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'workers.json'), 'utf8'));
expect(banked.map((entry) => entry.component_id).join(',') === componentIds.join(','),
  `workers.json must be plan-ordered, got ${banked.map((entry) => entry.component_id).join(',')}`);
fs.writeFileSync(path.join(evidenceDir, 'workers.json'),
  JSON.stringify(banked.filter((entry) => entry.component_id !== CONTENT_B), null, 2));

// Ctrl+C also leaves the in-flight workspace behind; resume must not inherit it.
const debris = path.join(evidenceDir, 'workspaces', `${CONTENT_B}-attempt-1`);
fs.mkdirSync(path.join(debris, 'ui.apps', 'components', CONTENT_B), { recursive: true });
fs.writeFileSync(path.join(debris, 'ui.apps', 'components', CONTENT_B, 'half-written.txt'), 'debris');

const rebuilt = [];
const partialOutcome = await orchestrate(
  {
    siteUrl: 'https://example.com',
    aemHost: 'localhost',
    aemPort: 4506,
    breakpoints: [1440],
    maxParallel: 3,
    targetPath: '/content/page',
    fetchFn,
    resume: true,
  },
  {
    copilot: { executable: 'fake-copilot', version: 'fake' },
    renderer: createRenderer({ stageIds: PHASES_FOR_CHECK }),
    runId: 'e2e',
    evidenceDir,
    runTool,
    spawnFn: makeSpawnFn((context) => {
      if (context.role === 'component') rebuilt.push(context.id);
      return agentBehaviour(context);
    }),
    execFn,
    repoRoot,
  },
);
expect(partialOutcome.status === 'COMPLETE', `a partially banked run should complete, got ${partialOutcome.status}`);
expect(rebuilt.join(',') === CONTENT_B, `only the missing component should rebuild, got ${rebuilt.join(',') || 'none'}`);
const fanoutPhase = partialOutcome.phases.find((entry) => entry.name === 'fanout');
expect(!fanoutPhase.reused, 'a partial fan-out must run rather than claim it was reused');
expect(!fs.existsSync(path.join(debris, 'ui.apps', 'components', CONTENT_B, 'half-written.txt')),
  'workspace debris from the cancelled run must be cleared, not carried into the resume');

// One model and one effort govern every agent, or their work is not comparable.
const tuned = { model: 'run-wide', effort: 'high' };
expect(AGENT_ROLES.every((role) => agentTuning(tuned, role).model === 'run-wide'
  && agentTuning(tuned, role).effort === 'high'),
  'every role must run at the same model and effort');
let refusedOverride = false;
try {
  parseArgs(['--url', 'https://x.test', '--effort:remediation', 'low']);
} catch {
  refusedOverride = true;
}
expect(refusedOverride, 'a per-role override must be refused, not silently accepted');

// The run banks what it started with so a resume cannot silently change model or effort.
const bankedTuning = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'run-tuning.json'), 'utf8'));
expect(Object.hasOwn(bankedTuning, 'model') && Object.hasOwn(bankedTuning, 'effort'),
  'the run must bank its model and effort');

// Model and effort are settled against what the account actually exposes, never guessed.
const catalogue = [
  { id: 'auto', name: 'Auto', capabilities: { supports: {} } },
  {
    id: 'claude-opus-4.8',
    name: 'Claude Opus 4.8',
    capabilities: { supports: { reasoningEffort: true } },
    supportedReasoningEfforts: ['high', 'xhigh'],
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    capabilities: { supports: { reasoningEffort: true } },
    supportedReasoningEfforts: ['high', 'xhigh'],
  },
  {
    id: 'mai-code-1.1-flash',
    name: 'MAI-Code-1.1-Flash',
    capabilities: { supports: { reasoningEffort: true } },
    supportedReasoningEfforts: ['high'],
  },
];

expect(selectTuning(catalogue, { model: 'claude-opus-4.8', effort: 'xhigh' }).effort === 'xhigh',
  'an advertised effort must be accepted');
expect(selectTuning(catalogue, { model: 'Claude Opus 4.8' }).model === 'claude-opus-4.8',
  'a model may be named as well as identified');
expect(selectTuning(catalogue, { model: 'claude-opus-4.8' }).effort === 'high',
  'an unspecified effort must default to high when the model advertises it');

const refuses = (wanted, why) => {
  let threw = false;
  try { selectTuning(catalogue, wanted); } catch { threw = true; }
  expect(threw, why);
};
refuses({ model: 'gpt-5.4' }, 'a model outside the account catalogue must be refused');
refuses({ model: 'mai-code-1.1-flash', effort: 'xhigh' },
  'an effort the chosen model does not advertise must be refused');
refuses({ model: 'auto', effort: 'high' },
  'a model that manages its own reasoning must refuse an effort flag');
expect(selectTuning(catalogue, { model: 'auto' }).effort === null,
  'a model that manages its own reasoning must carry no effort');

// Reasoning is the costly part, so the newest Opus is what the picker offers first.
expect(catalogue[preferredModelIndex(catalogue)].id === 'claude-opus-5',
  `the newest Opus must be preferred, got ${catalogue[preferredModelIndex(catalogue)].id}`);
expect(preferredModelIndex([{ id: 'auto', name: 'Auto' }]) === 0,
  'auto must be preferred when no Opus is available');
expect(describeModel(catalogue[1], 1).includes('2. Claude Opus 4.8 (claude-opus-4.8); effort: high/xhigh'),
  `the picker line must name the model and its efforts, got ${describeModel(catalogue[1], 1)}`);
expect(describeModel(catalogue[0], 0).includes('managed by model'),
  'a model with no configurable effort must say so');

// Cheap reasoning is for iterating, not certifying, so what a run may call a pass moves with it.
expect(thresholdForEffort('xhigh') === 0.9 && thresholdForEffort('high') === 0.85
  && thresholdForEffort('medium') === 0.75 && thresholdForEffort('low') === 0.55,
  'the gate must follow the effort it was earned at');
expect(thresholdForEffort('max') >= thresholdForEffort('xhigh'),
  'the most expensive effort may never be the most forgiving');
expect(thresholdForEffort(null, 0.85) === 0.85,
  'a model that manages its own reasoning must keep the default bar');
const ordered = ['low', 'medium', 'high', 'xhigh'].map((level) => thresholdForEffort(level));
expect(ordered.every((value, index) => index === 0 || value > ordered[index - 1]),
  `the bar must rise with effort, got ${ordered.join(' < ')}`);

// A green `mvn install` only proves the artefact was uploaded. A bundle the instance could not
// resolve holds no classes at all, which surfaces much later as an HTL use-class that cannot be
// resolved to a type, so the deploy phase asks what actually started.
const bundleFetch = (bundles, detail = {}) => async (url) => {
  if (String(url).includes('/system/console/bundles.json')) {
    return { ok: true, status: 200, json: async () => ({ data: bundles }) };
  }
  return { ok: true, status: 200, json: async () => detail };
};

const healthy = await verifyBundles({
  aemUrl: 'http://localhost:4502',
  password: 'x',
  fetchFn: bundleFetch([
    { id: 1, symbolicName: 'a', version: '1', state: 'Active' },
    { id: 2, symbolicName: 'b', version: '1', state: 'Fragment' },
  ]),
});
expect(healthy.status === 'PASS', `an instance with nothing unresolved must pass, got ${healthy.status}`);

const unresolved = await verifyBundles({
  aemUrl: 'http://localhost:4502',
  password: 'x',
  fetchFn: bundleFetch(
    [
      { id: 1, symbolicName: 'a', version: '1', state: 'Active' },
      { id: 610, symbolicName: 'demo.core', version: '1.0.0.SNAPSHOT', state: 'Installed' },
    ],
    {
      data: [{
        props: [{
          key: 'Imported Packages',
          value: [
            'org.apache.sling.api,version=2.0 from <a>sling</a>',
            'ERROR: com.adobe.cq.wcm.core.components.models,version=[12.30,13) -- Cannot be resolved',
          ],
        }],
      }],
    },
  ),
});
expect(unresolved.status === 'FAIL', 'an unresolved bundle must fail the deploy');
expect(unresolved.broken[0].symbolicName === 'demo.core',
  `the failure must name the bundle, got ${unresolved.broken[0]?.symbolicName}`);
expect(unresolved.broken[0].unresolved.some((line) => line.includes('12.30')),
  `the failure must name the requirement that could not be met, got ${unresolved.broken[0]?.unresolved}`);
expect(describeBrokenBundles(unresolved.broken).includes('is Installed'),
  'the summary must say what state the bundle is stuck in');

// An unreachable console must not be reported as a healthy instance.
const offline = await verifyBundles({
  aemUrl: 'http://localhost:4502',
  password: 'x',
  fetchFn: async () => { throw new Error('ECONNREFUSED'); },
});
expect(offline.status === 'UNKNOWN' && offline.broken.length === 0,
  `an unreachable console must be UNKNOWN, not PASS or FAIL, got ${offline.status}`);

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\norchestrator end-to-end assertions: all passed');
}
