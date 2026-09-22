/**
 * Spawns one agent process per role. Every invocation is scoped: its own prompt, its own
 * working directory, and its own result envelope. The orchestrator reads the envelope from
 * disk — an agent's narration is never treated as a verdict.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { validate } from './schema.mjs';

const RESULT_SCHEMA = {
  type: 'object',
  required: ['role', 'status', 'checks'],
  properties: {
    role: { type: 'string' },
    component_id: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] },
    checks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'status'],
        properties: {
          name: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] },
          evidence: { type: 'string' },
        },
      },
    },
    contributions: { type: 'object' },
    focused_test: { type: 'object' },
    changed_files: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

const STATUS_SYNONYMS = { PASSED: 'PASS', OK: 'PASS', SUCCESS: 'PASS', FAILED: 'FAIL', ERROR: 'FAIL' };

function normalizeStatus(value) {
  if (typeof value !== 'string') return value;
  const upper = value.trim().toUpperCase();
  return STATUS_SYNONYMS[upper] || upper;
}

/**
 * The orchestrator already knows the role and component, so it supplies them rather than
 * failing work over a field name. Every substitution is recorded, never silent.
 */
export function normalizeEnvelope(raw, { role, componentId } = {}) {
  const envelope = { ...raw };
  const applied = [];

  if (!envelope.role && role) {
    envelope.role = role;
    applied.push('role supplied by the orchestrator');
  }
  for (const alias of ['verdict', 'result', 'outcome']) {
    if (!envelope.status && envelope[alias] !== undefined) {
      envelope.status = envelope[alias];
      applied.push(`${alias} -> status`);
      break;
    }
  }
  if (!envelope.component_id) {
    const alias = envelope.component || envelope.componentId || componentId;
    if (alias) {
      envelope.component_id = alias;
      applied.push('component_id resolved');
    }
  }
  if (typeof envelope.status === 'string') envelope.status = normalizeStatus(envelope.status);
  if (Array.isArray(envelope.checks)) {
    envelope.checks = envelope.checks.map((check) => {
      if (!check || typeof check !== 'object') return check;
      const status = check.status ?? check.verdict ?? check.result;
      return { ...check, status: normalizeStatus(status) };
    });
  }
  return { envelope, applied };
}

export const ROLE_REQUIRED_CHECKS = {
  planner: ['every_instance_claimed', 'ownership_disjoint', 'chrome_uses_experience_fragments'],
  foundations: ['tokens_defined', 'template_and_policy_ready'],
  component: ['dialog_authorable', 'model_and_htl_complete', 'focused_test_declared', 'contributions_declared'],
  remediation: ['diagnosis_recorded', 'hypothesis_applied'],
};

function buildArguments({ promptPath, model, effort, maxContinues, name }) {
  const list = [
    '-p', `Read and execute the instructions in ${promptPath}`,
    '--output-format', 'json',
    '--stream', 'on',
    '--allow-all',
    '--no-ask-user',
    '--no-remote',
    '--no-remote-export',
    '--no-auto-update',
    '--name', name,
    '--deny-tool', 'shell(git reset:*)',
    '--deny-tool', 'shell(git clean:*)',
    '--deny-tool', 'shell(git checkout:*)',
    '--deny-tool', 'shell(git switch:*)',
    '--deny-tool', 'shell(git commit:*)',
    '--deny-tool', 'shell(git push:*)',
  ];
  if (model) list.push('--model', model);
  if (effort) list.push('--effort', effort);
  if (maxContinues) list.push('--autopilot', '--max-autopilot-continues', String(maxContinues));
  return list;
}

function summarizeTool(block) {
  const input = block.input || {};
  const detail = input.file_path || input.path || input.url || input.query || input.command || input.description || '';
  return String(detail).replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * @param {object} options
 * @param {Function} [options.spawnFn] Injectable for tests; defaults to the real process spawn.
 */
export async function runAgentRole(options) {
  const {
    copilot, role, id, prompt, cwd, model, effort, maxContinues = 20,
    agentDir, renderer, onActivity, spawnFn = spawn,
  } = options;

  fs.mkdirSync(agentDir, { recursive: true });
  const promptPath = path.join(agentDir, 'prompt.md');
  const resultPath = path.join(agentDir, 'result.json');
  const streamPath = path.join(agentDir, 'stream.jsonl');
  const stderrPath = path.join(agentDir, 'stderr.log');
  fs.writeFileSync(promptPath, prompt, 'utf8');
  if (fs.existsSync(resultPath)) fs.rmSync(resultPath);

  const startedAt = Date.now();
  const child = spawnFn(copilot.executable, buildArguments({
    promptPath, model, effort, maxContinues, name: `aem-${role}-${id}`.slice(0, 60),
  }), {
    cwd,
    env: { ...process.env, MIGRATION_ROLE: role, MIGRATION_AGENT_ID: id, MIGRATION_RESULT_PATH: resultPath },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const rawStream = fs.createWriteStream(streamPath, { flags: 'a' });
  const errorStream = fs.createWriteStream(stderrPath, { flags: 'a' });
  child.stderr.pipe(errorStream);

  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    rawStream.write(`${line}\n`);
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const requests = event.type === 'assistant.message' ? event.data?.toolRequests || [] : [];
    for (const request of requests) {
      const detail = summarizeTool({
        name: request.name || request.toolName || 'tool',
        input: request.arguments || request.input || {},
      });
      renderer?.activity(request.name || 'tool', `[${id}] ${detail}`);
      onActivity?.(detail);
    }
  }

  const exitCode = await exitPromise;
  rawStream.end();
  errorStream.end();

  const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
  if (!fs.existsSync(resultPath)) {
    return {
      id, role, status: 'FAIL', exitCode, durationSeconds, resultPath,
      error: `agent produced no result.json (exit ${exitCode})`,
    };
  }

  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (error) {
    return { id, role, status: 'FAIL', exitCode, durationSeconds, resultPath, error: `result.json is not valid JSON: ${error.message}` };
  }

  const verdict = evaluateEnvelope(envelope, role, options.componentId || id);
  if (verdict.normalized?.length) {
    renderer?.note(`[${id}] envelope normalized: ${verdict.normalized.join(', ')}`);
  }
  return {
    id, role, exitCode, durationSeconds, resultPath, result: verdict.envelope, ...verdict,
  };
}

/** A role's verdict is the envelope's own checks, not its claimed status. */
export function evaluateEnvelope(rawEnvelope, role, componentId) {
  const { envelope, applied } = normalizeEnvelope(rawEnvelope, { role, componentId });
  const schemaErrors = validate(envelope, RESULT_SCHEMA);
  if (schemaErrors.length) {
    const keys = Object.keys(rawEnvelope || {}).join(', ') || 'none';
    return {
      status: 'FAIL',
      envelope,
      normalized: applied,
      error: `invalid result envelope (${schemaErrors.slice(0, 3).join('; ')}). `
        + `Top-level keys found: ${keys}. Required: role, status (PASS|FAIL|BLOCKED), checks[] with name and status.`,
    };
  }
  const required = ROLE_REQUIRED_CHECKS[role] || [];
  const present = new Set(envelope.checks.map((check) => check.name));
  const missing = required.filter((name) => !present.has(name));
  if (missing.length) {
    return {
      status: 'FAIL',
      envelope,
      normalized: applied,
      error: `missing required checks: ${missing.join(', ')}. Checks provided: ${[...present].join(', ') || 'none'}.`,
    };
  }
  const failed = envelope.checks.filter((check) => check.status !== 'PASS');
  if (envelope.status === 'PASS' && failed.length) {
    return {
      status: 'FAIL',
      envelope,
      normalized: applied,
      error: `claimed PASS with failing checks: ${failed.map((check) => check.name).join(', ')}`,
    };
  }
  return { status: envelope.status, envelope, normalized: applied };
}
