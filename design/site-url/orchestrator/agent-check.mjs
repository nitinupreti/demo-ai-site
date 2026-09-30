/**
 * Envelope contract regression. Driven by the shapes real agents produced, where complete
 * component work was rejected over field naming. Names here are deliberately arbitrary:
 * the contract must hold for any project and any component.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import {
  buildArguments, evaluateEnvelope, normalizeEnvelope, runAgentRole,
} from './agent.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const componentChecks = [
  { name: 'dialog_authorable', status: 'PASS' },
  { name: 'model_and_htl_complete', status: 'PASS' },
  { name: 'focused_test_declared', status: 'PASS' },
  { name: 'contributions_declared', status: 'PASS' },
];

// The exact shape a real worker emitted: component/verdict instead of role/status.
const legacy = {
  component: 'example-component',
  verdict: 'PASS',
  checks: componentChecks,
  focused_test: { tests: ['ExampleModelTest'] },
  contributions: { page_node: { name: 'example' } },
};
let verdict = evaluateEnvelope(legacy, 'component', 'example-component');
expect(verdict.status === 'PASS', `legacy field names should be accepted, got ${verdict.status}: ${verdict.error}`);
expect(verdict.envelope.role === 'component', 'role should be supplied by the orchestrator');
expect(verdict.envelope.component_id === 'example-component', 'component id should be resolved');
expect(verdict.normalized.length >= 2, `normalisation should be recorded, got ${JSON.stringify(verdict.normalized)}`);

// Lowercase and worded statuses normalise too.
verdict = evaluateEnvelope({ role: 'component', status: 'passed', checks: componentChecks }, 'component', 'x');
expect(verdict.status === 'PASS', `worded status should normalise, got ${verdict.status}`);
verdict = evaluateEnvelope({
  role: 'component', status: 'PASS', checks: componentChecks.map((check) => ({ name: check.name, verdict: 'pass' })),
}, 'component', 'x');
expect(verdict.status === 'PASS', `check-level verdict alias should normalise, got ${verdict.error}`);

// Strictness must survive: none of these may pass.
verdict = evaluateEnvelope({ role: 'component', status: 'PASS', checks: [] }, 'component', 'x');
expect(verdict.status === 'FAIL', 'an empty check list must fail');

verdict = evaluateEnvelope({
  role: 'component',
  status: 'PASS',
  checks: [...componentChecks.slice(0, 3), { name: 'contributions_declared', status: 'FAIL' }],
}, 'component', 'x');
expect(verdict.status === 'FAIL' && /claimed PASS with failing checks/.test(verdict.error),
  'PASS with a failing check must still be rejected');

verdict = evaluateEnvelope({ role: 'component', status: 'PASS', checks: componentChecks.slice(0, 2) }, 'component', 'x');
expect(verdict.status === 'FAIL' && /missing required checks/.test(verdict.error),
  'missing required checks must be rejected');
expect(/focused_test_declared/.test(verdict.error) && /Checks provided/.test(verdict.error),
  `the rejection must name what is missing and what was given: ${verdict.error}`);

// The planner's legacy stage_result shape is reported with the keys it actually used.
verdict = evaluateEnvelope({
  stage: '02-component-authoring', run_id: 'r1', status: 'PASS', outputs: {}, next_stage: null,
}, 'planner', null);
expect(verdict.status === 'FAIL', 'a stage_result envelope without checks must fail');
expect(/Top-level keys found: stage, run_id/.test(verdict.error),
  `the rejection should echo the keys that were found: ${verdict.error}`);

// A genuinely blocked agent is preserved, not coerced.
verdict = evaluateEnvelope({
  role: 'component', status: 'BLOCKED', checks: componentChecks.map((check) => ({ ...check, status: 'BLOCKED' })),
}, 'component', 'x');
expect(verdict.status === 'BLOCKED', `BLOCKED must be preserved, got ${verdict.status}`);

// Normalisation never invents a status.
const { envelope } = normalizeEnvelope({ checks: componentChecks }, { role: 'component' });
expect(envelope.status === undefined, 'a missing status must not be fabricated');

// Agent launches: neither the GitHub MCP server nor the repository's AGENTS.md belongs to any role,
// and a resumed session keeps its original name.
const firstArgs = buildArguments({ promptPath: 'p.md', name: 'aem-x', sessionId: 's-1' });
expect(firstArgs.includes('--disable-builtin-mcps') && firstArgs.includes('--no-custom-instructions'),
  `agents must start without built-in MCP servers or custom instructions, got ${firstArgs.join(' ')}`);
expect(firstArgs.includes('--session-id') && firstArgs[firstArgs.indexOf('--session-id') + 1] === 's-1',
  'every launch must name its session so it can be resumed');
expect(!buildArguments({ promptPath: 'p.md', sessionId: 's-1' }).includes('--name'),
  'a resumed session must not be renamed');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-check-'));
const validResult = JSON.stringify({ role: 'component', status: 'PASS', checks: componentChecks });

/** A fake CLI: each launch runs the next script with the arguments it was given. */
function scriptedSpawn(scripts, launches) {
  return (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const finish = (code) => {
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', code));
    };
    child.kill = () => {
      child.killed = true;
      finish(null);
    };
    const promptPath = args[args.indexOf('-p') + 1].replace('Read and execute the instructions in ', '');
    launches.push({ args, prompt: fs.readFileSync(promptPath, 'utf8'), env: options.env });
    const script = scripts[launches.length - 1];
    setImmediate(() => script({ child, finish, resultPath: options.env.MIGRATION_RESULT_PATH }));
    return child;
  };
}
const sessionOf = (launch) => launch.args[launch.args.indexOf('--session-id') + 1];
const run = (name, scripts, extra = {}) => {
  const launches = [];
  return runAgentRole({
    copilot: { executable: 'fake' },
    role: 'component',
    id: name,
    prompt: `brief for ${name}`,
    cwd: sandbox,
    agentDir: path.join(sandbox, name),
    spawnFn: scriptedSpawn(scripts, launches),
    killFn: (child) => child.kill(),
    idleTimeoutMs: 150,
    ...extra,
  }).then((invocation) => ({ invocation, launches }));
};

// A stream that goes quiet is stopped and the same session resumed; the stall costs no attempt.
{
  const { invocation, launches } = await run('stalled', [
    ({ child }) => { child.stdout.write('{"type":"assistant.turn_start"}\n'); },
    ({ finish, resultPath }) => { fs.writeFileSync(resultPath, validResult); finish(0); },
  ], { sessionId: 'session-stalled' });
  expect(invocation.status === 'PASS', `a stalled session must be resumed to completion, got ${invocation.status}: ${invocation.error}`);
  expect(invocation.relaunches === 1 && invocation.launches[0].stalled === true,
    `the stall must be recorded as one relaunch, got ${JSON.stringify(invocation.launches)}`);
  expect(launches.length === 2 && sessionOf(launches[1]) === 'session-stalled' && !launches[1].args.includes('--name'),
    'the resumed launch must continue the same session');
  expect(/interrupted/.test(launches[1].prompt) && launches[1].prompt.includes('result.json'),
    `the resume message must say what happened and where the result goes, got ${launches[1].prompt}`);
  expect(invocation.stalledSeconds > 0, 'stalled time must be reported');
}

// A provider that rejects the replayed history needs a new session, carrying the brief and the edits.
{
  const { invocation, launches } = await run('rejected', [
    ({ child, finish }) => {
      child.stdout.write(`${JSON.stringify({ type: 'session.error', data: { message: 'Execution failed: 400 `thinking` blocks cannot be modified' } })}\n`);
      finish(1);
    },
    ({ finish, resultPath }) => { fs.writeFileSync(resultPath, validResult); finish(0); },
  ], { sessionId: 'session-rejected' });
  expect(invocation.status === 'PASS', `a rejected history must restart and complete, got ${invocation.status}`);
  expect(sessionOf(launches[1]) !== 'session-rejected', 'a rejected history must not be resumed');
  expect(launches[1].prompt.includes('brief for rejected') && /previous session was interrupted/i.test(launches[1].prompt),
    'a fresh session must get the full brief and be told edits already exist');
}

// Exiting without a result is an interruption too, and the retries are bounded.
{
  const { invocation } = await run('forgetful', [
    ({ finish }) => finish(0),
    ({ finish, resultPath }) => { fs.writeFileSync(resultPath, validResult); finish(0); },
  ]);
  expect(invocation.status === 'PASS' && invocation.relaunches === 1,
    `an agent that forgot its result must be asked to finish, got ${invocation.status}`);

  const exhausted = await run('exhausted', [
    ({ finish }) => finish(1), ({ finish }) => finish(1), ({ finish }) => finish(1), ({ finish }) => finish(1),
  ], { infraRetries: 2 });
  expect(exhausted.invocation.status === 'FAIL' && exhausted.invocation.infrastructure === true
    && exhausted.launches.length === 3,
  `interruptions must stop after the retry budget, got ${exhausted.launches.length} launches`);
}

// A follow-up continues an existing conversation and keeps the brief beside it.
{
  const { invocation, launches } = await run('followup', [
    ({ finish, resultPath }) => { fs.writeFileSync(resultPath, validResult); finish(0); },
  ], { sessionId: 'session-kept', followUp: 'fix exactly this', gitCeiling: sandbox });
  expect(invocation.status === 'PASS' && sessionOf(launches[0]) === 'session-kept' && !launches[0].args.includes('--name'),
    'a follow-up must continue the named session');
  expect(launches[0].prompt === 'fix exactly this'
    && fs.readFileSync(path.join(sandbox, 'followup', 'brief.md'), 'utf8') === 'brief for followup',
  'the follow-up is the message and the brief is kept as evidence');
  expect(launches[0].env.GIT_CEILING_DIRECTORIES === sandbox, 'git must be fenced in at the workspace');
}

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('agent envelope assertions: all passed');
}
