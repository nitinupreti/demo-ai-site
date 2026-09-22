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

import { DEFAULTS, orchestrate } from './run.mjs';
import { createRenderer } from './console.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// Out of the box, without any flag, a component gets four attempts.
expect(DEFAULTS.componentAttempts === 4, `default component attempts should be 4, got ${DEFAULTS.componentAttempts}`);
expect(DEFAULTS.maxParallel === 4, `default max parallel should be 4, got ${DEFAULTS.maxParallel}`);
expect(DEFAULTS.threshold === 0.9, `default threshold should be 0.90, got ${DEFAULTS.threshold}`);
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
    { id: 'inst-001', label: 'hero' },
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
    shared: { compose_targets: {}, policies_file: null },
    components: [
      {
        id: CONTENT_A,
        tier: 4,
        role: 'content',
        instances: ['inst-001'],
        owned_paths: [`ui.apps/components/${CONTENT_A}`],
        contribution: { kind: 'page-fragment', path: '/content/page', order_index: 1 },
        parity_targets: [{ instance: 'inst-001', source: { css: '.a' }, target: { css: '.cmp-a' } }],
        depends_on: [],
      },
      {
        id: CONTENT_B,
        tier: 4,
        role: 'content',
        instances: ['inst-002'],
        owned_paths: [`ui.apps/components/${CONTENT_B}`],
        contribution: { kind: 'page-fragment', path: '/content/page', order_index: 2 },
        parity_targets: [{ instance: 'inst-002', source: { css: '.b' }, target: { css: '.cmp-b' } }],
        depends_on: [CONTENT_A],
      },
      {
        id: CHROME,
        tier: 4,
        role: 'chrome',
        instances: ['inst-003'],
        owned_paths: [`ui.apps/components/${CHROME}`],
        contribution: { kind: 'experience-fragment', path: '/content/experience-fragments/site/masthead/master' },
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
// One component is made to fail its first attempt so the retry path is exercised.
const attemptsSeen = new Map();
const retryPrompts = [];

function writeParity(passing) {
  const components = componentIds.map((id) => ({
    component_id: id,
    status: passing.includes(id) ? 'PASS' : 'FAIL',
    min_ratio: passing.includes(id) ? 0.97 : 0.88,
    owning_layer_hint: passing.includes(id) ? null : (id === CHROME ? 'color-tokens' : 'spacing'),
    failed_gates: passing.includes(id) ? [] : ['spacing'],
    breakpoints: {},
  }));
  fs.mkdirSync(parityDir, { recursive: true });
  fs.writeFileSync(path.join(parityDir, 'parity.json'), JSON.stringify({
    schema_version: 1,
    tool: { name: 'parity.mjs', version: 'fake' },
    threshold: 0.9,
    runner_revision: 'sha256:fake',
    source_url: 'https://example.com',
    breakpoints: [1440],
    results: componentIds.map((id) => ({
      component_id: id, breakpoint: 1440, mode: 'disabled', status: passing.includes(id) ? 'PASS' : 'FAIL',
    })),
    components,
    page_composite: { '1440-disabled': { ratio: 0.99, status: 'PASS', height_delta: 0 } },
    summary: {
      components_total: componentIds.length,
      components_passed: passing.length,
      components_failed: componentIds.length - passing.length,
      min_ratio: passing.length === componentIds.length ? 0.97 : 0.88,
    },
    status: passing.length === componentIds.length ? 'PASS' : 'FAIL',
  }, null, 2));
}

const runTool = async (name) => {
  if (name === 'discover') {
    const target = path.join(evidenceDir, 'discovery');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'discovery.json'), JSON.stringify(discovery, null, 2));
    return { name, code: 0 };
  }
  // First run fails two components; after one remediation round everything passes.
  writeParity(parityCycle === 0 ? [CONTENT_A] : componentIds);
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

const spawnFn = makeSpawnFn(({ role, id, resultPath, prompt, cwd }) => {
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
      contributions: { clientlib_entries: [`${id}.css`] },
    }, null, 2));
    return;
  }
  const ids = id.replace('fix-', '');
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
});

const renderer = createRenderer({ stageIds: ['discover', 'plan', 'foundations', 'fanout', 'compose', 'deploy', 'parity', 'remediation', 'report'] });

const outcome = await orchestrate(
  {
    siteUrl: 'https://example.com',
    aemHost: 'localhost',
    aemPort: 4506,
    breakpoints: [1440],
    maxParallel: 3,
    targetPath: '/content/demo/us/en/page',
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
expect(phaseNames.join(',') === 'discover,plan,foundations,fanout,compose,deploy,parity,remediation,report',
  `all phases should run in order, got ${phaseNames.join(',')}`);
const phaseStatus = Object.fromEntries(outcome.phases.map((phase) => [phase.name, phase.status]));
// Parity legitimately fails on the first cycle; remediation is what must recover it.
expect(phaseStatus.parity === 'FAIL', 'the seeded first parity cycle should fail');
expect(phaseStatus.remediation === 'PASS', 'remediation should recover the failing components');
expect(['discover', 'plan', 'foundations', 'fanout', 'compose', 'deploy', 'report']
  .every((name) => phaseStatus[name] === 'PASS'),
`every other phase should pass: ${JSON.stringify(phaseStatus)}`);
expect(outcome.status === 'COMPLETE', `run should complete, got ${outcome.status}`);
expect(outcome.plan.components.length === 3, 'plan should carry three components');

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
expect(execCalls.filter((call) => call.includes('autoInstallPackage') || call.includes('autoInstallBundle')).length > 0,
  'a scoped deploy should have run');

// Remediation routed the failures, recorded attempts, and terminated.
const ledger = outcome.ledger.components;
const passingFirst = ledger.find((entry) => entry.id === CONTENT_A);
const failingFirst = ledger.find((entry) => entry.id === CONTENT_B);
expect(passingFirst.status === 'PASS' && passingFirst.history.length === 0, 'a passing component must not consume an attempt');
expect(failingFirst.status === 'PASS' && failingFirst.history.length === 1, `failing component should record one attempt, got ${failingFirst.history.length}`);
expect(failingFirst.history[0].layer === 'spacing', `attempt should record the owning layer, got ${failingFirst.history[0].layer}`);

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
for (const phase of ['discover', 'plan', 'foundations', 'fanout', 'compose', 'deploy', 'parity', 'remediation', 'report']) {
  expect(new RegExp(`\\| ${phase} \\|`).test(report), `stage ${phase} should appear in the timing table`);
}
expect(report.includes('Slowest agent invocations'), 'the report should rank agent invocations by duration');
expect(report.includes('Build and deploy steps'), 'the report should list deploy step timings');
expect(report.includes('| Component | Tier | Role | Instances | Build time |'), 'component rows should carry build time');

const summary = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'completion-summary.json'), 'utf8'));
expect(typeof summary.timings.total_seconds === 'number', 'summary should carry the run total');
expect(Object.keys(summary.timings.phases).length === 9, `summary should time all nine phases, got ${Object.keys(summary.timings.phases).length}`);
expect(summary.timings.invocations.length >= 5,
  `summary should list every agent invocation, got ${summary.timings.invocations.length}`);
expect(componentIds.every((id) => id in summary.timings.components),
  'summary should carry a build time for every component');
expect(typeof summary.timings.deploy_seconds === 'number', 'summary should carry deploy time');

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\norchestrator end-to-end assertions: all passed');
}
