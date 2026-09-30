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
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { runAgentRole } from './agent.mjs';
import { createRenderer, formatDuration } from './console.mjs';
import { findCopilot, listAvailableModels, modelEfforts } from './copilot.mjs';
import { applyContributions, verifyComposeTargets } from './contributions.mjs';
import { acquireAssets, ensureFilterRoot } from './assets.mjs';
import {
  checkEnvironment, describeBrokenBundles, focusedTestPlan, planDeployment, planScopedDeployment, probeInstance,
  runDeployment, runValidation, validationPlan, verifyBundles,
} from './deploy.mjs';
import { buildComponent, createSemaphore, scheduleOrder } from './fanout.mjs';
import { acquireFonts, FONTS_SCSS, writeFontsScss } from './fonts.mjs';
import { prepareCrops } from './inputs.mjs';
import { parityComponents, planSummary, sharedDesignPaths, validatePlan } from './plan.mjs';
import { createPreview } from './preview.mjs';
import {
  advanceRound, applyParity, createLedger, environmentBlocked, finalizeLedger, ledgerSnapshot,
  PAGE_SCOPE_ID, recordAttempt, routeFailures, terminalStatus,
} from './remediation.mjs';
import { buildReport, writeReport } from './report.mjs';
import {
  frontendFiles, readTokenManifest, staticRejection, unresolvedUrls,
} from './static-checks.mjs';
import { openTimings } from './timings.mjs';
import {
  collectChanges, createWorkspace, mergeChanges, removeWorkspace, snapshotTree, watchTree,
} from './workspaces.mjs';
import { ensureCopilot, ensureTools } from '../tools/setup.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteUrlDir = path.dirname(here);
const defaultRepoRoot = path.resolve(siteUrlDir, '../..');
const promptsDir = path.join(siteUrlDir, 'prompts');
const toolsDir = path.join(siteUrlDir, 'tools');

const PHASES = ['discover', 'plan', 'foundations', 'assets', 'fanout', 'compose', 'deploy', 'parity', 'remediation', 'report'];

/** Roles that spawn an agent. One model and one effort govern every one of them. */
export const AGENT_ROLES = ['planner', 'foundations', 'component', 'remediation'];

/**
 * What a run is allowed to call a pass, scaled to how hard it was asked to think. Cheap reasoning
 * is for iterating on structure, not for certifying fidelity, so the bar moves with the effort
 * rather than letting a low-effort run claim the same result as a full one. The structured gates
 * — typography, colour, spacing, geometry — are unaffected and stay exact at every level.
 */
export const EFFORT_THRESHOLDS = Object.freeze({
  max: 0.9,
  xhigh: 0.9,
  high: 0.85,
  medium: 0.75,
  low: 0.55,
  minimal: 0.55,
  none: 0.55,
});

/** A model that manages its own reasoning gets the same bar as an explicit high-effort run. */
export function thresholdForEffort(effort, fallback = DEFAULTS.threshold) {
  return EFFORT_THRESHOLDS[effort] ?? fallback;
}

const TUNING_FILE = 'run-tuning.json';
const FOUNDATIONS_VERDICT = 'foundations.json';
const COMPOSE_RECEIPT = 'compose.json';

// Content-package sources; every one is built after foundations, whatever it touched.
const CONTENT_SOURCE = /^[^/]+\/src\/main\/content\/jcr_root\//;

/** Single source of truth for run defaults, shared by the CLI and direct orchestrate() calls. */
export const DEFAULTS = Object.freeze({
  aemHost: 'localhost',
  aemPort: 4502,
  aemUser: 'admin',
  breakpoints: [375, 768, 1440],
  maxParallel: 4,
  componentAttempts: 4,
  threshold: 0.85,
  maxParityRetries: 2,
  planRepairs: 2,
  foundationsRepairs: 2,
  // How long discovery waits for scripts to finish mutating the layout before it scans.
  settleMs: 3000,
  // Maven checks run beside the agents, not inside their slots.
  validationParallel: 2,
  // Deploy each merged component early and hand its measured deltas back to its own session.
  preview: true,
  previewRounds: 1,
  // An agent whose stream is silent this long is stopped and resumed.
  agentIdleMinutes: 10,
  // Re-capture other pages that use this run's components, before and after, and compare.
  regression: true,
});

function readPrompt(name) {
  return fs.readFileSync(path.join(promptsDir, name), 'utf8');
}

/** One model and one effort for the whole run, so every agent's work is comparable. */
export function agentTuning(options) {
  return { model: options.model, effort: options.effort };
}

/** Matches a model by id or display name, so either form may be typed or passed as a flag. */
export function findModel(models, wanted) {
  const needle = String(wanted).toLowerCase();
  return models.find((model) => model.id.toLowerCase() === needle || model.name?.toLowerCase() === needle);
}

/** Reasoning is the expensive part, so the newest Opus is offered first when the account has it. */
export function preferredModelIndex(models) {
  const opus = models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => /opus/i.test(`${model.name} ${model.id}`))
    .sort((left, right) => right.model.name.localeCompare(left.model.name, undefined, { numeric: true }));
  if (opus.length) return opus[0].index;
  const auto = models.findIndex((model) => model.id === 'auto');
  return auto >= 0 ? auto : 0;
}

export function describeModel(model, index) {
  const efforts = modelEfforts(model);
  const effort = efforts.length ? `effort: ${efforts.join('/')}` : 'effort: managed by model';
  const billing = model.billing?.multiplier === undefined ? '' : `; billing: ${model.billing.multiplier}x`;
  return `  ${index + 1}. ${model.name} (${model.id}); ${effort}${billing}`;
}

/**
 * Settles the model and the effort together against what the account actually has. A model that
 * manages its own reasoning takes no effort flag at all, and one that does advertises exactly
 * which levels it accepts, so an impossible pairing is refused here rather than mid-run.
 */
export function selectTuning(models, wanted) {
  if (!models.length) {
    throw new Error('The authenticated GitHub account returned no enabled Copilot models.');
  }
  const model = findModel(models, wanted.model);
  if (!model) {
    throw new Error(`Model "${wanted.model}" is not available to this account.`
      + ` Available: ${models.map((entry) => entry.id).join(', ')}`);
  }

  const efforts = modelEfforts(model);
  if (!efforts.length) {
    if (wanted.effort) {
      throw new Error(`Model "${model.name}" manages its own reasoning and accepts no effort setting.`);
    }
    return { model: model.id, effort: null, efforts };
  }
  const effort = wanted.effort || (efforts.includes('high') ? 'high' : efforts[0]);
  if (!efforts.includes(effort)) {
    throw new Error(`Model "${model.name}" supports effort ${efforts.join('/')}, not "${effort}".`);
  }
  return { model: model.id, effort, efforts };
}

/** Asks for whatever was not supplied, offering the account's real models by number. */
export async function promptForTuning(models, wanted, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output });
  try {
    let chosenModel = wanted.model;
    if (!chosenModel) {
      output.write('\nModels available to the authenticated GitHub account:\n');
      models.forEach((model, index) => output.write(`${describeModel(model, index)}\n`));
      const fallback = preferredModelIndex(models);
      const answer = (await rl.question(`Select model [${fallback + 1}]: `)).trim();
      const index = answer ? Number.parseInt(answer, 10) - 1 : fallback;
      if (!Number.isInteger(index) || index < 0 || index >= models.length) {
        throw new Error(`Model selection must be a number between 1 and ${models.length}.`);
      }
      chosenModel = models[index].id;
    }

    const efforts = modelEfforts(findModel(models, chosenModel) || {});
    let chosenEffort = wanted.effort;
    if (!chosenEffort && efforts.length) {
      const fallback = efforts.includes('high') ? 'high' : efforts[0];
      output.write('\nReasoning effort:\n');
      efforts.forEach((level, index) => output.write(`  ${index + 1}. ${level}\n`));
      const answer = (await rl.question(`Select effort [${efforts.indexOf(fallback) + 1}]: `)).trim();
      chosenEffort = efforts[Number.parseInt(answer, 10) - 1] || answer || fallback;
    }
    return selectTuning(models, { model: chosenModel, effort: chosenEffort });
  } finally {
    rl.close();
  }
}

/** One DAM folder per authored page, so re-running a different source cannot mix two sites' assets. */
function damPathFor(targetPath) {
  return String(targetPath).replace(/^\/content\//, '/content/dam/');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Same digest discover.mjs records for itself, so a resume can tell which capture it is reusing. */
function discoverySourceHash() {
  try {
    return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(toolsDir, 'discover.mjs'))).digest('hex')}`;
  } catch {
    return null;
  }
}

/**
 * Artefacts from an earlier run that are safe to reuse. Every one is re-verified here rather
 * than trusted, so a resume can never build on a stale plan or a half-written phase.
 */
export function readCheckpoint({ evidenceDir, siteUrl, targetPath }) {
  const checkpoint = {
    discovery: null, plan: null, foundations: false, assets: null, workers: [], warnings: [],
  };

  const discovery = readJson(path.join(evidenceDir, 'discovery', 'discovery.json'));
  if (!discovery?.instances?.length || discovery.status !== 'PASS') return checkpoint;
  // Resuming onto a different source would reuse the wrong evidence and the wrong assets.
  const recorded = discovery.source?.requested_url || discovery.source?.final_url;
  if (siteUrl && recorded && recorded !== siteUrl) return checkpoint;
  checkpoint.discovery = discovery;
  // Reused as it is; a fix to the capture since then only reaches a fresh run, so say so.
  const toolHash = discoverySourceHash();
  if (discovery.tool?.source_sha256 && toolHash && discovery.tool.source_sha256 !== toolHash) {
    checkpoint.warnings.push(`discovery.json was captured by an older discover.mjs (${String(discovery.generated_at).slice(0, 10)});`
      + ' capture fixes made since only apply to a fresh run without --resume');
  }

  const plan = readJson(path.join(evidenceDir, 'plan.json'));
  if (!plan?.components?.length || plan.source_fingerprint !== discovery.source_fingerprint) return checkpoint;
  // A plan that authors a different page cannot be reused: its contribution paths, its page
  // skeleton and the foundations work behind it all belong to the old target.
  if (targetPath && plan.shared?.page_path !== targetPath) return checkpoint;
  checkpoint.plan = plan;

  // The orchestrator's verdict, not the agent's; runs that predate it fall back to the agent result.
  const foundations = readJson(path.join(evidenceDir, FOUNDATIONS_VERDICT))
    ?? readJson(path.join(evidenceDir, 'agents', 'foundations', 'result.json'));
  checkpoint.foundations = foundations?.status === 'PASS';
  checkpoint.foundationsUnverified = foundations?.status === 'UNVERIFIED';
  if (!checkpoint.foundations) return checkpoint;

  const assets = readJson(path.join(evidenceDir, 'assets.json'));
  checkpoint.assets = assets?.status === 'PASS' ? assets : null;
  if (!checkpoint.assets) return checkpoint;

  // A cancelled fan-out banks whatever finished, so a partial set is still worth reusing.
  const workers = readJson(path.join(evidenceDir, 'workers.json'));
  const ids = new Set(plan.components.map((component) => component.id));
  checkpoint.workers = Array.isArray(workers)
    ? workers.filter((entry) => entry?.status === 'PASS' && ids.has(entry.component_id))
    : [];

  return checkpoint;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

export function parseArgs(argv) {
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
      case '--settle-ms': options.settleMs = Number.parseInt(value, 10); index += 1; break;
      case '--max-parallel': options.maxParallel = Number.parseInt(value, 10); index += 1; break;
      case '--component-attempts': options.componentAttempts = Number.parseInt(value, 10); index += 1; break;
      case '--visual-pass-ratio': options.threshold = Number.parseFloat(value); options.thresholdPinned = true; index += 1; break;
      case '--max-parity-retries': options.maxParityRetries = Number.parseInt(value, 10); index += 1; break;
      case '--validation-parallel': options.validationParallel = Number.parseInt(value, 10); index += 1; break;
      case '--preview-rounds': options.previewRounds = Number.parseInt(value, 10); index += 1; break;
      case '--no-preview': options.preview = false; break;
      case '--agent-idle-minutes': options.agentIdleMinutes = Number.parseFloat(value); index += 1; break;
      case '--no-regression': options.regression = false; break;
      case '--evidence-dir': options.evidenceDir = value; index += 1; break;
      case '--resume': options.resume = value; index += 1; break;
      case '--model': options.model = value; index += 1; break;
      case '--effort': options.effort = value; index += 1; break;
      case '--list-models': options.listModels = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--help': options.help = true; break;
      default:
        // One run, one setting: a per-role override would make agents' work incomparable.
        if (flag.startsWith('--model:') || flag.startsWith('--effort:')) {
          throw new Error(`${flag} is not supported: one model and one effort govern the whole run.`);
        }
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

/** Names what changed under a phase that merges agents' work, and how to carry on. */
function describeEdits(files, during, runId) {
  const shown = files.length > 8 ? `${files.slice(0, 8).join(', ')} and ${files.length - 8} more` : files.join(', ');
  return `${files.length} file(s) changed in the repository during ${during}, outside any merge: ${shown}. `
    + `Nothing was merged over them. Finish editing, then rerun the same command with --resume ${runId};`
    + ' edits made between runs are kept and deployed';
}

const REGRESSION_PAGE_LIMIT = 4;

/**
 * Pages in the content package other than the one being migrated, those rendering this plan's
 * resource types first: a component extended for this source, or a token it retuned, reaches them.
 */
export function regressionPages(repoRoot, plan, targetPath, limit = REGRESSION_PAGE_LIMIT) {
  const contentRoot = plan.shared?.content_root || 'ui.content/src/main/content/jcr_root';
  const base = path.join(repoRoot, contentRoot, 'content');
  if (!fs.existsSync(base)) return [];
  const resourceTypes = plan.components.map((component) => component.resource_type).filter(Boolean);
  const pages = [];
  const walk = (directory, jcrPath) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      // `_jcr_content` and friends are nodes of a page, not pages.
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const childPath = `${jcrPath}/${entry.name}`;
      if (/^\/content\/(dam|experience-fragments)(\/|$)/.test(childPath)) continue;
      if (targetPath && (childPath === targetPath || childPath.startsWith(`${targetPath}/`))) continue;
      const childDir = path.join(directory, entry.name);
      const file = path.join(childDir, '.content.xml');
      if (fs.existsSync(file)) {
        const text = fs.readFileSync(file, 'utf8');
        if (/jcr:primaryType="cq:Page"/.test(text) && /<jcr:content[\s>]/.test(text)) {
          pages.push({
            path: childPath,
            uses: resourceTypes.filter((type) => text.includes(`"${type}"`)).length,
            depth: childPath.split('/').length,
          });
        }
      }
      walk(childDir, childPath);
    }
  };
  walk(base, '/content');
  return pages
    .sort((left, right) => right.uses - left.uses || right.depth - left.depth || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map((page) => page.path);
}

/** One launch of a run is one timing session; every way out of it, failure included, closes it. */
export async function orchestrate(rawOptions, services) {
  const timings = openTimings(services.evidenceDir, { runId: services.runId, resumed: Boolean(rawOptions.resume) });
  try {
    const outcome = await runStages(rawOptions, services, timings);
    const sessionSeconds = timings.finish(outcome.status);
    if (outcome.state && outcome.state.duration_seconds === undefined) outcome.state.duration_seconds = sessionSeconds;
    return { ...outcome, timings: timings.summary() };
  } catch (error) {
    timings.finish('ERROR');
    throw error;
  }
}

async function runStages(rawOptions, services, timings) {
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
      relaunches: invocation.relaunches || 0,
      stalled_seconds: invocation.stalledSeconds || 0,
      ...extra,
    });
    return invocation;
  };
  // Every agent gets the same watchdog; a stalled stream costs minutes, not the hour it took the network.
  const agentOptions = {
    ...agentTuning(options),
    idleTimeoutMs: Math.max(1, options.agentIdleMinutes ?? DEFAULTS.agentIdleMinutes) * 60000,
  };
  const startPhase = (name) => {
    const entry = { name, status: 'RUNNING', started_at: Date.now() };
    phases.push(entry);
    renderer.stageStarted(name);
    timings.stageStarted(name);
    return entry;
  };
  const endPhase = (entry, status, message) => {
    entry.status = status;
    entry.duration_seconds = Number(((Date.now() - entry.started_at) / 1000).toFixed(2));
    renderer.stageFinished(entry.name, status, message);
    timings.stageFinished(entry.name, status, { reused: Boolean(entry.reused) });
    return entry;
  };
  const reusePhase = (entry, message) => {
    entry.reused = true;
    return endPhase(entry, 'PASS', `reused · ${message}`);
  };

  const checkpoint = options.resume
    ? readCheckpoint({ evidenceDir, siteUrl: options.siteUrl, targetPath: options.targetPath })
    : {
      discovery: null, plan: null, foundations: false, assets: null, workers: [], warnings: [],
    };

  // Cheap reasoning is for iterating, not for certifying, so the bar it may claim moves with it.
  // An explicit --visual-pass-ratio still wins: a stated number is never overridden.
  if (!options.thresholdPinned) {
    options.threshold = thresholdForEffort(options.effort, options.threshold);
  }

  // One run, one setting: banked so a resume cannot silently compare work made under one
  // model against work made under another.
  writeJson(path.join(evidenceDir, TUNING_FILE), {
    model: options.model ?? null,
    effort: options.effort ?? null,
    threshold: options.threshold,
    maxParityRetries: options.maxParityRetries,
    updated_at: new Date().toISOString(),
  });

  const state = {
    run_id: runId,
    inputs: {
      SITE_URL: options.siteUrl,
      AEM_HOST: options.aemHost,
      AEM_PORT: options.aemPort,
      BREAKPOINTS: options.breakpoints,
      VISUAL_PASS_RATIO: options.threshold,
      MODEL: options.model || 'auto',
      EFFORT: options.effort || 'default',
    },
    started_at: Date.now(),
  };
  if (timings.previous.sessions) {
    renderer.note(`resumed: ${timings.previous.sessions} earlier session(s) already spent `
      + `${formatDuration(timings.previous.total_seconds)} (timings.json)`);
  }

  // 1. Discovery — deterministic, no model.
  let phase = startPhase('discover');
  const aemUrl = `http://${options.aemHost}:${options.aemPort}`;
  const environment = await (services.checkEnvironment || checkEnvironment)({
    repoRoot, execFn, fetchFn: services.fetchFn || options.fetchFn || fetch, aemUrl,
  });
  for (const warning of environment.warnings || []) renderer.warn(warning);
  if (environment.status !== 'PASS') {
    endPhase(phase, 'FAIL', `environment: ${environment.problems.join('; ')}`);
    return { status: 'FAIL', phases, state, environment };
  }
  for (const warning of checkpoint.warnings || []) renderer.warn(warning);
  const discoveryDir = path.join(evidenceDir, 'discovery');
  let discovery = checkpoint.discovery;
  if (!discovery) {
    const discoveryResult = await runTool('discover', [
      path.join(toolsDir, 'discover.mjs'),
      '--url', options.siteUrl,
      '--out', discoveryDir,
      '--breakpoints', options.breakpoints.join(','),
      '--settle-ms', String(options.settleMs),
      '--run-id', runId,
    ]);
    if (discoveryResult.code !== 0) {
      endPhase(phase, 'FAIL', 'discovery tool failed');
      return { status: 'FAIL', phases, state };
    }
    discovery = JSON.parse(fs.readFileSync(path.join(discoveryDir, 'discovery.json'), 'utf8'));
  }
  const instanceOrder = new Map(discovery.instances.map((instance) => [instance.id, instance.order]));
  const discoverySummary = `${discovery.instances.length} instances, fingerprint ${discovery.source_fingerprint.slice(0, 20)}`;
  if (checkpoint.discovery) reusePhase(phase, discoverySummary);
  else endPhase(phase, 'PASS', discoverySummary);

  // 2. Planning — one sequential agent, bounded repairs, orchestrator-owned gate.
  phase = startPhase('plan');
  const planPath = path.join(evidenceDir, 'plan.json');
  let plan = null;
  let gate = null;
  let feedback = '';
  if (checkpoint.plan) {
    // The gate is deterministic, so re-running it costs nothing and re-derives the waves.
    const revalidated = validatePlan(checkpoint.plan, { discovery, runId: checkpoint.plan.run_id, pagePath: options.targetPath });
    if (revalidated.valid) {
      plan = checkpoint.plan;
      gate = revalidated;
    }
  }
  for (let attempt = 1; attempt <= options.planRepairs + 1 && !plan; attempt += 1) {
    const agentDir = path.join(evidenceDir, 'agents', `planner-${attempt}`);
    const task = [
      readPrompt('_contract.md'), '', readPrompt('planner.md'), '',
      '## Task', '',
      `- run_id: \`${runId}\``,
      `- discovery: \`${path.relative(repoRoot, path.join(discoveryDir, 'discovery.json'))}\``,
      `- source_fingerprint: \`${discovery.source_fingerprint}\``,
      `- breakpoints: ${options.breakpoints.join(', ')}`,
      `- page path: \`${options.targetPath}\` — set \`shared.page_path\` to exactly this, and root every`,
      '  content component\'s `contribution.path` in its `jcr:content`. Parity scores this page and no other.',
      `- write plan to: \`${path.relative(repoRoot, planPath)}\``,
      `- write result to: \`${path.relative(repoRoot, path.join(agentDir, 'result.json'))}\``,
      feedback,
    ].join('\n');

    const invocation = await runAgentRole({
      copilot, role: 'planner', id: `planner-${attempt}`, prompt: task, cwd: repoRoot,
      ...agentOptions, agentDir, renderer, spawnFn,
    });
    track(invocation, { phase: 'plan', attempt });
    if (invocation.status !== 'PASS' || !fs.existsSync(planPath)) {
      feedback = `\n## Previous attempt rejected\n\n${invocation.error || 'no plan.json was written'}\n`;
      continue;
    }
    const candidate = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    gate = validatePlan(candidate, { discovery, runId, pagePath: options.targetPath });
    if (gate.valid) plan = candidate;
    else feedback = `\n## Previous plan rejected by the gate\n\n- ${gate.errors.join('\n- ')}\n`;
  }
  if (!plan) {
    endPhase(phase, 'FAIL', gate ? gate.errors.slice(0, 3).join('; ') : 'planner produced no valid plan');
    return { status: 'FAIL', phases, state, plan: null };
  }
  const summary = planSummary(plan, gate.waves);
  renderer.setKnownComponents?.(plan.components.map((component) => component.id));
  const planMessage = `${summary.components} components, ${summary.waves.length} waves, chrome via XF: ${summary.chrome.join(', ') || 'none'}`;
  if (plan === checkpoint.plan) reusePhase(phase, planMessage);
  else endPhase(phase, 'PASS', planMessage);

  // 3. Foundations — serialized; the only writer of shared design files.
  phase = startPhase('foundations');
  const fontsPath = path.join(evidenceDir, 'fonts.json');
  let fonts = readJson(fontsPath);
  if (!checkpoint.foundations) {
    const verdictPath = path.join(evidenceDir, FOUNDATIONS_VERDICT);
    // Finished, but the machine could not run its check: re-check it, do not redo it.
    let agentDone = Boolean(checkpoint.foundationsUnverified && fonts);
    if (!agentDone) {
      // Written first, so a run killed mid-phase cannot resume on a tree nobody checked.
      writeJson(verdictPath, { status: 'RUNNING' });
      // Foundations rewrites the skeletons compose fills, so compose's last write no longer tells an edit apart.
      fs.rmSync(path.join(evidenceDir, COMPOSE_RECEIPT), { force: true });
      // Fetched here, not by the agent: the exact files, behind a url() that resolves once deployed.
      fonts = await acquireFonts({
        repoRoot, discovery, fetchFn: services.fetchFn || options.fetchFn || fetch, referer: discovery.source?.final_url,
      });
      writeJson(fontsPath, fonts);
      if (fonts.faces.length) {
        renderer.note(`fonts: ${fonts.faces.length} face(s) of ${fonts.families.join(', ')} delivered to ${FONTS_SCSS}`);
      }
      for (const failure of fonts.failures) {
        renderer.warn(`font not delivered: ${failure.family} ${failure.weight} ${failure.style} (${failure.reason})`);
      }
    }
    const maxAttempts = options.foundationsRepairs + 1;
    let feedback = '';
    let validation = null;
    let attempt = 0;
    while (attempt < maxAttempts && validation?.status !== 'PASS') {
      attempt += 1;
      if (!agentDone) {
        const id = attempt === 1 ? 'foundations' : `foundations-${attempt}`;
        const agentDir = path.join(evidenceDir, 'agents', id);
        const foundations = await runAgentRole({
          copilot,
          role: 'foundations',
          id,
          prompt: [
            readPrompt('_contract.md'), '', readPrompt('foundations.md'), '',
            '## Task', '',
            `- plan: \`${path.relative(repoRoot, planPath)}\``,
            `- discovery: \`${path.relative(repoRoot, path.join(discoveryDir, 'discovery.json'))}\``,
            `- page path: \`${options.targetPath}\` — build its skeleton and give it its own`,
            '  replace-mode filter root, not a `mode="merge"` one.',
            `- chrome fragments: ${plan.components.filter((c) => c.role === 'chrome').map((c) => c.contribution.path).join(', ') || 'none'}`,
            `- fonts: \`${path.relative(repoRoot, fontsPath)}\` — already delivered in \`${FONTS_SCSS}\`, which the`,
            `  orchestrator owns; families: ${fonts.families.join(', ') || 'none (the source used system fonts)'}`,
            `- write result to: \`${path.relative(repoRoot, path.join(agentDir, 'result.json'))}\``,
            feedback,
          ].join('\n'),
          cwd: repoRoot,
          ...agentOptions,
          agentDir,
          renderer,
          spawnFn,
        });
        track(foundations, { phase: 'foundations', attempt });
        if (foundations.status !== 'PASS') {
          writeJson(verdictPath, { status: 'FAIL', attempts: attempt, error: foundations.error || 'foundations failed' });
          endPhase(phase, 'FAIL', foundations.error || 'foundations failed');
          return { status: 'FAIL', phases, state, plan };
        }
        // Whatever the agent did to the partial or its import, both are put back as generated.
        writeFontsScss(repoRoot, fonts.faces);
      }
      agentDone = false;
      // A url() that resolves nowhere builds fine and fails silently on the page, so it is checked first.
      const urls = unresolvedUrls({ root: repoRoot, files: frontendFiles(repoRoot) });
      // Every content package, all folders: afterwards a worker's check can only fail on its own files.
      validation = urls.length
        ? {
          status: 'FAIL', kind: 'code', label: 'clientlib url()', detail: urls.slice(0, 12).map((problem) => problem.message).join('\n'),
        }
        : await runValidation({
          workspaceRoot: repoRoot,
          steps: validationPlan([...snapshotTree(repoRoot, options.workspace).keys()]
            .filter((file) => CONTENT_SOURCE.test(file))),
          execFn,
        });
      if (validation.status !== 'PASS' && validation.kind === 'environment') {
        // The machine, not the tree: another attempt would be charged for nothing.
        writeJson(verdictPath, {
          status: 'UNVERIFIED', attempts: attempt, label: validation.label, detail: validation.detail,
        });
        endPhase(phase, 'FAIL', `environment: ${validation.label} could not run: ${validation.detail.split('\n')[0]}. `
          + `Fix the machine, then rerun with --resume ${runId}; the foundations work is kept and only re-checked`);
        return { status: 'FAIL', phases, state, plan };
      }
      if (validation.status !== 'PASS' && attempt < maxAttempts) {
        renderer.warn(`foundations attempt ${attempt}/${maxAttempts} rejected: ${validation.label}`);
        feedback = [
          '', `## Attempt ${attempt} of ${maxAttempts} was rejected`, '',
          `The tree fails ${validation.label} after your changes:`, validation.detail, '',
          'Fix exactly this, then write your result again. The tree is not reset between attempts,',
          'so keep the rest of your work.',
        ].join('\n');
      }
    }
    writeJson(verdictPath, validation.status === 'PASS'
      ? { status: 'PASS', attempts: attempt }
      : { status: 'FAIL', attempts: attempt, label: validation.label, detail: validation.detail });
    if (validation.status !== 'PASS') {
      endPhase(phase, 'FAIL', `tree fails ${validation.label} after ${attempt} foundations attempt(s): `
        + validation.detail.split('\n')[0]);
      return { status: 'FAIL', phases, state, plan };
    }
  }
  // Compose runs after the fan-out, so its structural preconditions are checked here instead.
  // A resumed run re-checks too: the tree may have moved on since the skeleton was written.
  const contentFilter = plan.shared?.content_filter || 'ui.content/src/main/content/META-INF/vault/filter.xml';
  // Before the check, not after: the page root is computed from --target-path, so the orchestrator
  // owns it rather than failing the run because an agent forgot to write it.
  if (ensureFilterRoot({ repoRoot, filterPath: contentFilter, jcrPath: options.targetPath })) {
    renderer.note(`filter.xml now covers ${options.targetPath}`);
  }
  const composeProblems = verifyComposeTargets({ repoRoot, plan });
  if (composeProblems.length) {
    endPhase(phase, 'FAIL', `foundations left compose without a target: ${composeProblems.join('; ')}`);
    return { status: 'FAIL', phases, state, plan };
  }
  if (checkpoint.foundations) reusePhase(phase, 'tokens, template and policies already in the tree');
  else endPhase(phase, 'PASS', 'tokens, template and policies ready');

  // 4. Assets — deterministic; re-acquired every run so a changed source URL cannot leave orphans.
  phase = startPhase('assets');
  const damPath = plan.shared?.dam_path || damPathFor(options.targetPath);
  const damRoot = plan.shared?.dam_root || `ui.content/src/main/content/jcr_root${damPath}`;
  // Reuse only while every acquired binary is still on disk; a partial DAM must be re-fetched.
  const assetsIntact = checkpoint.assets?.manifest
    ?.every((entry) => fs.existsSync(path.join(repoRoot, damRoot, path.basename(entry.dam_path), '_jcr_content', 'renditions', 'original')));
  const assets = assetsIntact ? checkpoint.assets : await acquireAssets({
    repoRoot, discovery, damRoot, damPath, fetchFn: options.fetchFn, discoveryDir,
  });
  writeJson(path.join(evidenceDir, 'assets.json'), assets);
  if (assets.status !== 'PASS') {
    endPhase(phase, 'FAIL', assets.failures.map((entry) => `${entry.url}: ${entry.reason}`).slice(0, 4).join('; '));
    return { status: 'FAIL', phases, state, plan, assets };
  }
  const assetsMessage = `${assets.manifest.length} assets in ${damPath}`;
  // Done here rather than in foundations: a resumed run skips that agent but still needs the root.
  const filterWritten = ensureFilterRoot({
    repoRoot,
    filterPath: contentFilter,
    jcrPath: damPath,
  });
  if (filterWritten) renderer.note(`filter.xml now covers ${damPath}`);
  if (assetsIntact) reusePhase(phase, assetsMessage);
  else endPhase(phase, 'PASS', assetsMessage);

  // Pages this run does not author but can change: shared tokens, fonts and extended components
  // reach them too. Captured before this run first installs anything, and again at the end.
  const regressionDir = path.join(evidenceDir, 'regression');
  const regressionTargets = options.regression
    ? regressionPages(repoRoot, plan, options.targetPath).map((jcrPath) => ({
      id: jcrPath.replace(/^\/content\//, '').replace(/[^a-z0-9]+/gi, '-'),
      url: `${aemUrl}${jcrPath}.html?wcmmode=disabled`,
    }))
    : [];
  const captureRegression = async (label) => {
    if (!regressionTargets.length) return false;
    const baseline = path.join(regressionDir, 'before', 'capture.json');
    if (label === 'before') {
      if (fs.existsSync(baseline)) return true;
      // Once an install has happened, the instance already shows this run: no honest baseline is left.
      if (fs.existsSync(path.join(evidenceDir, 'deployment.json')) || fs.existsSync(path.join(evidenceDir, 'preview'))) return false;
      renderer.note(`regression baseline: ${regressionTargets.length} page(s) captured before the first install`);
    } else if (!fs.existsSync(baseline)) {
      return false;
    }
    const configPath = writeJson(path.join(regressionDir, 'regression-config.json'), {
      pages: regressionTargets,
      breakpoints: options.breakpoints,
      auth: { username: options.aemUser || 'admin', password_env: 'AEM_PASSWORD' },
    });
    const captured = await runTool('regression', [
      path.join(toolsDir, 'regression.mjs'), '--config', configPath, '--out', regressionDir, '--label', label,
    ]);
    return captured.code === 0;
  };

  // 5. Fan-out — parallel component workers, one isolated checkout each.
  phase = startPhase('fanout');
  const byId = new Map(plan.components.map((component) => [component.id, component]));
  const claimed = new Map();
  const workerResults = [];
  let fanoutFailed = false;
  const planIndex = new Map(plan.components.map((component, index) => [component.id, index]));
  const persistWorkers = () => writeJson(
    path.join(evidenceDir, 'workers.json'),
    [...workerResults].sort((left, right) => (planIndex.get(left.component_id) ?? 0) - (planIndex.get(right.component_id) ?? 0)),
  );

  if (checkpoint.workers.length) {
    workerResults.push(...checkpoint.workers);
    // Re-claim their files so a rebuilt neighbour cannot overwrite work this run did not redo.
    for (const entry of checkpoint.workers) {
      for (const file of entry.applied || []) claimed.set(file, entry.component_id);
    }
  }
  const alreadyBuilt = new Set(workerResults.map((entry) => entry.component_id));
  // Nothing holds a workspace at this point; anything here is debris from a killed run.
  fs.rmSync(path.join(evidenceDir, 'workspaces'), { recursive: true, force: true });

  if (alreadyBuilt.size === plan.components.length) {
    reusePhase(phase, `${alreadyBuilt.size} components already built`);
  } else {
    // What is in the tree now is kept and shipped; a change made while workers run is refused.
    const guard = watchTree(repoRoot, options.workspace);
    let edited = [];
    const treeLock = createSemaphore(1);
    const preview = options.preview && options.previewRounds > 0 && environment.aem_reachable
      ? createPreview({
        repoRoot,
        evidenceDir,
        plan,
        discovery,
        options,
        execFn,
        fetchFn: services.fetchFn || options.fetchFn || fetch,
        runTool,
        renderer,
        treeLock,
        instanceOrder,
        workspaceOptions: options.workspace,
        toolsDir,
        guard,
        beforeFirstDeploy: () => captureRegression('before'),
      })
      : null;
    if (options.preview && !preview) {
      renderer.note(`previews off: ${environment.aem_reachable ? 'no preview rounds' : `AEM was not reachable at ${aemUrl} when the run started`}`);
    }
    const context = {
      copilot,
      options,
      repoRoot,
      evidenceDir,
      discovery,
      byId,
      assets,
      renderer,
      spawnFn,
      execFn,
      track,
      readPrompt,
      instanceOrder,
      guard,
      claimed,
      treeLock,
      preview,
      agentOptions,
      agentSlots: createSemaphore(Math.max(1, options.maxParallel)),
      validationSlots: createSemaphore(Math.max(1, options.validationParallel || 1)),
      tokens: readTokenManifest(repoRoot),
      fonts,
      crops: await prepareCrops({
        discovery, discoveryDir, outDir: path.join(evidenceDir, 'crops'), renderer,
      }),
      mergedResults: (exceptId) => workerResults
        .filter((entry) => entry.status === 'PASS' && entry.component_id !== exceptId)
        .map((entry) => entry.result),
    };
    for (const [waveIndex, wave] of gate.waves.entries()) {
      const pending = scheduleOrder(wave.filter((componentId) => !alreadyBuilt.has(componentId)), byId);
      if (!pending.length) continue;
      renderer.note(`wave ${waveIndex + 1}/${gate.waves.length}: ${pending.join(', ')}`);
      const waveResults = await Promise.all(pending.map(async (componentId) => {
        const outcome = await buildComponent(context, componentId, waveIndex);
        // Banked per component, not per wave: a cancellation must not discard finished work.
        workerResults.push(outcome);
        persistWorkers();
        return outcome;
      }));
      edited = guard.drift();
      if (edited.length || waveResults.some((entry) => entry.status !== 'PASS')) {
        fanoutFailed = true;
        break;
      }
    }
    // The preview copy only serves the fan-out; the deploy phase builds the tree itself.
    removeWorkspace(path.join(evidenceDir, 'workspaces', '_preview'));
    if (fanoutFailed) {
      const broken = workerResults.filter((entry) => entry.status !== 'PASS');
      const message = [
        ...(edited.length ? [describeEdits(edited, 'fan-out', runId)] : []),
        ...broken.map((entry) => `${entry.component_id}: ${entry.error}`),
      ].join('; ');
      endPhase(phase, 'FAIL', broken.some((entry) => entry.environment)
        ? `${message}. The machine, not the code: fix it and rerun with --resume ${runId}; merged components are kept`
        : message);
      return {
        status: 'FAIL', phases, state, plan, workerResults, edited,
      };
    }
    const previewed = workerResults.filter((entry) => entry.previews?.length).length;
    endPhase(phase, 'PASS', `${workerResults.length} components built across ${gate.waves.length} waves`
      + (alreadyBuilt.size ? `, ${alreadyBuilt.size} reused` : '')
      + (previewed ? `, ${previewed} previewed` : ''));
  }

  // 6. Compose — the orchestrator writes every shared file, except one changed since it last wrote it.
  phase = startPhase('compose');
  const receiptPath = path.join(evidenceDir, COMPOSE_RECEIPT);
  const composed = applyContributions({
    repoRoot,
    plan,
    results: workerResults.map((entry) => entry.result),
    instanceOrder: new Map(discovery.instances.map((instance) => [instance.id, instance.order])),
    receipt: readJson(receiptPath)?.files,
  });
  // Stored even on a conflict, so a file compose did write is never taken for an edit next time.
  writeJson(receiptPath, { files: composed.receipt });
  if (composed.conflicts.length) {
    const describe = (entry) => [
      entry.kind,
      entry.other && entry.other !== entry.component ? `${entry.component} vs ${entry.other}` : entry.component,
      entry.detail,
      entry.target || entry.property,
    ].filter(Boolean).join(' · ');
    endPhase(phase, 'FAIL', composed.conflicts.map(describe).join('; '));
    return { status: 'FAIL', phases, state, plan, conflicts: composed.conflicts };
  }
  for (const rename of composed.collected?.renames || []) {
    renderer.note(`${rename.component} node "${rename.from}" renamed to "${rename.to}" to keep the page unique`);
  }
  for (const file of composed.kept) {
    renderer.warn(`${file} changed since compose last wrote it; kept as it is, and deployed that way`);
  }
  endPhase(phase, 'PASS', `${composed.written.length} shared files composed`
    + (composed.kept.length ? `, ${composed.kept.length} kept as edited` : ''));

  // 7. Deploy — exclusive, deterministic, whole reactor.
  phase = startPhase('deploy');
  const instance = await probeInstance({ aemUrl, fetchFn: services.fetchFn || options.fetchFn || fetch });
  if (!instance.reachable) {
    endPhase(phase, 'FAIL', `AEM is not reachable at ${aemUrl} (${instance.reason}); start it, then rerun with --resume ${runId}`);
    return { status: 'FAIL', phases, state, plan };
  }
  await captureRegression('before');
  const checkBundles = () => verifyBundles({
    aemUrl: `http://${options.aemHost}:${options.aemPort}`,
    username: options.aemUser,
    password: process.env.AEM_PASSWORD,
    fetchFn: services.fetchFn || fetch,
  });
  const steps = [focusedTestPlan(workerResults), ...planDeployment(options.aemPort)].filter(Boolean);
  const deployment = await runDeployment({
    repoRoot, steps, renderer, execFn, logPath: path.join(evidenceDir, 'deploy.log'), writeLog: fs.appendFileSync,
  });
  writeJson(path.join(evidenceDir, 'deployment.json'), deployment);
  if (deployment.status !== 'PASS') {
    endPhase(phase, 'FAIL', `${deployment.failure.step} exited ${deployment.failure.exit_code}`
      + (deployment.failure.kind === 'environment' ? ' (environment, not code: see deploy.log)' : ''));
    return { status: 'FAIL', phases, state, plan, deployment };
  }

  // A green build only proves the artefact was uploaded, not that the instance could start it.
  const bundles = await checkBundles();
  if (bundles.status === 'FAIL') {
    deployment.bundles = bundles;
    writeJson(path.join(evidenceDir, 'deployment.json'), deployment);
    renderer.note(`unresolved bundles:\n${describeBrokenBundles(bundles.broken)}`);
    endPhase(phase, 'FAIL', `${bundles.broken.length} bundle(s) did not start: `
      + bundles.broken.map((entry) => entry.symbolicName).join(', '));
    return { status: 'FAIL', phases, state, plan, deployment };
  }
  if (bundles.status === 'UNKNOWN') renderer.note(`bundle check skipped: ${bundles.reason}`);
  endPhase(phase, 'PASS', `${deployment.executed.length} steps`
    + (bundles.status === 'PASS' ? `, ${bundles.total} bundles active` : ''));

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
    components: parityComponents(plan, discovery, options.breakpoints, {
      onNested: (entry, host, share) => renderer.note(`${entry.id} ${entry.instance} @${entry.source.bp} is not scored on its own: `
        + `${Math.round(share * 100)}% of it lies inside ${host.instance}, which is scored there`),
    }),
  });

  // Evidence paths are recorded relative to the parity directory, and agents run in a workspace
  // copy that excludes it, so only an absolute path is openable from where they stand.
  const evidenceFile = (value) => (value ? path.resolve(parityDir, value) : null);
  const withEvidence = (row) => ({
    ...row,
    side_by_side: evidenceFile(row.side_by_side),
    diff_mask: evidenceFile(row.diff_mask),
    source: { ...row.source, screenshot: evidenceFile(row.source?.screenshot) },
    target: { ...row.target, screenshot: evidenceFile(row.target?.screenshot) },
  });
  const compositeWithEvidence = (composite) => Object.fromEntries(
    Object.entries(composite || {}).map(([key, entry]) => [key, {
      ...entry,
      source: evidenceFile(entry.source),
      target: evidenceFile(entry.target),
      mask: evidenceFile(entry.mask),
      side_by_side: evidenceFile(entry.side_by_side),
    }]),
  );

  const runParity = async (cycle) => {
    const outcome = await runTool('parity', [
      path.join(toolsDir, 'parity.mjs'), '--config', parityConfigPath, '--out', parityDir, '--cycle', String(cycle),
    ]);
    const artefactPath = path.join(parityDir, 'parity.json');
    const artefact = fs.existsSync(artefactPath) ? JSON.parse(fs.readFileSync(artefactPath, 'utf8')) : null;
    // A crashed runner leaves the previous cycle's artefact in place, and reading it back would
    // report a stale measurement as a fresh one and spend an attempt on nothing.
    if (!artefact || artefact.cycle !== cycle) {
      return { artefact: null, code: outcome.code, error: `parity produced no artefact for cycle ${cycle}` };
    }
    fs.copyFileSync(artefactPath, path.join(parityDir, `parity-cycle-${cycle}.json`));
    return { artefact, code: outcome.code };
  };

  phase = startPhase('parity');
  // The source is measured live every cycle; once it no longer matches what discovery captured,
  // a component can fail against content it was never shown.
  const noteDrift = (artefact) => {
    const rows = artefact?.summary?.source_drift_rows || 0;
    if (rows) {
      renderer.warn(`${rows} parity row(s) measured a live source that differs from discovery (captured `
        + `${String(discovery.generated_at || 'earlier').slice(0, 16)}); their deltas may not be the component's to fix`);
    }
    const fallback = artefact?.preflight?.font_fallback || [];
    if (fallback.length) {
      renderer.warn(`rendering from a fallback font on the AEM page: ${[...new Set(fallback
        .map((entry) => `${entry.family} ${entry.weight || ''}`.trim()))].join(', ')}`);
    }
  };
  let cycle = 0;
  const first = await runParity(cycle);
  if (!first.artefact) {
    endPhase(phase, 'FAIL', first.error);
    return { status: 'FAIL', phases, state, plan };
  }
  let parity = first.artefact;
  noteDrift(parity);
  const ledger = createLedger(plan.components.map((component) => component.id), {
    retries: options.maxParityRetries,
  });
  applyParity(ledger, parity);
  endPhase(phase, parity.status, `${parity.summary.components_passed}/${parity.summary.components_total} components, min ${(parity.summary.min_ratio * 100 || 0).toFixed(2)}%`);

  phase = startPhase('remediation');
  // Nothing an agent edits can move a score that was never taken against the right page.
  const blocked = environmentBlocked(parity);
  if (blocked) {
    writeJson(path.join(evidenceDir, 'remediation-ledger.json'), ledgerSnapshot(ledger));
    endPhase(phase, 'FAIL', `${blocked}; fix the target or its credentials, then rerun`);
    return { status: 'FAIL', phases, state, plan, parity, ledger: ledgerSnapshot(ledger) };
  }
  let rounds = 0;
  // Shared defects the component agents named; the next round's shared repair takes them on.
  let sharedHints = [];
  /**
   * A repair is held to a component's checks before it may be merged, with one fix in its own
   * session: a repair that breaks the build would otherwise sink the redeploy and the round with it.
   */
  const runRepair = async ({
    id, prompt, workspace, workspaceRoot, scopePaths, agentDir, trackExtra,
  }) => {
    const launch = (followUp, dir, sessionId) => runAgentRole({
      copilot,
      role: 'remediation',
      id,
      prompt,
      followUp,
      ...(sessionId ? { sessionId } : {}),
      cwd: workspaceRoot,
      gitCeiling: path.dirname(workspaceRoot),
      ...agentOptions,
      agentDir: dir,
      renderer,
      spawnFn,
    });
    const judge = async (invocation) => {
      const changes = collectChanges(workspace, scopePaths);
      if (!changes.valid || invocation.status !== 'PASS') return { invocation, changes, problem: null };
      const rejection = staticRejection({
        root: workspaceRoot, damRoot: repoRoot, changedFiles: changes.changed, ownedFiles: changes.owned,
      });
      if (rejection) return { invocation, changes, problem: { kind: 'code', text: rejection.text } };
      const validation = await runValidation({ workspaceRoot, steps: validationPlan(changes.changed), execFn });
      return {
        invocation,
        changes,
        problem: validation.status === 'PASS'
          ? null
          : { kind: validation.kind, text: `${validation.label} fails:\n${validation.detail}` },
      };
    };
    const first = await launch(null, agentDir, null);
    track(first, trackExtra);
    const verdict = await judge(first);
    if (verdict.problem?.kind !== 'code') return verdict;
    renderer.warn(`${id}: ${verdict.problem.text.split('\n')[0]} — fixing it in the same session`);
    const fixDir = `${agentDir}-fix`;
    const second = await launch([
      '## Your change was not merged', '', verdict.problem.text, '',
      'Your workspace still holds your edit. Fix exactly this, then write your result again to',
      `\`${path.join(fixDir, 'result.json')}\`.`,
    ].join('\n'), fixDir, first.sessionId);
    track(second, { ...trackExtra, fix: true });
    return judge(second);
  };
  const notMerged = (verdict) => verdict.invocation.error
    || (verdict.problem ? `not merged (${verdict.problem.kind}): ${verdict.problem.text.split('\n')[0]}` : null)
    || (!verdict.changes.valid ? `outside its scope: ${verdict.changes.violations.slice(0, 5).join(', ')}` : null);

  while (parity.status !== 'PASS' && rounds < options.maxParityRetries) {
    const progress = advanceRound(ledger);
    if (progress.done) break;
    const routed = routeFailures(parity, plan, ledger, { sharedHints });
    if (!routed.batches.length && !routed.shared) break;
    rounds += 1;
    sharedHints = [];
    // Watched per round, because the redeploy between rounds regenerates build output in the tree.
    const guard = watchTree(repoRoot, options.workspace);
    const edited = new Set();
    const roundChanged = new Set();

    // A shared cause is fixed once, first and alone, so every component agent builds on the fix.
    let sharedRepair = null;
    if (routed.shared) {
      const shared = routed.shared;
      renderer.note(`round ${ledger.round} | shared repair | ${shared.layer} | ${shared.components.join(', ') || 'page fonts'}`);
      const sharedPaths = sharedDesignPaths(repoRoot);
      const workspaceRoot = path.join(evidenceDir, 'workspaces', `fix-${ledger.round}-shared`);
      const workspace = createWorkspace(repoRoot, workspaceRoot, options.workspace);
      workspace.id = 'fix-shared';
      const agentDir = path.join(evidenceDir, 'agents', `remediation-${ledger.round}-shared`);
      try {
        const verdict = await runRepair({
          id: 'fix-shared',
          prompt: [
            readPrompt('_contract.md'), '', readPrompt('foundations.md'), '',
            '## Task', '',
            '```json',
            JSON.stringify({
              mode: 'repair',
              round: ledger.round,
              batch: shared.batch_id,
              owning_layer: shared.layer,
              components: shared.components,
              owned_paths: sharedPaths,
              breakpoints: shared.breakpoints,
              threshold: parity.threshold,
              result_path: path.join(agentDir, 'result.json'),
              // Faces the source rendered that the AEM page could not load: a delivery defect.
              font_fallback: shared.font_fallback,
              fonts: fs.existsSync(fontsPath) ? fontsPath : null,
              // What component agents found outside their own files.
              reported: shared.hints,
              page_composite: compositeWithEvidence(parity.page_composite),
              deltas: shared.components.map((id) => parity.results.filter((row) => row.component_id === id).map(withEvidence)),
            }, null, 2),
            '```',
          ].join('\n'),
          workspace,
          workspaceRoot,
          scopePaths: sharedPaths,
          agentDir,
          trackExtra: {
            phase: 'remediation', round: ledger.round, batch: shared.batch_id, component_id: shared.components.join('+') || 'shared',
          },
        });

        // No component attempt is charged: each blamed component still gets its own agent below.
        if (verdict.changes.valid && verdict.invocation.status === 'PASS' && !verdict.problem) {
          const merged = mergeChanges(workspace, repoRoot, verdict.changes, new Map(), guard);
          merged.edited.forEach((file) => edited.add(file));
          if (!merged.edited.length) {
            merged.applied.forEach((file) => roundChanged.add(file));
            sharedRepair = { changed_files: verdict.changes.changed, notes: verdict.invocation.result?.notes || null };
          }
        } else {
          renderer.note(`shared repair not applied: ${notMerged(verdict)}`);
        }
      } finally {
        removeWorkspace(workspaceRoot);
      }
      for (const file of guard.drift()) edited.add(file);
    }

    // One agent per batch, all at once up to --max-parallel; a page batch only ever comes alone.
    // An edit made during the shared repair stops the round before any of them starts.
    const roundBatches = edited.size ? [] : routed.batches;
    for (const batch of roundBatches) {
      renderer.note(`round ${ledger.round} | ${batch.scope} batch | ${batch.layer} | ${batch.components.join(', ')}`);
    }
    await pool(roundBatches, options.maxParallel, async (batch) => {
      const ids = batch.components;
      // A page batch owns every component, so name it for the scope instead of concatenating ids.
      const label = batch.scope === 'page' ? 'page' : ids.join('-');
      const ledgerIds = batch.scope === 'page' ? [PAGE_SCOPE_ID] : ids;
      const scopePaths = ids.flatMap((id) => byId.get(id)?.owned_paths || []);
      const workspaceRoot = path.join(evidenceDir, 'workspaces', `fix-${ledger.round}-${label}`);
      const workspace = createWorkspace(repoRoot, workspaceRoot, options.workspace);
      workspace.id = `fix-${label}`;
      const agentDir = path.join(evidenceDir, 'agents', `remediation-${ledger.round}-${label}`);
      const deltas = ids.map((id) => parity.results.filter((row) => row.component_id === id).map(withEvidence));

      try {
        const verdict = await runRepair({
          id: `fix-${label}`,
          prompt: [
            readPrompt('_contract.md'), '', readPrompt('remediation.md'), '',
            '## Task', '',
            '```json',
            JSON.stringify({
              round: ledger.round,
              batch: batch.batch_id,
              owning_layer: batch.layer,
              components: ids,
              owned_paths: scopePaths,
              // The widths this component is failing at; one edit has to hold at all of them.
              breakpoints: batch.breakpoints,
              threshold: parity.threshold,
              // What earlier rounds already tried, so a rejected hypothesis is not tried again.
              attempts: ledgerIds.map((id) => ({
                id,
                history: (id === PAGE_SCOPE_ID ? ledger.page : ledger.components.get(id))?.history || [],
              })),
              result_path: path.join(agentDir, 'result.json'),
              // Per-component crops cannot show a missing or reordered section; the page can.
              page_composite: compositeWithEvidence(parity.page_composite),
              deltas,
              ...(sharedRepair ? { shared_repair: sharedRepair } : {}),
            }, null, 2),
            '```',
          ].join('\n'),
          workspace,
          workspaceRoot,
          scopePaths,
          agentDir,
          trackExtra: {
            phase: 'remediation', round: ledger.round, batch: batch.batch_id, component_id: ids.join('+'),
          },
        });
        const { invocation, changes } = verdict;
        const defect = invocation.result?.shared_defect;
        if (defect?.layer && batch.scope !== 'page') {
          for (const id of ids) sharedHints.push({ component_id: id, layer: defect.layer, evidence: defect.evidence || null });
        }

        if (changes.valid && invocation.status === 'PASS' && !verdict.problem) {
          const merged = mergeChanges(workspace, repoRoot, changes, new Map(), guard);
          if (merged.edited.length) {
            merged.edited.forEach((file) => edited.add(file));
            return invocation;
          }
          merged.applied.forEach((file) => roundChanged.add(file));
          for (const id of ledgerIds) {
            recordAttempt(ledger, {
              componentId: id,
              batchId: batch.batch_id,
              layer: batch.layer,
              hypothesis: invocation.result?.notes,
              changedFiles: changes.changed,
            });
          }
        } else {
          for (const id of ledgerIds) {
            recordAttempt(ledger, {
              componentId: id,
              batchId: batch.batch_id,
              layer: batch.layer,
              hypothesis: notMerged(verdict),
            });
          }
        }
        return invocation;
      } finally {
        removeWorkspace(workspaceRoot);
      }
    });
    for (const file of guard.drift()) edited.add(file);
    if (edited.size) {
      const files = [...edited].sort();
      writeJson(path.join(evidenceDir, 'remediation-ledger.json'), ledgerSnapshot(ledger));
      endPhase(phase, 'FAIL', describeEdits(files, 'remediation', runId));
      return {
        status: 'FAIL', phases, state, plan, parity, ledger: ledgerSnapshot(ledger), edited: files,
      };
    }
    if (!roundChanged.size) {
      // Nothing was merged, so nothing can measure differently; the attempts are already charged.
      renderer.note(`round ${ledger.round}: no repair was merged, so there is nothing to redeploy or re-measure`);
      continue;
    }

    // Only the modules this round touched, on top of the full build the deploy phase installed.
    const redeploy = await runDeployment({
      repoRoot,
      steps: planScopedDeployment(options.aemPort, [...roundChanged]),
      renderer,
      execFn,
      logPath: path.join(evidenceDir, 'deploy.log'),
      writeLog: fs.appendFileSync,
    });
    if (redeploy.status !== 'PASS') {
      renderer.warn(`remediation redeploy failed at ${redeploy.failure.step} (${redeploy.failure.kind}); see deploy.log`);
      break;
    }
    // A fix that leaves the bundle unresolved would be measured as if it had deployed.
    const redeployBundles = await checkBundles();
    if (redeployBundles.status === 'FAIL') {
      renderer.note(`remediation left bundles unresolved:\n${describeBrokenBundles(redeployBundles.broken)}`);
      break;
    }

    cycle += 1;
    const next = await runParity(cycle);
    if (!next.artefact) {
      renderer.note(`${next.error}; keeping the last measured cycle and stopping remediation`);
      break;
    }
    parity = next.artefact;
    noteDrift(parity);
    applyParity(ledger, parity);
  }
  // The loop can stop on its own bound, leaving entries merely FAILING; unresolved is final.
  if (parity.status !== 'PASS') finalizeLedger(ledger);
  const terminal = terminalStatus(ledger);
  writeJson(path.join(evidenceDir, 'remediation-ledger.json'), ledgerSnapshot(ledger));
  endPhase(phase, terminal.status, `${terminal.passed.length} passed, ${terminal.failed_final.length} failed-final, ${rounds} round(s)`);

  // Pages outside this migration, against how they rendered before this run's first install.
  let regression = null;
  if (await captureRegression('after')) {
    await runTool('regression', [path.join(toolsDir, 'regression.mjs'), '--compare', '--out', regressionDir]);
    regression = readJson(path.join(regressionDir, 'regression.json'));
    const changed = [...new Set((regression?.pages || []).filter((entry) => entry.status === 'CHANGED').map((entry) => entry.url))];
    if (changed.length) renderer.warn(`other pages render differently than before this run: ${changed.join(', ')} (see regression/)`);
  }

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
      previews: entry.previews || [],
    })),
    deployment,
    timings: timings.summary(),
    fonts: fonts || readJson(fontsPath),
    regression,
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

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // Listing what the account can use is a question about the account, not about a migration.
  if (options.listModels) {
    ensureCopilot();
    findCopilot();
    const models = await listAvailableModels();
    console.log('\nModels available to the authenticated GitHub account:');
    models.forEach((model, index) => console.log(describeModel(model, index)));
    return;
  }

  if (options.help || !options.siteUrl) {
    console.log(`
orchestrator/run.mjs — multi-agent AEM migration

  --url <url>               Live source URL (required)
  --target-path <path>      AEM page path, e.g. /content/site/us/en/page (required)
  --aem-host <host>         Default from AEM_HOST or localhost
  --aem-port <port>         Default from AEM_PORT or 4502
  --aem-user <name>         Default from AEM_USER or admin; password from AEM_PASSWORD
  --breakpoints <list>      Default 375,768,1440
  --settle-ms <n>           Discovery settle before scanning (default ${DEFAULTS.settleMs});
                            raised automatically on one retry if the layout is still moving
  --max-parallel <n>        Component workers in flight (default ${DEFAULTS.maxParallel})
  --validation-parallel <n> Maven checks of finished workers in flight (default ${DEFAULTS.validationParallel})
  --component-attempts <n>  Attempts per component before the run fails (default ${DEFAULTS.componentAttempts})
  --preview-rounds <n>      Early deploy-and-measure rounds per merged component (default ${DEFAULTS.previewRounds})
  --no-preview              Build every component before anything is deployed or measured
  --agent-idle-minutes <n>  Relaunch an agent whose stream is silent this long (default ${DEFAULTS.agentIdleMinutes})
  --no-regression           Skip the before/after capture of other pages in the content package
  --visual-pass-ratio <n>   Pin the minimum ratio; otherwise derived from effort
                            (${Object.entries(EFFORT_THRESHOLDS).map(([k, v]) => `${k} ${v}`).join(', ')})
  --max-parity-retries <n>  Attempts per component before it is failed-final (default ${DEFAULTS.maxParityRetries})
  --model <id>              Model id or name; chosen from the account's list when omitted
  --effort <level>          Limited to what the chosen model advertises; asked for when omitted
                            One model and one effort govern every agent in the run
  --list-models             List the models this GitHub account can use, then exit
  --evidence-dir <path>
  --resume <run-id|path>    Continue a previous run, reusing every phase it verifiably finished
                            and the model and effort it started with
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

  const scratchDir = path.join(defaultRepoRoot, 'design', 'scratch');
  const resumeDir = options.resume
    ? [
      path.resolve(defaultRepoRoot, options.resume),
      path.join(scratchDir, options.resume),
      path.join(scratchDir, `migration-${options.resume}`),
    ].find((candidate) => fs.existsSync(candidate))
    : null;
  if (options.resume && !resumeDir) {
    throw new Error(`--resume ${options.resume}: no such run under design/scratch.`);
  }

  const runId = resumeDir ? path.basename(resumeDir).replace(/^migration-/, '') : crypto.randomUUID();
  const evidenceDir = resumeDir || (options.evidenceDir
    ? path.resolve(defaultRepoRoot, options.evidenceDir)
    : path.join(scratchDir, `migration-${runId}`));
  fs.mkdirSync(evidenceDir, { recursive: true });

  ensureCopilot();
  const copilot = findCopilot();

  // A resume inherits what the run began with, so only what is still unanswered is asked for.
  const banked = options.resume ? readJson(path.join(evidenceDir, TUNING_FILE)) : null;
  options.model = options.model ?? banked?.model ?? null;
  options.effort = options.effort ?? banked?.effort ?? null;

  const models = await listAvailableModels();

  if (!options.model || !options.effort) {
    if (!process.stdin.isTTY) {
      throw new Error('--model and --effort are required when stdin is not a terminal.'
        + ' Run with --list-models to see what this account can use.');
    }
  }
  const settled = process.stdin.isTTY && (!options.model || !options.effort)
    ? await promptForTuning(models, { model: options.model, effort: options.effort })
    : selectTuning(models, { model: options.model, effort: options.effort });
  options.model = settled.model;
  options.effort = settled.effort;

  const renderer = createRenderer({ stageIds: PHASES });
  renderer.runHeader({
    siteUrl: options.siteUrl,
    aemUrl: `http://${options.aemHost}:${options.aemPort}`,
    runId,
    evidenceDir: path.relative(defaultRepoRoot, evidenceDir),
    model: options.model || 'auto',
    effort: options.effort,
  });

  const gate = options.thresholdPinned ? options.threshold : thresholdForEffort(options.effort, options.threshold);
  console.log(`  parity gate > ${(gate * 100).toFixed(0)}%`
    + `${options.thresholdPinned ? ' (pinned)' : ` (from ${options.effort || 'model-managed'} effort)`}`
    + `, ${options.maxParityRetries} remediation round(s) max\n`);

  if (options.dryRun) {
    console.log('Dry run: inputs valid, evidence directory created, no agents started.');
    return;
  }

  console.log(`  capture tools: ${await ensureTools({ log: (text) => console.log(`  ${text}`) })}\n`);

  const { spawn } = await import('node:child_process');
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
      timings: outcome.timings,
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
