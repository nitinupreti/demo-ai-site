import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  applyProgress, createRunState, finalizeRunState, ingestStageResults, markRunStarted, readRunState, summarize,
} from './state.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-'));
const statePath = path.join(dir, 'run-state.json');
const stagesDir = path.join(dir, 'stages');
fs.mkdirSync(stagesDir);

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const runId = 'run-under-test';
createRunState(statePath, {
  runId,
  launcher: { name: 'test', version: '2.0.0' },
  inputs: { SITE_URL: 'https://example.com', BREAKPOINTS: [375, 768, 1440], EVIDENCE_DIR: 'design/scratch/x' },
  stageIds: ['01-source-discovery', '02-component-authoring'],
});
expect(readRunState(statePath).status === 'INITIALIZED', 'new state should be INITIALIZED');

markRunStarted(statePath);
applyProgress(statePath, { stage: '01-source-discovery', status: 'STARTED', message: 'capturing source' });
applyProgress(statePath, { stage: '01-source-discovery', status: 'PASS', message: 'done' });
applyProgress(statePath, { stage: 'not-a-stage', status: 'PASS' });

let state = readRunState(statePath);
const first = state.stages[0];
expect(first.status === 'PASS', `stage 1 should be PASS, got ${first.status}`);
expect(typeof first.duration_seconds === 'number', 'launcher should stamp stage duration');
expect(state.events.some((entry) => entry.type === 'UNKNOWN_STAGE_PROGRESS'), 'unknown stage should be recorded, not applied');

// An envelope claiming PASS while a check fails must be recorded as FAIL.
fs.writeFileSync(path.join(stagesDir, '01-source-discovery.json'), JSON.stringify({
  stage: '01-source-discovery',
  run_id: runId,
  status: 'PASS',
  outputs: { readiness_report: 'discovery/discovery.json' },
  checks: [
    { name: 'all_breakpoints_ready', status: 'PASS', evidence: 'discovery/discovery.json' },
    { name: 'coverage_complete', status: 'FAIL', evidence: 'discovery/discovery.json' },
  ],
}, null, 2));

// An envelope from another run must never be accepted.
fs.writeFileSync(path.join(stagesDir, '02-component-authoring.json'), JSON.stringify({
  stage: '02-component-authoring',
  run_id: 'some-other-run',
  status: 'PASS',
  outputs: {},
  checks: [{ name: 'component_coverage', status: 'PASS' }],
}, null, 2));

ingestStageResults(statePath, stagesDir);
state = readRunState(statePath);
expect(state.stages[0].status === 'FAIL', `PASS with a failing check should become FAIL, got ${state.stages[0].status}`);
expect(/failing checks/.test(state.stages[0].message || ''), 'failing-check reason should be recorded');
expect(state.stages[1].status === 'FAIL', 'foreign run_id should be rejected');
expect(/belongs to run/.test(state.stages[1].message || ''), 'foreign run reason should be recorded');

const final = finalizeRunState(statePath);
expect(final.status === 'FAIL', `run should end FAIL, got ${final.status}`);
expect(typeof final.duration_seconds === 'number', 'run duration should be stamped');
expect(summarize(final).stages[0].failing_checks.includes('coverage_complete'), 'summary should list failing checks');

// A clean run must reach COMPLETE.
const cleanPath = path.join(dir, 'clean-state.json');
const cleanStages = path.join(dir, 'clean-stages');
fs.mkdirSync(cleanStages);
createRunState(cleanPath, {
  runId: 'clean',
  launcher: { name: 'test', version: '2.0.0' },
  inputs: { SITE_URL: 'https://example.com', BREAKPOINTS: [1440], EVIDENCE_DIR: 'x' },
  stageIds: ['01-source-discovery'],
});
markRunStarted(cleanPath);
applyProgress(cleanPath, { stage: '01-source-discovery', status: 'STARTED' });
fs.writeFileSync(path.join(cleanStages, '01-source-discovery.json'), JSON.stringify({
  stage: '01-source-discovery',
  run_id: 'clean',
  status: 'PASS',
  outputs: {},
  checks: [{ name: 'all_breakpoints_ready', status: 'PASS' }],
}, null, 2));
ingestStageResults(cleanPath, cleanStages);
expect(finalizeRunState(cleanPath).status === 'COMPLETE', 'clean run should be COMPLETE');

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('run-state assertions: all passed');
}
