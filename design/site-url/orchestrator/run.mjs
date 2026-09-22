#!/usr/bin/env node
/**
 * Multi-agent orchestrator. Deterministic code owns the phase graph, the locks, the ledger and
 * every verdict; agents only do judgement work inside scopes this file hands them.
 *
 *   node design/site-url/orchestrator/run.mjs --url <live-url> --aem-port 4506
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runAgentRole } from './agent.mjs';
import { createRenderer } from './console.mjs';
import { applyContributions } from './contributions.mjs';
import { focusedTestPlan, planDeployment, runDeployment } from './deploy.mjs';
import { planSummary, validatePlan } from './plan.mjs';
import {
  advanceRound, applyParity, createLedger, ledgerSnapshot, recordAttempt, routeFailures, terminalStatus,
} from './remediation.mjs';
import { buildReport, writeReport } from './report.mjs';
import { collectChanges, createWorkspace, mergeChanges, removeWorkspace } from './workspaces.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteUrlDir = path.dirname(here);
const defaultRepoRoot = path.resolve(siteUrlDir, '../..');
const promptsDir = path.join(siteUrlDir, 'prompts');
const toolsDir = path.join(siteUrlDir, 'tools');

const PHASES = ['discover', 'plan', 'foundations', 'fanout', 'compose', 'deploy', 'parity', 'remediation', 'report'];

/** Single source of truth for run defaults, shared by the CLI and direct orchestrate() calls. */
export const DEFAULTS = Object.freeze({
  aemHost: 'localhost',
  aemPort: 4502,
  aemUser: 'admin',
  breakpoints: [375, 768, 1440],
  maxParallel: 4,
  componentAttempts: 4,
  threshold: 0.9,
  planRepairs: 2,
});

function readPrompt(name) {
  return fs.readFileSync(path.join(promptsDir, name), 'utf8');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function parseArgs(argv) {
  const options = {
    ...DEFAULTS,
    breakpoints: [...DEFAULTS.breakpoints],
    aemHost: process.env.AEM_HOST || DEFAULTS.aemHost,
    aemPort: Number.parseInt(process.env.AEM_PORT || String(DEFAULTS.aemPort), 10),
    aemUser: process.env.AEM_USER || DEFAULTS.aemUser,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--url': options.siteUrl = value; index += 1; break;
      case '--target-path': options.targetPath = value; index += 1; break;
      case '--aem-host': options.aemHost = value; index += 1; break;
      case '--aem-port': options.aemPort = Number.parseInt(value, 10); index += 1; break;
      case '--aem-user': options.aemUser = value; index += 1; break;
      case '--breakpoints': options.breakpoints = value.split(',').map((entry) => Number.parseInt(entry.trim(), 10)); index += 1; break;
      case '--max-parallel': options.maxParallel = Number.parseInt(value, 10); index += 1; break;
      case '--component-attempts': options.componentAttempts = Number.parseInt(value, 10); index += 1; break;
      case '--visual-pass-ratio': options.threshold = Number.parseFloat(value); index += 1; break;
      case '--evidence-dir': options.evidenceDir = value; index += 1; break;
      case '--model': options.model = value; index += 1; break;
      case '--effort': options.effort = value; index += 1; break;
      case '--dry-run': options.dryRun = true; break;
      case '--help': options.help = true; break;
      default:
        if (!flag.startsWith('--') && !options.siteUrl) options.siteUrl = flag;
        else throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return options;
}

/** Runs tasks with a bounded pool; this is the only place real parallelism happens. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function orchestrate(rawOptions, services) {
  const {
    copilot, renderer, runId, evidenceDir, runTool, spawnFn, execFn,
  } = services;
  const repoRoot = services.repoRoot || defaultRepoRoot;
  // orchestrate() is called directly by tests as well as by the CLI, so defaults live here.
  const options = { ...DEFAULTS, ...rawOptions };

  const phases = [];
  const invocations = [];
  /** Every agent process is timed so the report can attribute the run's wall clock. */
  const track = (invocation, extra = {}) => {
    invocations.push({
      role: invocation.role,
      id: invocation.id,
      status: invocation.status,
      duration_seconds: invocation.durationSeconds ?? null,
      ...extra,
    });
    return invocation;
  };
  const startPhase = (name) => {
    const entry = { name, status: 'RUNNING', started_at: Date.now() };
    phases.push(entry);
    renderer.stageStarted(name);
    return entry;
  };
  const endPhase = (entry, status, message) => {
    entry.status = status;
    entry.duration_seconds = Number(((Date.now() - entry.started_at) / 1000).toFixed(2));
    renderer.stageFinished(entry.name, status, message);
    return entry;
  };

  const state = {
    run_id: runId,
    inputs: {
      SITE_URL: options.siteUrl,
      AEM_HOST: options.aemHost,
      AEM_PORT: options.aemPort,
      BREAKPOINTS: options.breakpoints,
      VISUAL_PASS_RATIO: options.threshold,
    },
    started_at: Date.now(),
  };

  // 1. Discovery — deterministic, no model.
  let phase = startPhase('discover');
  const discoveryDir = path.join(evidenceDir, 'discovery');
  const discoveryResult = await runTool('discover', [
    path.join(toolsDir, 'discover.mjs'),
    '--url', options.siteUrl,
    '--out', discoveryDir,
    '--breakpoints', options.breakpoints.join(','),
    '--run-id', runId,
  ]);
  if (discoveryResult.code !== 0) {
    endPhase(phase, 'FAIL', 'discovery tool failed');
    return { status: 'FAIL', phases, state };
  }
  const discovery = JSON.parse(fs.readFileSync(path.join(discoveryDir, 'discovery.json'), 'utf8'));
  endPhase(phase, 'PASS', `${discovery.instances.length} instances, fingerprint ${discovery.source_fingerprint.slice(0, 20)}`);

  // 2. Planning — one sequential agent, bounded repairs, orchestrator-owned gate.
  phase = startPhase('plan');
  const planPath = path.join(evidenceDir, 'plan.json');
  let plan = null;
  let gate = null;
  let feedback = '';
  for (let attempt = 1; attempt <= options.planRepairs + 1 && !plan; attempt += 1) {
    const agentDir = path.join(evidenceDir, 'agents', `planner-${attempt}`);
    const task = [
      readPrompt('_contract.md'), '', readPrompt('planner.md'), '',
      '## Task', '',
      `- run_id: \`${runId}\``,
      `- discovery: \`${path.relative(repoRoot, path.join(discoveryDir, 'discovery.json'))}\``,
      `- source_fingerprint: \`${discovery.source_fingerprint}\``,
      `- breakpoints: ${options.breakpoints.join(', ')}`,
      `- write plan to: \`${path.relative(repoRoot, planPath)}\``,
      `- write result to: \`${path.relative(repoRoot, path.join(agentDir, 'result.json'))}\``,
      feedback,
    ].join('\n');

    const invocation = await runAgentRole({
      copilot, role: 'planner', id: `planner-${attempt}`, prompt: task, cwd: repoRoot,
      model: options.model, effort: options.effort, agentDir, renderer, spawnFn,
    });
    track(invocation, { phase: 'plan', attempt });
    if (invocation.status !== 'PASS' || !fs.existsSync(planPath)) {
      feedback = `\n## Previous attempt rejected\n\n${invocation.error || 'no plan.json was written'}\n`;
      continue;
    }
    const candidate = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    gate = validatePlan(candidate, { discovery, runId });
    if (gate.valid) plan = candidate;
    else feedback = `\n## Previous plan rejected by the gate\n\n- ${gate.errors.join('\n- ')}\n`;
  }
  if (!plan) {
    endPhase(phase, 'FAIL', gate ? gate.errors.slice(0, 3).join('; ') : 'planner produced no valid plan');
    return { status: 'FAIL', phases, state, plan: null };
  }
  const summary = planSummary(plan, gate.waves);
  renderer.setKnownComponents?.(plan.components.map((component) => component.id));
  endPhase(phase, 'PASS', `${summary.components} components, ${summary.waves.length} waves, chrome via XF: ${summary.chrome.join(', ') || 'none'}`);

  // 3. Foundations — serialized; the only writer of shared design files.
  phase = startPhase('foundations');
  const foundationsDir = path.join(evidenceDir, 'agents', 'foundations');
  const foundations = await runAgentRole({
    copilot,
    role: 'foundations',
    id: 'foundations',
    prompt: [
      readPrompt('_contract.md'), '', readPrompt('foundations.md'), '',
      '## Task', '',
      `- plan: \`${path.relative(repoRoot, planPath)}\``,
      `- discovery: \`${path.relative(repoRoot, path.join(discoveryDir, 'discovery.json'))}\``,
      `- chrome fragments: ${plan.components.filter((c) => c.role === 'chrome').map((c) => c.contribution.path).join(', ') || 'none'}`,
      `- write result to: \`${path.relative(repoRoot, path.join(foundationsDir, 'result.json'))}\``,
    ].join('\n'),
    cwd: repoRoot,
    model: options.model,
    effort: options.effort,
    agentDir: foundationsDir,
    renderer,
    spawnFn,
  });
  track(foundations, { phase: 'foundations' });
  if (foundations.status !== 'PASS') {
    endPhase(phase, 'FAIL', foundations.error || 'foundations failed');
    return { status: 'FAIL', phases, state, plan };
  }
  endPhase(phase, 'PASS', 'tokens, template and policies ready');

  // 4. Fan-out — parallel component workers, one isolated checkout each.
  phase = startPhase('fanout');
  const byId = new Map(plan.components.map((component) => [component.id, component]));
  const claimed = new Map();
  const workerResults = [];
  let fanoutFailed = false;

  for (const [waveIndex, wave] of gate.waves.entries()) {
    renderer.note(`wave ${waveIndex + 1}/${gate.waves.length}: ${wave.join(', ')}`);
    const waveResults = await pool(wave, options.maxParallel, async (componentId) => {
      const component = byId.get(componentId);
      renderer.componentStarted(componentId, `tier ${component.tier}${component.role === 'chrome' ? ' · XF chrome' : ''}`);
      const maxAttempts = options.componentAttempts;
      const history = [];
      let feedback = '';

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {        const workspaceRoot = path.join(evidenceDir, 'workspaces', `${componentId}-attempt-${attempt}`);
        const workspace = createWorkspace(repoRoot, workspaceRoot, options.workspace);
        workspace.id = componentId;
        const agentDir = path.join(evidenceDir, 'agents', `component-${componentId}-attempt-${attempt}`);

        // A worker copy is large; it must be removed whatever the outcome.
        try {
          const invocation = await runAgentRole({
            copilot,
            role: 'component',
            id: componentId,
            componentId,
            prompt: [
              readPrompt('_contract.md'), '', readPrompt('component.md'), '',
              '## Task', '',
              '```json',
              JSON.stringify({
                component,
                breakpoints: options.breakpoints,
                evidence_slice: path.relative(repoRoot, path.join(discoveryDir, 'discovery.json')),
                result_path: path.relative(repoRoot, path.join(agentDir, 'result.json')),
              }, null, 2),
              '```',
              feedback,
            ].join('\n'),
            cwd: workspaceRoot,
            model: options.model,
            effort: options.effort,
            agentDir,
            renderer,
            spawnFn,
          });
          track(invocation, {
            phase: 'fanout', component_id: componentId, wave: waveIndex + 1, attempt,
          });
          history.push({ attempt, status: invocation.status, duration_seconds: invocation.durationSeconds });

          const changes = collectChanges(workspace, component.owned_paths);
          let rejection = null;

          if (!changes.valid) {
            rejection = `Your changes touched files outside your scope: ${changes.violations.slice(0, 8).join(', ')}.\n`
              + `You may only write: ${component.owned_paths.join(', ')}.\n`
              + 'Shared files are declared through the `contributions` block, never edited directly.';
          } else if (invocation.status === 'BLOCKED') {
            // An external prerequisite will not resolve by asking again.
            renderer.componentFinished(componentId, 'BLOCKED');
            return {
              component_id: componentId,
              status: 'BLOCKED',
              invocation,
              attempts: attempt,
              history,
              duration_seconds: invocation.durationSeconds,
              error: invocation.result?.notes || invocation.error || 'agent reported an external blocker',
            };
          } else if (invocation.status !== 'PASS') {
            const failing = (invocation.result?.checks || [])
              .filter((check) => check.status !== 'PASS')
              .map((check) => `${check.name}: ${check.evidence || 'no evidence given'}`);
            rejection = invocation.error
              || `Your result reported ${invocation.status}. Failing checks: ${failing.join('; ') || 'none recorded'}.`;
          } else {
            const merged = mergeChanges(workspace, repoRoot, changes, claimed);
            if (merged.conflicts.length) {
              rejection = `Another component already owns ${merged.conflicts.map((entry) => `${entry.path} (${entry.owner})`).join(', ')}. `
                + 'Keep your changes inside your own scope and declare shared content through `contributions`.';
            } else {
              renderer.componentFinished(componentId, 'PASS');
              return {
                component_id: componentId,
                status: 'PASS',
                invocation,
                attempts: attempt,
                history,
                duration_seconds: invocation.durationSeconds,
                result: invocation.result,
                applied: merged.applied,
              };
            }
          }

          history[history.length - 1].rejection = rejection;
          if (attempt < maxAttempts) {
            renderer.warn(`${componentId} attempt ${attempt}/${maxAttempts} rejected: ${rejection.split('\n')[0]}`);
            feedback = [
              '', `## Attempt ${attempt} of ${maxAttempts} was rejected`, '',
              rejection, '',
              'Fix exactly this, then write your result again. Do not repeat the rejected approach,',
              'and do not start from your previous attempt — this is a fresh checkout of the repository.',
            ].join('\n');
          } else {
            renderer.componentFinished(componentId, 'FAIL');
            return {
              component_id: componentId,
              status: 'FAIL',
              invocation,
              attempts: attempt,
              history,
              duration_seconds: invocation.durationSeconds,
              error: `exhausted ${maxAttempts} attempts; last rejection: ${rejection}`,
            };
          }
        } finally {
          removeWorkspace(workspaceRoot);
        }
      }
      return { component_id: componentId, status: 'FAIL', attempts: maxAttempts, history, error: 'no attempt produced a result' };
    });
    workerResults.push(...waveResults);
    if (waveResults.some((entry) => entry.status !== 'PASS')) {
      fanoutFailed = true;
      break;
    }
  }
  if (fanoutFailed) {
    const broken = workerResults.filter((entry) => entry.status !== 'PASS');
    endPhase(phase, 'FAIL', broken.map((entry) => `${entry.component_id}: ${entry.error}`).join('; '));
    return { status: 'FAIL', phases, state, plan, workerResults };
  }
  endPhase(phase, 'PASS', `${workerResults.length} components built across ${gate.waves.length} waves`);

  // 5. Compose — the orchestrator writes every shared file.
  phase = startPhase('compose');
  const composed = applyContributions({ repoRoot, plan, results: workerResults.map((entry) => entry.result) });
  if (composed.conflicts.length) {
    endPhase(phase, 'FAIL', composed.conflicts.map((entry) => `${entry.kind}:${entry.target || entry.property}`).join('; '));
    return { status: 'FAIL', phases, state, plan, conflicts: composed.conflicts };
  }
  endPhase(phase, 'PASS', `${composed.written.length} shared files composed`);

  // 6. Deploy — exclusive, deterministic.
  const changedFiles = workerResults.flatMap((entry) => entry.applied || [])
    .concat(composed.written.map((file) => path.relative(repoRoot, file)));
  phase = startPhase('deploy');
  const steps = [focusedTestPlan(workerResults), ...planDeployment(changedFiles, options.aemPort)].filter(Boolean);
  const deployment = await runDeployment({
    repoRoot, steps, renderer, execFn, logPath: path.join(evidenceDir, 'deploy.log'), writeLog: fs.appendFileSync,
  });
  writeJson(path.join(evidenceDir, 'deployment.json'), deployment);
  if (deployment.status !== 'PASS') {
    endPhase(phase, 'FAIL', `${deployment.failure.step} exited ${deployment.failure.exit_code}`);
    return { status: 'FAIL', phases, state, plan, deployment };
  }
  endPhase(phase, 'PASS', `${deployment.executed.length} steps`);

  // 7. Parity + 8. bounded remediation.
  const targetUrl = options.targetPath
    ? `http://${options.aemHost}:${options.aemPort}${options.targetPath}.html?wcmmode=disabled`
    : null;
  const parityDir = path.join(evidenceDir, 'parity');
  const parityConfigPath = path.join(parityDir, 'parity-config.json');
  writeJson(parityConfigPath, {
    run_id: runId,
    source_url: discovery.source.final_url,
    targets: [{ mode: 'disabled', url: targetUrl }],
    breakpoints: options.breakpoints,
    threshold: options.threshold,
    auth: { username: options.aemUser || 'admin', password_env: 'AEM_PASSWORD' },
    components: plan.components.flatMap((component) => component.parity_targets.map((target) => ({
      id: component.id,
      source: target.source,
      target: target.target,
      signature_text: target.signature_text || null,
      visibility_by_bp: component.visibility_by_bp || {},
    }))),
  });

  const runParity = async (cycle) => {
    const outcome = await runTool('parity', [
      path.join(toolsDir, 'parity.mjs'), '--config', parityConfigPath, '--out', parityDir, '--cycle', String(cycle),
    ]);
    const artefact = JSON.parse(fs.readFileSync(path.join(parityDir, 'parity.json'), 'utf8'));
    fs.copyFileSync(path.join(parityDir, 'parity.json'), path.join(parityDir, `parity-cycle-${cycle}.json`));
    return { artefact, code: outcome.code };
  };

  phase = startPhase('parity');
  let cycle = 0;
  let parity = (await runParity(cycle)).artefact;
  const ledger = createLedger(plan.components.map((component) => component.id));
  applyParity(ledger, parity);
  endPhase(phase, parity.status, `${parity.summary.components_passed}/${parity.summary.components_total} components, min ${(parity.summary.min_ratio * 100 || 0).toFixed(2)}%`);

  phase = startPhase('remediation');
  let rounds = 0;
  while (parity.status !== 'PASS' && rounds < 8) {
    const progress = advanceRound(ledger);
    if (progress.done) break;
    const routed = routeFailures(parity, plan, ledger);
    if (!routed.batches.length) break;
    rounds += 1;

    for (const batch of [...routed.serialized, ...routed.parallel]) {
      renderer.note(`round ${ledger.round} | ${batch.scope} batch | ${batch.layer} | ${batch.components.join(', ')}`);
      const members = batch.scope === 'component' ? batch.components : [batch.components.join('+')];
      await pool(members, batch.scope === 'component' ? options.maxParallel : 1, async (member) => {
        const ids = member.split('+');
        const scopePaths = ids.flatMap((id) => byId.get(id)?.owned_paths || []);
        const workspaceRoot = path.join(evidenceDir, 'workspaces', `fix-${ledger.round}-${ids.join('-')}`);
        const workspace = createWorkspace(repoRoot, workspaceRoot, options.workspace);
        workspace.id = `fix-${ids.join('-')}`;
        const agentDir = path.join(evidenceDir, 'agents', `remediation-${ledger.round}-${ids.join('-')}`);
        const deltas = ids.map((id) => parity.results.filter((row) => row.component_id === id));

        try {
          const invocation = await runAgentRole({
            copilot,
            role: 'remediation',
            id: `fix-${ids.join('-')}`,
            prompt: [
              readPrompt('_contract.md'), '', readPrompt('remediation.md'), '',
              '## Task', '',
              '```json',
              JSON.stringify({
                round: ledger.round, batch: batch.batch_id, owning_layer: batch.layer,
                components: ids, owned_paths: scopePaths,
                result_path: path.relative(repoRoot, path.join(agentDir, 'result.json')),
                deltas,
              }, null, 2),
              '```',
            ].join('\n'),
            cwd: workspaceRoot,
            model: options.model,
            effort: options.effort,
            agentDir,
            renderer,
            spawnFn,
          });
          track(invocation, { phase: 'remediation', round: ledger.round, batch: batch.batch_id, component_id: ids.join('+') });

          const changes = collectChanges(workspace, scopePaths);
          if (changes.valid && invocation.status === 'PASS') {
            mergeChanges(workspace, repoRoot, changes, new Map());
            for (const id of ids) {
              recordAttempt(ledger, {
                componentId: id,
                batchId: batch.batch_id,
                layer: batch.layer,
                hypothesis: invocation.result?.notes,
                changedFiles: changes.changed,
              });
            }
          } else {
            for (const id of ids) {
              recordAttempt(ledger, { componentId: id, batchId: batch.batch_id, layer: batch.layer, hypothesis: invocation.error });
            }
          }
          return invocation;
        } finally {
          removeWorkspace(workspaceRoot);
        }
      });
    }

    const redeploy = await runDeployment({
      repoRoot,
      steps: planDeployment(plan.components.flatMap((component) => component.owned_paths), options.aemPort),
      renderer,
      execFn,
      logPath: path.join(evidenceDir, 'deploy.log'),
      writeLog: fs.appendFileSync,
    });
    if (redeploy.status !== 'PASS') break;

    cycle += 1;
    parity = (await runParity(cycle)).artefact;
    applyParity(ledger, parity);
  }
  const terminal = terminalStatus(ledger);
  writeJson(path.join(evidenceDir, 'remediation-ledger.json'), ledgerSnapshot(ledger));
  endPhase(phase, terminal.status, `${terminal.passed.length} passed, ${terminal.failed_final.length} failed-final, ${rounds} round(s)`);

  // 9. Report — deterministic.
  phase = startPhase('report');
  state.duration_seconds = Number(((Date.now() - state.started_at) / 1000).toFixed(2));
  const report = buildReport({
    state,
    plan,
    parity,
    ledger: ledgerSnapshot(ledger),
    phases: phases.map((entry) => ({ ...entry })),
    invocations,
    workers: workerResults.map((entry) => ({
      component_id: entry.component_id,
      status: entry.status,
      duration_seconds: entry.duration_seconds ?? null,
      attempts: entry.attempts ?? null,
      history: entry.history || [],
    })),
    deployment,
  });
  const written = writeReport(evidenceDir, report);
  endPhase(phase, report.status === 'COMPLETE' ? 'PASS' : 'FAIL', written.markdownPath);

  return {
    status: report.status,
    phases,
    state,
    plan,
    parity,
    ledger: ledgerSnapshot(ledger),
    invocations,
    report,
  };
}

function primaryUnused() {}
const primaryPlaceholder = null;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.siteUrl) {
    console.log(`
orchestrator/run.mjs — multi-agent AEM migration

  --url <url>               Live source URL (required)
  --target-path <path>      AEM page path, e.g. /content/site/us/en/page (required)
  --aem-host <host>         Default from AEM_HOST or localhost
  --aem-port <port>         Default from AEM_PORT or 4502
  --aem-user <name>         Default from AEM_USER or admin; password from AEM_PASSWORD
  --breakpoints <list>      Default 375,768,1440
  --max-parallel <n>        Component workers in flight (default ${DEFAULTS.maxParallel})
  --component-attempts <n>  Attempts per component before the run fails (default ${DEFAULTS.componentAttempts})
  --visual-pass-ratio <n>   Strict minimum ratio (default ${DEFAULTS.threshold.toFixed(2)})
  --model <id> --effort <level>
  --evidence-dir <path>
  --dry-run                 Validate inputs and exit
`);
    return;
  }

  if (!options.targetPath) {
    throw new Error('--target-path is required: parity needs the deployed AEM page to compare against.');
  }
  if (!Number.isInteger(options.componentAttempts) || options.componentAttempts < 1 || options.componentAttempts > 10) {
    throw new Error('--component-attempts must be an integer between 1 and 10.');
  }
  // A local SDK ships with admin/admin; never guess credentials for a remote instance.
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(options.aemHost);
  if (!process.env.AEM_PASSWORD) {
    if (!localHost) {
      throw new Error(`AEM_PASSWORD must be set for ${options.aemHost}; the default is only assumed for a local instance.`);
    }
    process.env.AEM_PASSWORD = 'admin';
    console.log(`Using the default local credentials for user "${options.aemUser}". Set AEM_PASSWORD to override.`);
  }

  const runId = crypto.randomUUID();
  const evidenceDir = options.evidenceDir
    ? path.resolve(defaultRepoRoot, options.evidenceDir)
    : path.join(defaultRepoRoot, 'design', 'scratch', `migration-${runId}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const renderer = createRenderer({ stageIds: PHASES });
  renderer.runHeader({
    siteUrl: options.siteUrl,
    aemUrl: `http://${options.aemHost}:${options.aemPort}`,
    runId,
    evidenceDir: path.relative(defaultRepoRoot, evidenceDir),
    model: options.model || 'auto',
    effort: options.effort,
  });

  if (options.dryRun) {
    console.log('Dry run: inputs valid, evidence directory created, no agents started.');
    return;
  }

  const { findCopilot } = await import('./copilot.mjs');
  const { spawn } = await import('node:child_process');
  const copilot = findCopilot();
  const runTool = (name, args) => new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: defaultRepoRoot, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('close', (code) => resolve({ name, code }));
  });

  renderer.startHeartbeat();
  const outcome = await orchestrate(options, { copilot, renderer, runId, evidenceDir, runTool, execFn: spawn });
  renderer.stopHeartbeat();

  renderer.summary(
    {
      status: outcome.status,
      duration_seconds: outcome.state?.duration_seconds,
      stages: outcome.phases.map((phase) => ({
        stage: phase.name, status: phase.status, duration_seconds: phase.duration_seconds, failing_checks: [],
      })),
    },
    {
      evidenceDir: path.relative(defaultRepoRoot, evidenceDir),
      targetUrl: null,
      components: (outcome.ledger?.components || []).map((entry) => ({
        id: entry.id, status: entry.status, duration_seconds: null,
      })),
    },
  );
  process.exitCode = outcome.status === 'COMPLETE' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`orchestrator failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
