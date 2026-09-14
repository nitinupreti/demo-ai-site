#!/usr/bin/env node
// Deterministic completion gate for the design/site-url migration pipeline.
// Exit 0 ONLY when run-state.json proves a genuinely COMPLETE run. Any shortcut exits non-zero.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const promptDir = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = path.resolve(promptDir, '../../');

export const STAGES = [
  '01-source-discovery',
  '02-component-authoring',
  '03-assets-runtime',
  '04-visual-parity',
  '05-completion-output',
];

export const REQUIRED_OUTPUTS = {
  '01-source-discovery': ['readiness_report', 'score_manifest', 'coverage_report', 'ownership_map',
    'source_selector_map', 'inventory_audit', 'dom_state_media_manifests', 'frozen_denominators'],
  '02-component-authoring': ['design_facts', 'reuse_decisions', 'component_file_matrix',
    'component_coverage_matrix', 'target_selector_map', 'authorability_matrices', 'changed_files',
    'demo_content_and_policy_map'],
  '03-assets-runtime': ['asset_manifest', 'test_build_deploy_results', 'code_assessment_report',
    'runtime_assertion_sweep', 'repository_reconciliation', 'clientlib_and_media_report'],
  '04-visual-parity': ['readiness_matrix', 'geometry_property_interaction_tables',
    'screenshot_and_diff_index', 'per_instance_scores', 'full_page_scores',
    'component_minima_and_page_composites', 'remediation_history', 'parity_runner'],
  '05-completion-output': ['completion_report', 'pipeline_result_index'],
};

export const REQUIRED_CHECKS = {
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

const TARGET_MODES = ['disabled', 'author'];
const MIN_SCREENSHOT_BYTES = 1024;

// The router is the single source of truth for thresholds; a missing/edited contract fails the gate.
export function readCanonicalContract(routerPath = path.join(promptDir, 'prompt_new.md')) {
  const text = fs.readFileSync(routerPath, 'utf8');
  const breakpoints = text.match(/^required_breakpoints: \[([^\]]+)\]/m);
  const ratio = text.match(/^visual_pass_ratio: "> ([0-9.]+)"/m);
  if (!breakpoints || !ratio) throw new Error(`Canonical run contract not parseable from ${routerPath}`);
  return {
    breakpoints: breakpoints[1].split(',').map((value) => Number(value.trim())),
    ratio: Number(ratio[1]),
  };
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

function resolveArtifact(evidenceDir, target) {
  for (const base of [evidenceDir, repoRoot]) {
    const resolved = path.resolve(base, target);
    if (fs.existsSync(resolved)) return resolved;
  }
  return path.isAbsolute(target) && fs.existsSync(target) ? target : null;
}

// Only strings that clearly name a file are treated as artifact paths, so prose values stay valid.
function looksLikePath(value) {
  return isNonEmptyString(value)
    && /[\\/]/.test(value)
    && /\.[A-Za-z0-9]{2,5}$/.test(value.trim())
    && !/^https?:/i.test(value.trim());
}

function collectArtifactPaths(value, found = []) {
  if (looksLikePath(value)) found.push(value.trim());
  else if (Array.isArray(value)) value.forEach((item) => collectArtifactPaths(item, found));
  else if (isPlainObject(value)) Object.values(value).forEach((item) => collectArtifactPaths(item, found));
  return found;
}

function verifyScoreRow(row, { label, ratioKey, contract, evidenceDir, failures }) {
  const where = `${label}`;
  if (!isPlainObject(row)) {
    failures.push(`${where}: score row is not an object`);
    return null;
  }
  const ratio = row[ratioKey];
  const { matchedPixels, differingPixels, totalPixels } = row;
  for (const [key, value] of Object.entries({ matchedPixels, differingPixels, totalPixels })) {
    if (!Number.isFinite(value) || value < 0) failures.push(`${where}: ${key} must be a non-negative number`);
  }
  if (!Number.isFinite(ratio)) {
    failures.push(`${where}: ${ratioKey} missing or not numeric — a withheld score cannot pass the gate`);
  } else if (!(ratio > contract.ratio)) {
    failures.push(`${where}: ${ratioKey} ${ratio} is not strictly > ${contract.ratio}`);
  }
  if (Number.isFinite(matchedPixels) && Number.isFinite(totalPixels) && totalPixels > 0) {
    if (Math.abs(matchedPixels / totalPixels - ratio) > 1e-9) {
      failures.push(`${where}: ${ratioKey} does not equal matchedPixels/totalPixels`);
    }
    if (Number.isFinite(differingPixels) && matchedPixels + differingPixels !== totalPixels) {
      failures.push(`${where}: matchedPixels + differingPixels !== totalPixels`);
    }
  }
  for (const key of ['sourceUrl', 'targetUrl']) {
    if (!isNonEmptyString(row[key])) failures.push(`${where}: missing ${key}`);
  }
  for (const key of ['sourceScreenshot', 'targetScreenshot', 'sideBySide', 'mask']) {
    const value = row[key];
    if (!isNonEmptyString(value)) {
      failures.push(`${where}: missing ${key}`);
      continue;
    }
    const resolved = resolveArtifact(evidenceDir, value);
    if (!resolved) failures.push(`${where}: ${key} not found on disk (${value})`);
    else if (fs.statSync(resolved).size < MIN_SCREENSHOT_BYTES) {
      failures.push(`${where}: ${key} is implausibly small (${fs.statSync(resolved).size} bytes)`);
    }
  }
  return row;
}

function verifyCoverage(rows, { contract, label, failures, keyOf }) {
  const seen = new Set(rows.map(keyOf));
  for (const breakpoint of contract.breakpoints) {
    for (const mode of TARGET_MODES) {
      const key = `${breakpoint}|${mode}`;
      if (!seen.has(key)) failures.push(`${label}: no score row for breakpoint ${breakpoint} in ${mode} mode`);
    }
  }
}

export function verifyRun(evidenceDir, contract = readCanonicalContract()) {
  const failures = [];
  const statePath = path.join(evidenceDir, 'run-state.json');
  if (!fs.existsSync(statePath)) {
    return { ok: false, failures: [`run-state.json not found at ${statePath} — no ledger means no completed run`] };
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    return { ok: false, failures: [`run-state.json is not valid JSON: ${error.message}`] };
  }

  if (!isNonEmptyString(state.run_id)) failures.push('run-state.json: missing run_id');
  const results = state.stage_results;
  if (!isPlainObject(results)) {
    return { ok: false, failures: [...failures, 'run-state.json: missing stage_results object'] };
  }

  STAGES.forEach((stage, index) => {
    const envelope = results[stage];
    if (!isPlainObject(envelope)) {
      failures.push(`${stage}: no stage result envelope — stage was not executed`);
      return;
    }
    if (envelope.stage !== stage) failures.push(`${stage}: envelope.stage is "${envelope.stage}"`);
    if (!isNonEmptyString(envelope.result_id)) failures.push(`${stage}: missing result_id`);
    if (envelope.run_id !== state.run_id) failures.push(`${stage}: run_id does not match the top-level run_id`);
    if (!Array.isArray(envelope.inputs_consumed)) failures.push(`${stage}: inputs_consumed must be an array`);

    const expectedStatus = index === 4 ? 'COMPLETE' : 'PASS';
    if (envelope.status !== expectedStatus) {
      failures.push(`${stage}: status is "${envelope.status}", required "${expectedStatus}" for a complete run`);
    }
    if (Array.isArray(envelope.failures) && envelope.failures.length > 0) {
      failures.push(`${stage}: envelope reports ${envelope.failures.length} failure(s)`);
    }
    const expectedNext = index === 4 ? null : STAGES[index + 1];
    if ((envelope.next_stage ?? null) !== expectedNext) {
      failures.push(`${stage}: next_stage is "${envelope.next_stage}", expected "${expectedNext}"`);
    }

    const outputs = isPlainObject(envelope.outputs) ? envelope.outputs : {};
    if (!isPlainObject(envelope.outputs)) failures.push(`${stage}: outputs must be an object`);
    for (const key of REQUIRED_OUTPUTS[stage]) {
      const value = outputs[key];
      const empty = value === undefined || value === null || value === ''
        || (Array.isArray(value) && value.length === 0)
        || (isPlainObject(value) && Object.keys(value).length === 0);
      if (empty) failures.push(`${stage}: missing required output "${key}"`);
    }
    for (const target of collectArtifactPaths(outputs)) {
      if (!resolveArtifact(evidenceDir, target)) failures.push(`${stage}: referenced artifact not found (${target})`);
    }

    const checks = Array.isArray(envelope.checks) ? envelope.checks : [];
    if (!Array.isArray(envelope.checks)) failures.push(`${stage}: checks must be an array`);
    const byName = new Map(checks.filter(isPlainObject).map((check) => [check.name, check]));
    for (const name of REQUIRED_CHECKS[stage]) {
      const check = byName.get(name);
      if (!check) failures.push(`${stage}: missing required check "${name}"`);
      else if (check.status !== 'PASS') failures.push(`${stage}: check "${name}" is "${check.status}", not PASS`);
      else if (!isNonEmptyString(check.evidence)) failures.push(`${stage}: check "${name}" has no evidence`);
    }
  });

  const parity = results['04-visual-parity'];
  if (isPlainObject(parity) && isPlainObject(parity.outputs)) {
    const instanceRows = parity.outputs.per_instance_scores;
    if (!Array.isArray(instanceRows) || instanceRows.length === 0) {
      failures.push('04-visual-parity: per_instance_scores must be a non-empty array of score rows');
    } else {
      instanceRows.forEach((row, index) => {
        const label = `04-visual-parity per_instance_scores[${index}]`;
        verifyScoreRow(row, { label, ratioKey: 'visualMatchRatio', contract, evidenceDir, failures });
        if (isPlainObject(row) && !isNonEmptyString(row.instance_id)) failures.push(`${label}: missing instance_id`);
      });
      const byInstance = new Map();
      for (const row of instanceRows.filter(isPlainObject)) {
        if (!byInstance.has(row.instance_id)) byInstance.set(row.instance_id, []);
        byInstance.get(row.instance_id).push(row);
      }
      for (const [instance, rows] of byInstance) {
        verifyCoverage(rows, {
          contract,
          label: `04-visual-parity instance "${instance}"`,
          failures,
          keyOf: (row) => `${row.breakpoint}|${row.mode}`,
        });
      }
    }

    const fullPageRows = parity.outputs.full_page_scores;
    if (!Array.isArray(fullPageRows) || fullPageRows.length === 0) {
      failures.push('04-visual-parity: full_page_scores must be a non-empty array — the independent full-page gate is mandatory');
    } else {
      fullPageRows.forEach((row, index) => verifyScoreRow(row, {
        label: `04-visual-parity full_page_scores[${index}]`,
        ratioKey: 'fullPageVisualMatchRatio',
        contract,
        evidenceDir,
        failures,
      }));
      verifyCoverage(fullPageRows.filter(isPlainObject), {
        contract,
        label: '04-visual-parity full_page_scores',
        failures,
        keyOf: (row) => `${row.breakpoint}|${row.mode}`,
      });
    }
  }

  const completion = results['05-completion-output'];
  if (isPlainObject(completion)) {
    const gaps = completion.residual_gaps ?? completion.outputs?.residual_gaps ?? state.residual_gaps;
    if (!Array.isArray(gaps)) failures.push('05-completion-output: residual_gaps must be an array (use [] when none)');
    else if (gaps.length > 0) failures.push(`05-completion-output: ${gaps.length} residual gap(s) present; COMPLETE requires none`);
    const index = completion.outputs?.pipeline_result_index;
    const ids = Array.isArray(index) ? index : Object.values(index ?? {});
    if (ids.length !== STAGES.length) failures.push('05-completion-output: pipeline_result_index must list all five stage result IDs');
  }

  if (state.process_status && state.process_status !== 'COMPLETE') {
    failures.push(`run-state.json: process_status is "${state.process_status}"`);
  }

  return { ok: failures.length === 0, failures, run_id: state.run_id };
}

function main(argv) {
  const args = argv.filter((value) => value !== '--json');
  const asJson = argv.includes('--json');
  const evidenceDir = args[0];
  if (!evidenceDir) {
    console.error('Usage: node design/site-url/verify-run.mjs <EVIDENCE_DIR> [--json]');
    return 2;
  }
  let result;
  try {
    result = verifyRun(path.resolve(evidenceDir));
  } catch (error) {
    console.error(`verify-run: ${error.message}`);
    return 2;
  }
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`VERIFY-RUN: PASSED — ${evidenceDir} proves a COMPLETE five-stage run (run_id ${result.run_id}).`);
  } else {
    console.error(`VERIFY-RUN: FAILED — ${result.failures.length} blocking problem(s):`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    console.error('\nThis run is NOT complete. Do not report it as a migration success.');
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
