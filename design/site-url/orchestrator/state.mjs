/**
 * run-state.json is owned by the launcher. Agents report progress on stdout and write
 * stage envelopes to <EVIDENCE_DIR>/stages/<stage>.json; only this module mutates state,
 * so stage status, timing and check results cannot be self-reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from './schema.mjs';

const schemaDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'schemas');
const runStateSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'run-state.schema.json'), 'utf8'));
const stageResultSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'stage-result.schema.json'), 'utf8'));

export const SCHEMA_VERSION = 2;

const TERMINAL_STAGE_STATUS = new Set(['PASS', 'FAIL', 'BLOCKED', 'COMPLETE']);

function writeAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function seconds(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  return Number(((Date.parse(toIso) - Date.parse(fromIso)) / 1000).toFixed(2));
}

export function createRunState(statePath, { runId, launcher, inputs, stageIds }) {
  const state = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    status: 'INITIALIZED',
    current_stage: null,
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
    duration_seconds: null,
    target_url: null,
    launcher,
    inputs,
    stages: stageIds.map((stage) => ({
      stage,
      status: 'PENDING',
      message: null,
      started_at: null,
      ended_at: null,
      duration_seconds: null,
      result_path: null,
      checks: [],
    })),
    components: [],
    timings: { phases: {} },
    events: [],
    stage_results: {},
  };
  const errors = validate(state, runStateSchema);
  if (errors.length) throw new Error(`Generated run state is invalid:\n  - ${errors.join('\n  - ')}`);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeAtomic(statePath, state);
  return state;
}

export function readRunState(statePath) {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

export function markRunStarted(statePath) {
  const state = readRunState(statePath);
  state.status = 'RUNNING';
  state.started_at = state.started_at || new Date().toISOString();
  writeAtomic(statePath, state);
  return state;
}

/**
 * Applies one MIGRATION_PROGRESS line. The agent supplies the stage id and a claim;
 * the launcher decides what is recorded and stamps all timing.
 */
export function applyProgress(statePath, progress) {
  const state = readRunState(statePath);
  const now = new Date().toISOString();
  const entry = state.stages.find((stage) => stage.stage === progress.stage);
  if (!entry) {
    state.events.push({ at: now, type: 'UNKNOWN_STAGE_PROGRESS', stage: progress.stage, status: progress.status });
    writeAtomic(statePath, state);
    return state;
  }

  const status = String(progress.status || '').toUpperCase();
  if (status === 'STARTED') {
    entry.status = 'STARTED';
    entry.started_at = entry.started_at || now;
    state.current_stage = entry.stage;
  } else if (TERMINAL_STAGE_STATUS.has(status)) {
    entry.status = status;
    entry.ended_at = now;
    entry.duration_seconds = seconds(entry.started_at, now);
    state.current_stage = entry.stage;
  }
  if (progress.message) entry.message = String(progress.message).slice(0, 400);
  if (progress.component) recordComponent(state, progress.component, status, entry.stage);
  state.events.push({ at: now, type: 'STAGE_PROGRESS', stage: entry.stage, status, component: progress.component || null });
  state.timings.phases[entry.stage] = {
    started_at: entry.started_at,
    ended_at: entry.ended_at,
    duration_seconds: entry.duration_seconds,
  };
  writeAtomic(statePath, state);
  return state;
}

function recordComponent(state, id, status, stage) {
  state.components = state.components || [];
  let component = state.components.find((entry) => entry.id === id);
  if (!component) {
    component = {
      id, stage, status: 'PENDING', started_at: null, ended_at: null, duration_seconds: null, activity: 0,
    };
    state.components.push(component);
  }
  const now = new Date().toISOString();
  if (status === 'STARTED') {
    component.status = 'STARTED';
    component.started_at = component.started_at || now;
    component.stage = stage;
  } else if (TERMINAL_STAGE_STATUS.has(status)) {
    component.status = status;
    component.ended_at = now;
    component.duration_seconds = seconds(component.started_at, now);
  }
  return component;
}

/** Records observed activity against a component even when the agent never declared it. */
export function touchComponent(statePath, id, stage) {
  const state = readRunState(statePath);
  const component = recordComponent(state, id, 'STARTED', stage);
  component.activity += 1;
  writeAtomic(statePath, state);
  return state;
}

/**
 * Reads stage envelopes written by agents, validates them, and records the verdict.
 * An envelope that fails validation is retained as evidence and marked FAIL.
 */
export function ingestStageResults(statePath, stagesDir) {
  const state = readRunState(statePath);
  const ingested = [];
  if (!fs.existsSync(stagesDir)) {
    writeAtomic(statePath, state);
    return { state, ingested };
  }

  for (const entry of state.stages) {
    const resultPath = path.join(stagesDir, `${entry.stage}.json`);
    if (!fs.existsSync(resultPath)) continue;

    let envelope;
    try {
      envelope = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    } catch (error) {
      entry.status = 'FAIL';
      entry.message = `stage envelope is not valid JSON: ${error.message}`;
      entry.result_path = resultPath;
      ingested.push({ stage: entry.stage, status: 'FAIL', reason: entry.message });
      continue;
    }

    const errors = validate(envelope, stageResultSchema);
    const wrongRun = envelope.run_id && envelope.run_id !== state.run_id;
    if (errors.length || wrongRun) {
      entry.status = 'FAIL';
      entry.message = wrongRun
        ? `stage envelope belongs to run ${envelope.run_id}`
        : `stage envelope is invalid: ${errors.slice(0, 4).join('; ')}`;
      entry.result_path = resultPath;
      entry.checks = Array.isArray(envelope.checks) ? envelope.checks : [];
      state.stage_results[entry.stage] = envelope;
      ingested.push({ stage: entry.stage, status: 'FAIL', reason: entry.message });
      continue;
    }

    const failedChecks = envelope.checks.filter((check) => check.status !== 'PASS');
    entry.status = failedChecks.length && envelope.status === 'PASS' ? 'FAIL' : envelope.status;
    entry.message = failedChecks.length && envelope.status === 'PASS'
      ? `envelope claimed PASS with failing checks: ${failedChecks.map((check) => check.name).join(', ')}`
      : entry.message;
    entry.result_path = resultPath;
    entry.checks = envelope.checks;
    state.stage_results[entry.stage] = envelope;
    ingested.push({ stage: entry.stage, status: entry.status });
  }

  writeAtomic(statePath, state);
  return { state, ingested };
}

export function finalizeRunState(statePath, { status, targetUrl } = {}) {
  const state = readRunState(statePath);
  const now = new Date().toISOString();
  state.ended_at = now;
  state.duration_seconds = seconds(state.started_at || state.created_at, now);
  if (targetUrl) state.target_url = targetUrl;

  const stageStatuses = state.stages.map((stage) => stage.status);
  if (status) {
    state.status = status;
  } else if (stageStatuses.includes('BLOCKED')) {
    state.status = 'BLOCKED';
  } else if (stageStatuses.includes('FAIL')) {
    state.status = 'FAIL';
  } else if (stageStatuses.every((value) => value === 'PASS' || value === 'COMPLETE')) {
    state.status = 'COMPLETE';
  } else {
    state.status = 'INTERRUPTED';
  }

  state.timings.total_seconds = state.duration_seconds;
  state.timings.stages = Object.fromEntries(state.stages.map((stage) => [stage.stage, stage.duration_seconds]));
  writeAtomic(statePath, state);
  return state;
}

export function summarize(state) {
  return {
    status: state.status,
    duration_seconds: state.duration_seconds,
    components: (state.components || []).map((component) => ({
      id: component.id,
      status: component.status,
      duration_seconds: component.duration_seconds,
      activity: component.activity,
    })),
    stages: state.stages.map((stage) => ({
      stage: stage.stage,
      status: stage.status,
      duration_seconds: stage.duration_seconds,
      failing_checks: (stage.checks || []).filter((check) => check.status !== 'PASS').map((check) => check.name),
    })),
  };
}
