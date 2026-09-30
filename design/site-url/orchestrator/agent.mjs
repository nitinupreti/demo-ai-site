/**
 * Spawns one agent process per role. Every invocation is scoped: its own prompt, its own
 * working directory, and its own result envelope. The orchestrator reads the envelope from
 * disk — an agent's narration is never treated as a verdict.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
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
    shared_defect: {
      type: ['object', 'null'],
      properties: {
        layer: { type: 'string' },
        evidence: { type: 'string' },
      },
    },
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

/**
 * A model call whose response stream stalls is only abandoned by the network stack, which took
 * 68 minutes in a real run. No stream line of any kind for this long means the session is stuck.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Relaunches of one invocation after an interruption; they never count as a rejected attempt. */
export const DEFAULT_INFRA_RETRIES = 2;

// The provider refuses a replayed history in this state, so resuming the same session repeats it.
const HISTORY_REJECTED = /thinking|redacted_thinking|cannot be modified/i;

export function buildArguments({
  promptPath, model, effort, maxContinues, name, sessionId,
}) {
  const list = [
    '-p', `Read and execute the instructions in ${promptPath}`,
    '--output-format', 'json',
    '--stream', 'on',
    '--allow-all',
    '--no-ask-user',
    '--no-remote',
    '--no-remote-export',
    '--no-auto-update',
    // No role uses the GitHub MCP tools, and the repository's AGENTS.md describes the install and
    // deploy workflow every role is forbidden to run.
    '--disable-builtin-mcps',
    '--no-custom-instructions',
    '--deny-tool', 'shell(git reset:*)',
    '--deny-tool', 'shell(git clean:*)',
    '--deny-tool', 'shell(git checkout:*)',
    '--deny-tool', 'shell(git switch:*)',
    '--deny-tool', 'shell(git commit:*)',
    '--deny-tool', 'shell(git push:*)',
    '--deny-tool', 'shell(git stash:*)',
    '--deny-tool', 'shell(git restore:*)',
    // Workers may build their own checkout, but the AEM instance is shared and off limits.
    '--deny-tool', 'shell(mvn install:*)',
    '--deny-tool', 'shell(mvn deploy:*)',
    '--deny-tool', 'shell(mvn clean install:*)',
    '--deny-tool', 'shell(mvn sling:install:*)',
    '--deny-tool', 'shell(mvn package:*)',
  ];
  // A name only applies to a new session; a resumed one keeps the name it started with.
  if (name) list.push('--name', name);
  if (sessionId) list.push('--session-id', sessionId);
  if (model) list.push('--model', model);
  if (effort) list.push('--effort', effort);
  if (maxContinues) list.push('--autopilot', '--max-autopilot-continues', String(maxContinues));
  return list;
}

/** Ends the CLI and everything it started: a killed parent otherwise leaves its shell and Maven running. */
export function killProcessTree(child) {
  if (!child) return;
  if (!child.pid) {
    child.kill?.();
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try { process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => {
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }, 5000).unref?.();
}

function describeInterruption(outcome) {
  if (outcome.stalled) return `no output for ${Math.round(outcome.idleTimeoutMs / 60000)} min, so the session was stopped`;
  const error = outcome.sessionErrors[outcome.sessionErrors.length - 1];
  if (error) return `the session failed: ${error.slice(0, 200)}`;
  return `the agent exited (code ${outcome.exitCode}) without writing its result`;
}

async function launchOnce({
  copilot, args, cwd, env, spawnFn, streamPath, stderrPath, idleTimeoutMs, killFn, renderer, id, onActivity,
}) {
  const startedAt = Date.now();
  let child;
  try {
    child = spawnFn(copilot.executable, args, {
      cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    });
  } catch (error) {
    return {
      exitCode: null, spawnError: error.message, stalled: false, sessionErrors: [], idleTimeoutMs, durationSeconds: 0,
    };
  }

  const rawStream = fs.createWriteStream(streamPath, { flags: 'a' });
  const errorStream = fs.createWriteStream(stderrPath, { flags: 'a' });
  child.stderr?.pipe(errorStream);

  const exitPromise = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }));
    child.once('close', (code) => resolve({ code }));
  });

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let lastLineAt = Date.now();
  let stalled = false;
  const sessionErrors = [];
  const watchdog = idleTimeoutMs > 0
    ? setInterval(() => {
      if (stalled || Date.now() - lastLineAt < idleTimeoutMs) return;
      stalled = true;
      killFn(child);
      // A killed process can leave its pipe open; the stream must end for the loop below to.
      lines.close();
      child.stdout?.destroy?.();
    }, Math.min(15000, Math.max(20, Math.floor(idleTimeoutMs / 4))))
    : null;

  for await (const line of lines) {
    lastLineAt = Date.now();
    rawStream.write(`${line}\n`);
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'session.error') sessionErrors.push(String(event.data?.message || 'session error'));
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

  const exit = await exitPromise;
  if (watchdog) clearInterval(watchdog);
  await Promise.all([
    new Promise((resolve) => { rawStream.end(resolve); }),
    new Promise((resolve) => { errorStream.end(resolve); }),
  ]);
  return {
    exitCode: exit.code,
    spawnError: exit.error?.message || null,
    stalled,
    idleTimeoutMs,
    sessionErrors,
    durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
  };
}

function summarizeTool(block) {
  const input = block.input || {};
  const detail = input.file_path || input.path || input.url || input.query || input.command || input.description || '';
  return String(detail).replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * Runs one role invocation. `prompt` is always the full brief; `followUp`, when given, continues the
 * existing conversation `sessionId` instead of starting one. An interrupted session (stalled
 * stream, provider error, exit without a result) is relaunched in place and never costs an attempt.
 *
 * @param {object} options
 * @param {Function} [options.spawnFn] Injectable for tests; defaults to the real process spawn.
 * @param {Function} [options.killFn] Injectable for tests; defaults to killing the whole process tree.
 */
export async function runAgentRole(options) {
  const {
    copilot, role, id, prompt, followUp = null, cwd, model, effort, maxContinues = 20,
    agentDir, renderer, onActivity, spawnFn = spawn, killFn = killProcessTree,
    sessionId = crypto.randomUUID(), idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    infraRetries = DEFAULT_INFRA_RETRIES, env: extraEnv = {}, gitCeiling = null,
  } = options;

  fs.mkdirSync(agentDir, { recursive: true });
  const promptPath = path.join(agentDir, 'prompt.md');
  const briefPath = path.join(agentDir, 'brief.md');
  const resultPath = path.join(agentDir, 'result.json');
  const streamPath = path.join(agentDir, 'stream.jsonl');
  const stderrPath = path.join(agentDir, 'stderr.log');
  fs.writeFileSync(promptPath, followUp || prompt, 'utf8');
  if (followUp) fs.writeFileSync(briefPath, prompt, 'utf8');
  if (fs.existsSync(resultPath)) fs.rmSync(resultPath);

  const env = {
    ...process.env, ...extraEnv, MIGRATION_ROLE: role, MIGRATION_AGENT_ID: id, MIGRATION_RESULT_PATH: resultPath,
  };
  // Git stops looking here, so a command in a workspace can never reach the repository around it.
  if (gitCeiling) env.GIT_CEILING_DIRECTORIES = gitCeiling;

  const startedAt = Date.now();
  const launches = [];
  let session = sessionId;
  let continuing = Boolean(followUp);
  let messagePath = promptPath;
  for (let index = 0; ; index += 1) {
    const outcome = await launchOnce({
      copilot,
      args: buildArguments({
        promptPath: messagePath,
        model,
        effort,
        maxContinues,
        name: continuing ? null : `aem-${role}-${id}`.slice(0, 60),
        sessionId: session,
      }),
      cwd,
      env,
      spawnFn,
      streamPath,
      stderrPath,
      idleTimeoutMs,
      killFn,
      renderer,
      id,
      onActivity,
    });
    launches.push({
      session_id: session,
      prompt: path.basename(messagePath),
      exit_code: outcome.exitCode,
      stalled: outcome.stalled,
      session_errors: outcome.sessionErrors.slice(-3),
      duration_seconds: outcome.durationSeconds,
    });
    if (fs.existsSync(resultPath) || outcome.spawnError || index >= infraRetries) {
      if (outcome.spawnError) launches[launches.length - 1].spawn_error = outcome.spawnError;
      break;
    }

    const reason = describeInterruption(outcome);
    const fresh = outcome.sessionErrors.some((message) => HISTORY_REJECTED.test(message));
    renderer?.warn(`[${id}] ${reason}; ${fresh ? 'restarting in a new session' : 'resuming the session'}`
      + ` (${index + 1}/${infraRetries})`);
    messagePath = path.join(agentDir, `prompt-continue-${index + 1}.md`);
    if (fresh) {
      session = crypto.randomUUID();
      continuing = false;
      fs.writeFileSync(messagePath, [
        prompt,
        ...(followUp ? ['', followUp] : []),
        '',
        '## A previous session was interrupted',
        '',
        `It ended because ${reason}. Its edits are still in your working directory: inspect them and`,
        'continue from there rather than starting over.',
        `Write your result to \`${resultPath}\`.`,
      ].join('\n'), 'utf8');
    } else {
      continuing = true;
      fs.writeFileSync(messagePath, [
        `Your session was interrupted: ${reason}.`,
        'Everything you wrote is still in your working directory. Continue the same task from where',
        `you stopped, then write your result to \`${resultPath}\`.`,
      ].join('\n'), 'utf8');
    }
  }

  const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
  // A lower bound: each stopped launch had been silent for at least the idle timeout.
  const stalledSeconds = Number(((launches.filter((entry) => entry.stalled).length * idleTimeoutMs) / 1000).toFixed(2));
  const last = launches[launches.length - 1];
  const reliability = {
    sessionId: session, launches, relaunches: launches.length - 1, stalledSeconds,
  };
  if (!fs.existsSync(resultPath)) {
    return {
      id,
      role,
      status: 'FAIL',
      exitCode: last?.exit_code ?? null,
      durationSeconds,
      resultPath,
      infrastructure: true,
      error: last?.spawn_error
        ? `the agent could not be started: ${last.spawn_error}`
        : `agent produced no result.json after ${launches.length} launch(es) (last exit ${last?.exit_code ?? 'none'}`
          + `${last?.session_errors?.length ? `; ${last.session_errors[last.session_errors.length - 1].slice(0, 160)}` : ''})`,
      ...reliability,
    };
  }

  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (error) {
    return {
      id, role, status: 'FAIL', exitCode: last?.exit_code ?? null, durationSeconds, resultPath,
      error: `result.json is not valid JSON: ${error.message}`, ...reliability,
    };
  }

  const verdict = evaluateEnvelope(envelope, role, options.componentId || id);
  if (verdict.normalized?.length) {
    renderer?.note(`[${id}] envelope normalized: ${verdict.normalized.join(', ')}`);
  }
  return {
    id, role, exitCode: last?.exit_code ?? null, durationSeconds, resultPath, result: verdict.envelope, ...verdict, ...reliability,
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
