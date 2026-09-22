/**
 * Envelope contract regression. Driven by the shapes real agents produced, where complete
 * component work was rejected over field naming. Names here are deliberately arbitrary:
 * the contract must hold for any project and any component.
 */
import process from 'node:process';

import { evaluateEnvelope, normalizeEnvelope } from './agent.mjs';

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

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('agent envelope assertions: all passed');
}
