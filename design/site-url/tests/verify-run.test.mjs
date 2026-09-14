import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readCanonicalContract, verifyRun } from '../verify-run.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const verifier = path.join(root, 'verify-run.mjs');
const contract = readCanonicalContract();
const STAGES = ['01-source-discovery', '02-component-authoring', '03-assets-runtime',
  '04-visual-parity', '05-completion-output'];

const OUTPUTS = {
  '01-source-discovery': ['readiness_report', 'score_manifest', 'coverage_report', 'ownership_map',
    'source_selector_map', 'inventory_audit', 'dom_state_media_manifests', 'frozen_denominators'],
  '02-component-authoring': ['design_facts', 'reuse_decisions', 'component_file_matrix',
    'component_coverage_matrix', 'target_selector_map', 'authorability_matrices', 'changed_files',
    'demo_content_and_policy_map'],
  '03-assets-runtime': ['asset_manifest', 'test_build_deploy_results', 'code_assessment_report',
    'runtime_assertion_sweep', 'repository_reconciliation', 'clientlib_and_media_report'],
  '04-visual-parity': ['readiness_matrix', 'geometry_property_interaction_tables',
    'screenshot_and_diff_index', 'component_minima_and_page_composites', 'remediation_history',
    'parity_runner'],
  '05-completion-output': ['completion_report'],
};

const CHECKS = {
  '01-source-discovery': ['all_breakpoints_ready', 'all_discovery_signals_executed',
    'inventory_audit_complete', 'cross_breakpoint_visibility_recorded',
    'every_instance_has_stable_source_selector', 'exactly_once_coverage', 'no_unclaimed_gap_20px'],
  '02-component-authoring': ['every_source_block_has_decision', 'every_block_file_row_complete',
    'component_coverage_complete', 'every_instance_has_target_selector',
    'every_business_value_authorable', 'focused_implementation_tests'],
  '03-assets-runtime': ['assets_reachable_and_decoded', 'focused_tests_and_required_builds',
    'code_assessment_reviewed', 'packages_and_bundles_active', 'disabled_and_author_runtime_valid',
    'target_selectors_resolve_uniquely', 'live_repository_matches_intent'],
  '04-visual-parity': ['all_source_blocks_mapped_once', 'all_geometry_and_properties_pass',
    'all_live_and_aem_screenshot_pairs_valid', 'all_screenshot_scores_above_90',
    'all_full_page_pairs_valid', 'all_full_page_scores_above_90', 'all_interactions_and_media_pass',
    'all_final_minima_and_composites_above_90'],
  '05-completion-output': ['all_upstream_results_present_and_pass', 'dependencies_same_run_and_current',
    'coverage_files_assets_scores_reconcile', 'residual_gaps_consistent_with_status'],
};

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-'));
  const png = Buffer.alloc(2048, 7);
  for (const name of ['source.png', 'target.png', 'side-by-side.png', 'mask.png', 'artifact.json']) {
    fs.writeFileSync(path.join(dir, name), png);
  }
  const shots = {
    sourceScreenshot: 'source.png',
    targetScreenshot: 'target.png',
    sideBySide: 'side-by-side.png',
    mask: 'mask.png',
    sourceUrl: 'https://example.com/page',
    targetUrl: 'http://localhost:4506/page.html',
  };
  const score = (ratio) => {
    const totalPixels = 1_000_000;
    const matchedPixels = Math.round(ratio * totalPixels);
    return { matchedPixels, differingPixels: totalPixels - matchedPixels, totalPixels, ...shots };
  };
  const rows = (ratioKey, extra = {}) => contract.breakpoints.flatMap((breakpoint) =>
    ['disabled', 'author'].map((mode) => ({
      breakpoint, mode, ...extra, ...score(0.97), [ratioKey]: 0.97,
    })));

  const stage_results = Object.fromEntries(STAGES.map((stage, index) => {
    const outputs = Object.fromEntries(OUTPUTS[stage].map((key) => [key, 'artifact.json']));
    if (stage === '04-visual-parity') {
      outputs.per_instance_scores = rows('visualMatchRatio', { instance_id: 'hero' });
      outputs.full_page_scores = rows('fullPageVisualMatchRatio');
    }
    if (stage === '05-completion-output') {
      outputs.pipeline_result_index = STAGES.map((name) => `${name}-r1`);
    }
    return [stage, {
      stage,
      result_id: `${stage}-r1`,
      run_id: 'fixture-run',
      status: index === 4 ? 'COMPLETE' : 'PASS',
      inputs_consumed: ['SITE_URL'],
      outputs,
      checks: CHECKS[stage].map((name) => ({ name, status: 'PASS', evidence: 'artifact.json' })),
      failures: [],
      next_stage: index === 4 ? null : STAGES[index + 1],
      ...(stage === '05-completion-output' ? { residual_gaps: [] } : {}),
    }];
  }));

  fs.writeFileSync(path.join(dir, 'run-state.json'),
    JSON.stringify({ run_id: 'fixture-run', process_status: 'COMPLETE', stage_results }, null, 2));
  return dir;
}

const load = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8'));
const save = (dir, state) => fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state, null, 2));

// A valid fixture must pass first, otherwise every rejection test below is a false positive.
test('a genuinely complete five-stage run passes the gate', () => {
  const dir = makeFixture();
  const result = verifyRun(dir, contract);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test('a missing ledger fails instead of defaulting to success', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-empty-'));
  const result = verifyRun(dir, contract);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /run-state\.json not found/);
});

test('every skipped stage is rejected, so no partial pipeline can report success', () => {
  for (const stage of STAGES) {
    const dir = makeFixture();
    const state = load(dir);
    delete state.stage_results[stage];
    save(dir, state);
    const result = verifyRun(dir, contract);
    assert.equal(result.ok, false, `${stage} omission was not caught`);
    assert.match(result.failures.join('\n'), new RegExp(`${stage}: no stage result envelope`));
  }
});

test('non-PASS upstream stages and non-COMPLETE reports are rejected', () => {
  for (const stage of STAGES.slice(0, 4)) {
    const dir = makeFixture();
    const state = load(dir);
    state.stage_results[stage].status = 'FAIL';
    save(dir, state);
    assert.equal(verifyRun(dir, contract).ok, false, `${stage} FAIL was not caught`);
  }
  const dir = makeFixture();
  const state = load(dir);
  state.stage_results['05-completion-output'].status = 'FAIL';
  save(dir, state);
  assert.equal(verifyRun(dir, contract).ok, false);
});

test('missing required outputs and checks are rejected per stage', () => {
  for (const stage of STAGES) {
    for (const key of OUTPUTS[stage].slice(0, 2)) {
      const dir = makeFixture();
      const state = load(dir);
      delete state.stage_results[stage].outputs[key];
      save(dir, state);
      assert.equal(verifyRun(dir, contract).ok, false, `${stage}/${key} omission was not caught`);
    }
    for (const name of CHECKS[stage].slice(0, 2)) {
      const dir = makeFixture();
      const state = load(dir);
      const envelope = state.stage_results[stage];
      envelope.checks = envelope.checks.filter((check) => check.name !== name);
      save(dir, state);
      assert.equal(verifyRun(dir, contract).ok, false, `${stage}/${name} omission was not caught`);
    }
  }
});

test('a failing check cannot be recorded as PASS without evidence', () => {
  const dir = makeFixture();
  const state = load(dir);
  state.stage_results['04-visual-parity'].checks[0].status = 'FAIL';
  save(dir, state);
  assert.equal(verifyRun(dir, contract).ok, false);

  const dir2 = makeFixture();
  const state2 = load(dir2);
  delete state2.stage_results['04-visual-parity'].checks[0].evidence;
  save(dir2, state2);
  assert.equal(verifyRun(dir2, contract).ok, false);
});

test('scores at or below the canonical ratio fail, and equality is not a pass', () => {
  for (const [key, ratio] of [['per_instance_scores', 'visualMatchRatio'],
    ['full_page_scores', 'fullPageVisualMatchRatio']]) {
    const dir = makeFixture();
    const state = load(dir);
    const row = state.stage_results['04-visual-parity'].outputs[key][0];
    row[ratio] = contract.ratio;
    row.matchedPixels = contract.ratio * row.totalPixels;
    row.differingPixels = row.totalPixels - row.matchedPixels;
    save(dir, state);
    assert.equal(verifyRun(dir, contract).ok, false, `${key} equality was treated as a pass`);
  }
});

test('a fabricated ratio that contradicts its pixel counts is rejected', () => {
  const dir = makeFixture();
  const state = load(dir);
  state.stage_results['04-visual-parity'].outputs.full_page_scores[0].fullPageVisualMatchRatio = 0.99;
  save(dir, state);
  assert.equal(verifyRun(dir, contract).ok, false);
});

test('missing breakpoint or target-mode coverage is rejected', () => {
  for (const key of ['per_instance_scores', 'full_page_scores']) {
    const dir = makeFixture();
    const state = load(dir);
    const parity = state.stage_results['04-visual-parity'].outputs;
    parity[key] = parity[key].filter((row) => row.mode !== 'author');
    save(dir, state);
    assert.equal(verifyRun(dir, contract).ok, false, `${key} missing author mode was not caught`);

    const dir2 = makeFixture();
    const state2 = load(dir2);
    const parity2 = state2.stage_results['04-visual-parity'].outputs;
    parity2[key] = parity2[key].filter((row) => row.breakpoint !== contract.breakpoints[1]);
    save(dir2, state2);
    assert.equal(verifyRun(dir2, contract).ok, false, `${key} missing breakpoint was not caught`);
  }
});

test('the mandatory full-page gate cannot be satisfied by component scores alone', () => {
  const dir = makeFixture();
  const state = load(dir);
  state.stage_results['04-visual-parity'].outputs.full_page_scores = [];
  save(dir, state);
  const result = verifyRun(dir, contract);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /independent full-page gate is mandatory/);
});

test('screenshot evidence must exist on disk and be plausibly sized', () => {
  const dir = makeFixture();
  const state = load(dir);
  state.stage_results['04-visual-parity'].outputs.full_page_scores[0].targetScreenshot = 'does-not-exist.png';
  save(dir, state);
  assert.equal(verifyRun(dir, contract).ok, false);

  const dir2 = makeFixture();
  fs.writeFileSync(path.join(dir2, 'tiny.png'), Buffer.alloc(10));
  const state2 = load(dir2);
  state2.stage_results['04-visual-parity'].outputs.full_page_scores[0].sourceScreenshot = 'tiny.png';
  save(dir2, state2);
  assert.equal(verifyRun(dir2, contract).ok, false);
});

test('referenced artifacts that do not exist are rejected', () => {
  const dir = makeFixture();
  const state = load(dir);
  state.stage_results['01-source-discovery'].outputs.score_manifest = 'evidence/missing-manifest.json';
  save(dir, state);
  assert.equal(verifyRun(dir, contract).ok, false);
});

test('residual gaps and mismatched run identity block COMPLETE', () => {
  const dir = makeFixture();
  const state = load(dir);
  state.stage_results['05-completion-output'].residual_gaps = ['hero not implemented'];
  save(dir, state);
  assert.equal(verifyRun(dir, contract).ok, false);

  const dir2 = makeFixture();
  const state2 = load(dir2);
  state2.stage_results['03-assets-runtime'].run_id = 'a-different-run';
  save(dir2, state2);
  const result = verifyRun(dir2, contract);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /run_id does not match/);
});

test('the CLI exits non-zero for an incomplete run and zero only for a complete one', () => {
  const good = makeFixture();
  const pass = spawnSync(process.execPath, [verifier, good], { encoding: 'utf8' });
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /VERIFY-RUN: PASSED/);

  const bad = makeFixture();
  const state = load(bad);
  delete state.stage_results['04-visual-parity'];
  save(bad, state);
  const fail = spawnSync(process.execPath, [verifier, bad], { encoding: 'utf8' });
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /VERIFY-RUN: FAILED/);
  assert.match(fail.stderr, /Do not report it as a migration success/);

  assert.equal(spawnSync(process.execPath, [verifier], { encoding: 'utf8' }).status, 2);
});

test('the gate reads thresholds from the router so weakening the prompt cannot loosen it', () => {
  assert.deepEqual(contract.breakpoints, [375, 768, 1440]);
  assert.equal(contract.ratio, 0.9);
});
