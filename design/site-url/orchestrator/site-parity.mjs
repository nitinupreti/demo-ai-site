/**
 * Site parity: every migrated page scored against its live source by the frozen parity tool, one run
 * per page, then a bounded remediation loop over the components those runs blame. A component renders
 * on many pages, so its verdict and its attempt budget span all of them: one edit has to hold on every
 * page and at every breakpoint it appears on. Every score is read from a parity.json, never computed here.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_VISUAL_PASS_RATIO } from '../tools/lib/contracts.mjs';
import { runAgentRole } from './agent.mjs';
import { splitUnitId } from './catalog.mjs';
import {
  describeBrokenBundles, planDeployment, runDeployment, runValidation, validationPlan, verifyBundles,
} from './deploy.mjs';
import { findPath, getAttribute } from './jcr-xml.mjs';
import { parityComponents } from './plan.mjs';
import {
  advanceRound, applyParity, createLedger, environmentBlocked, finalizeLedger, ledgerSnapshot,
  PAGE_SCOPE_ID, recordAttempt, routeFailures, terminalStatus,
} from './remediation.mjs';
import {
  collectChanges, createWorkspace, mergeChanges, removeWorkspace, watchTree,
} from './workspaces.mjs';

const siteUrlDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PARITY_TOOL = path.join(siteUrlDir, 'tools', 'parity.mjs');
const readPrompt = (name) => fs.readFileSync(path.join(siteUrlDir, 'prompts', name), 'utf8');

// Each run drives a browser through the source and AEM at every breakpoint; two at a time is gentle on both.
export const PARITY_PARALLEL = 2;
// A component on many pages fails in many rows: its agent gets the worst few in full, the rest as a list.
const DELTA_ROWS = 6;
const COMPOSITES = 6;
/** What a site's shared repair may change: the design layer site foundations wrote. */
export const SITE_SHARED_PATHS = ['ui.frontend/src/main/webpack'];

const SITE_REMEDIATION = [
  '## Site mode',
  '',
  'The component you fix renders blocks on several pages of one migrated site, and each page was scored',
  'on its own against its live source. `failing` lists every block that did not pass: its page, unit,',
  'breakpoint, ratio and reason. `deltas` holds the worst of them in full, and `page_composite` the pages',
  'they sit on, keyed `<page>@<breakpoint>-<mode>`. One edit changes every page the component is on, so',
  'it has to hold on all of them, not only on the worst one.',
  '',
  'Page content was authored by the orchestrator from the capture and is not yours: fix how the component',
  'renders it (HTL, model, CSS, JS), never the content. A CSS or JS file you add inside your owned paths',
  'is added to the component clientlib for you. Your change is built before it is merged; one that does',
  'not build is discarded and counts as an attempt.',
].join('\n');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const percent = (ratio) => (typeof ratio === 'number' ? `${(ratio * 100).toFixed(2)}%` : 'n/a');
const isNumber = (value) => typeof value === 'number';
const cssString = (value) => String(value).replace(/["\\]/g, '\\$&');

/**
 * Why a page's whole-page check failed, grouped by cause with the widths it failed at. A screenshot can
 * be 98% alike while the spacing between blocks is wrong, so the cause is named and the score never stands alone.
 */
function pageFailures(composites, threshold) {
  const causes = new Map();
  for (const [key, entry] of composites) {
    if (entry.status === 'PASS') continue;
    const reasons = entry.status === 'WITHHELD' ? ['screenshots not comparable'] : [
      ...(isNumber(entry.ratio) && entry.ratio <= threshold ? [`screenshot only ${percent(entry.ratio)} alike`] : []),
      ...(entry.failure_reason ? ['page size differs'] : []),
      ...(entry.gap_failure_reason ? ['spacing between blocks differs'] : []),
    ];
    const cause = reasons.join(', ') || 'failed';
    causes.set(cause, [...(causes.get(cause) || []), Number.parseInt(key, 10)]);
  }
  return [...causes].map(([cause, widths]) => `${cause} at ${widths.join(', ')}`);
}

/** What failed on one page, in words: the components that failed and the whole-page checks that did not hold. */
export function pageProblems(entry) {
  return [
    ...(entry.failing_components?.length ? [`${entry.failing_components.join(', ')} fail`] : []),
    ...(entry.page_failures || []).map((cause) => `whole page: ${cause}`),
    ...(entry.error ? [entry.error] : []),
  ];
}

/** The id Core Components give a component no author named: its type's name and a hash of its path. */
export function generatedId(resourceType, resourcePath) {
  const prefix = String(resourceType || '').split('/').pop();
  return `${prefix}-${crypto.createHash('sha256').update(resourcePath).digest('hex').slice(0, 10)}`;
}

/**
 * How a page's content container renders: the id it carries, an authored one or else the generated
 * one, and whether its children sit in a responsive grid. Every page takes the node from the template.
 */
export function contentContainer(template, pagePath) {
  const node = findPath(template.initial.root, ['jcr:content', ...template.container.split('/')]);
  const authored = String(getAttribute(node, 'id') || '').trim().replace(/\s+/g, '-');
  return {
    id: authored || generatedId(getAttribute(node, 'sling:resourceType'), `${pagePath}/jcr:content/${template.container}`),
    grid: getAttribute(node, 'layout') === 'responsiveGrid',
  };
}

const childAt = (parent, grid, position) => `${parent} > ${grid ? '.aem-Grid > ' : ''}:nth-child(${position})`;

/**
 * Every block AEM renders for one page, with the element that renders it. The page's own blocks are its
 * content container's children in compose order; its chrome is the matching child of the fragment the
 * template includes. A position is exact where a class is not: a decoration class can repeat inside
 * another component, a child's index in its container cannot.
 */
export function pageTargets({
  coverage, fragments, catalog, container,
}) {
  const targets = [];
  for (const unit of catalog.pages.find((entry) => entry.id === coverage.page)?.units || []) {
    const entry = catalog.units[unit]?.chrome;
    if (!entry) continue;
    for (const [slot, nodes] of Object.entries(fragments || {})) {
      const index = nodes.findIndex((node) => node.entry === entry);
      if (index < 0) continue;
      targets.push({
        unit,
        component: nodes[index].component,
        slot,
        target: { css: childAt(`.cmp-experiencefragment--${slot} > .cmp-container`, true, index + 1), match_index: 0 },
      });
    }
  }
  (coverage.nodes || []).forEach((node, index) => targets.push({
    unit: node.unit,
    component: node.component,
    slot: null,
    target: { css: childAt(`[id="${cssString(container.id)}"]`, container.grid, index + 1), match_index: 0 },
  }));
  return targets;
}

/** One page's parity config: its live address, its AEM page, and every block scored where discovery saw it. */
export function pageParityConfig({
  runId, page, targets, aemUrl, breakpoints, threshold, username, onNested,
}) {
  const byComponent = new Map();
  for (const entry of targets) {
    if (!byComponent.has(entry.component)) byComponent.set(entry.component, []);
    byComponent.get(entry.component).push({ instance: splitUnitId(entry.unit).instance, target: entry.target });
  }
  const components = parityComponents(
    { components: [...byComponent].map(([id, parityTargets]) => ({ id, parity_targets: parityTargets })) },
    page.discovery,
    breakpoints,
    { onNested },
  );
  return {
    run_id: runId,
    source_url: page.discovery?.source?.final_url || page.url,
    targets: [{ mode: 'disabled', url: `${aemUrl}${page.aem_path}.html?wcmmode=disabled` }],
    breakpoints,
    threshold,
    auth: { username, password_env: 'AEM_PASSWORD' },
    components,
  };
}

/**
 * Asks AEM for every page once before anything is scored. A container or fragment the selectors cannot
 * find would withhold every block on its page, and that is a template fact no component agent can fix.
 */
export async function locateTargets(jobs, {
  aemUrl, username, password, fetchFn = fetch,
}) {
  const headers = { authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}` };
  const found = await pool(jobs, 4, async (job) => {
    const where = job.page.aem_path;
    let html;
    try {
      const response = await fetchFn(`${aemUrl}${where}.html?wcmmode=disabled`, { headers, redirect: 'manual' });
      if (response.status !== 200) return [`${where} answers HTTP ${response.status}`];
      html = await response.text();
    } catch (error) {
      return [`${where} is unreachable: ${error.message}`];
    }
    const problems = [];
    if (job.content && !html.includes(`id="${job.container.id}"`)) {
      problems.push(`${where} renders no content container with id "${job.container.id}"`);
    }
    for (const slot of job.slots) {
      if (!html.includes(`cmp-experiencefragment--${slot}`)) problems.push(`${where} renders no ${slot} fragment (.cmp-experiencefragment--${slot})`);
    }
    return problems;
  });
  return found.flat();
}

async function scorePage({ runTool, job, cycle }) {
  const artefactPath = path.join(job.dir, 'parity.json');
  const log = path.join(job.dir, `parity-cycle-${cycle}.log`);
  // A crashed run would leave an earlier session's artefact behind, carrying a cycle number this one reuses.
  fs.rmSync(artefactPath, { force: true });
  const outcome = await runTool('parity', [
    PARITY_TOOL, '--config', job.configPath, '--out', job.dir, '--cycle', String(cycle),
  ], { log });
  const artefact = readJson(artefactPath);
  if (!artefact || artefact.cycle !== cycle) {
    return { artefact: null, error: `parity exited ${outcome?.code ?? 'abnormally'} without a cycle ${cycle} artefact; see ${log}` };
  }
  fs.copyFileSync(artefactPath, path.join(job.dir, `parity-cycle-${cycle}.json`));
  return { artefact, error: null };
}

/** One component across every page it was scored on, rolled up the way parity.mjs rolls up one page. */
function rollUp(results) {
  const ascending = (left, right) => left - right;
  return [...new Set(results.map((row) => row.component_id))].map((componentId) => {
    const rows = results.filter((row) => row.component_id === componentId);
    const failing = rows.filter((row) => row.status !== 'PASS');
    const ratios = rows.map((row) => row.visual_match_ratio).filter(isNumber);
    const progress = rows.map((row) => (isNumber(row.visual_match_ratio) ? row.visual_match_ratio : row.progress_ratio)).filter(isNumber);
    // The layer most of its failures point at; one odd page should not steer the whole repair.
    const hints = new Map();
    for (const row of failing) if (row.owning_layer_hint) hints.set(row.owning_layer_hint, (hints.get(row.owning_layer_hint) || 0) + 1);
    const failedGates = new Set();
    const breakpoints = {};
    for (const row of rows) {
      for (const [category, value] of Object.entries(row.gates || {})) if (value === 'FAIL') failedGates.add(category);
      const key = `${row.breakpoint}-${row.mode}`;
      const entry = breakpoints[key] || { status: 'PASS', ratio: null };
      if (row.status !== 'PASS') entry.status = 'FAIL';
      if (isNumber(row.visual_match_ratio)) entry.ratio = entry.ratio === null ? row.visual_match_ratio : Math.min(entry.ratio, row.visual_match_ratio);
      breakpoints[key] = entry;
    }
    const scored = [...new Set(rows.map((row) => row.breakpoint))].sort(ascending);
    const failed = [...new Set(failing.map((row) => row.breakpoint))].sort(ascending);
    return {
      component_id: componentId,
      status: !failing.length ? 'PASS' : failing.every((row) => row.status === 'WITHHELD') ? 'WITHHELD' : 'FAIL',
      min_ratio: ratios.length ? Math.min(...ratios) : null,
      min_progress_ratio: progress.length ? Math.min(...progress) : null,
      owning_layer_hint: [...hints].sort((left, right) => right[1] - left[1])[0]?.[0] || null,
      failed_gates: [...failedGates],
      scored_breakpoints: scored,
      failed_breakpoints: failed,
      breakpoint_scope: !failed.length ? 'none' : failed.length === scored.length ? 'all' : 'partial',
      breakpoints,
      pages: [...new Set(rows.map((row) => row.page))],
      failed_pages: [...new Set(failing.map((row) => row.page))],
      units_scored: new Set(rows.map((row) => row.unit)).size,
      units_failed: new Set(failing.map((row) => row.unit)).size,
    };
  });
}

/**
 * One site-wide view of the per-page runs, in the shape the remediation ledger reads: every row with its
 * page and unit, every component rolled up across its pages, every page composite keyed by page. Evidence
 * paths become absolute, since agents read them from their own copy of the repository.
 */
export function mergeSiteParity(runs, { threshold, cycle = null, unscored = [] } = {}) {
  const results = [];
  const composites = {};
  const checks = [];
  const pages = [];
  let blocked = false;
  for (const run of runs) {
    const { page, artefact } = run;
    const absolute = (value) => (value ? path.resolve(run.dir, value) : null);
    for (const row of artefact?.results || []) {
      results.push({
        ...row,
        page: page.id,
        aem_path: page.aem_path,
        unit: row.instance ? `${page.id}/${row.instance}` : null,
        side_by_side: absolute(row.side_by_side),
        diff_mask: absolute(row.diff_mask),
        source: { ...row.source, screenshot: absolute(row.source?.screenshot) },
        target: { ...row.target, screenshot: absolute(row.target?.screenshot) },
      });
    }
    const pageComposites = Object.entries(artefact?.page_composite || {});
    for (const [key, entry] of pageComposites) {
      composites[`${page.id}@${key}`] = {
        ...entry,
        page: page.id,
        aem_path: page.aem_path,
        source: absolute(entry.source),
        target: absolute(entry.target),
        mask: absolute(entry.mask),
        side_by_side: absolute(entry.side_by_side),
      };
    }
    if (artefact?.preflight?.environment_blocked === true) blocked = true;
    checks.push(...(artefact?.preflight?.checks || []).map((check) => ({ ...check, page: page.id })));
    const ratios = pageComposites.map(([, entry]) => entry.ratio).filter(isNumber);
    pages.push({
      page: page.id,
      aem_path: page.aem_path,
      source_url: artefact?.source_url || page.discovery?.source?.final_url || page.url || null,
      status: artefact ? artefact.status : 'ERROR',
      error: run.error || null,
      components_passed: artefact?.summary?.components_passed ?? 0,
      components_total: artefact?.summary?.components_total ?? 0,
      failing_components: [...new Set((artefact?.results || []).filter((row) => row.status !== 'PASS').map((row) => row.component_id))],
      page_failures: pageFailures(pageComposites, artefact?.threshold ?? threshold),
      composite_ratio: ratios.length ? Math.min(...ratios) : null,
      composite_status: !pageComposites.length ? null
        : pageComposites.every(([, entry]) => entry.status === 'PASS') ? 'PASS' : 'FAIL',
    });
  }

  const components = rollUp(results);
  const ratios = results.map((row) => row.visual_match_ratio).filter(isNumber);
  return {
    cycle,
    threshold,
    status: pages.length && pages.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL',
    preflight: {
      status: runs.length && runs.every((run) => run.artefact?.preflight?.status === 'PASS') ? 'PASS' : 'FAIL',
      environment_blocked: blocked,
      checks,
    },
    pages,
    unscored,
    results,
    components,
    page_composite: composites,
    summary: {
      pages_total: pages.length,
      pages_passed: pages.filter((entry) => entry.status === 'PASS').length,
      components_total: components.length,
      components_passed: components.filter((entry) => entry.status === 'PASS').length,
      components_failed: components.filter((entry) => entry.status === 'FAIL').length,
      components_withheld: components.filter((entry) => entry.status === 'WITHHELD').length,
      blocks_scored: results.filter((row) => row.status === 'PASS' || row.status === 'FAIL').length,
      min_ratio: ratios.length ? Math.min(...ratios) : null,
    },
  };
}

/** A remediation may add a component stylesheet or script, and the clientlib only loads what its index lists. */
export function syncClientlibIndexes(repoRoot, plan) {
  const written = [];
  for (const [indexPath, base] of [[plan.shared.clientlib_index, 'css'], [plan.shared.clientlib_js_index, 'js']]) {
    const file = path.join(repoRoot, indexPath);
    const lines = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : [`#base=${base}`];
    const missing = plan.components.map((component) => `${component.id}.${base}`)
      .filter((name) => !lines.includes(name) && fs.existsSync(path.join(path.dirname(file), base, name)));
    if (!missing.length) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${[...lines, ...missing].join('\n')}\n`, 'utf8');
    written.push(indexPath);
  }
  return written;
}

const progressOf = (row) => row.visual_match_ratio ?? row.progress_ratio ?? -1;

function failingComposites(parity, pages = null) {
  return Object.fromEntries(Object.entries(parity.page_composite)
    .filter(([, entry]) => (pages ? pages.has(entry.page) : entry.status !== 'PASS'))
    .slice(0, COMPOSITES));
}

/** What one batch's agent is shown: every failing block in brief, the worst few in full, and their pages. */
export function batchEvidence(parity, ids) {
  const failing = parity.results.filter((row) => ids.includes(row.component_id) && row.status !== 'PASS');
  return {
    failing: failing.map((row) => ({
      component: row.component_id,
      page: row.page,
      aem_path: row.aem_path,
      unit: row.unit,
      breakpoint: row.breakpoint,
      status: row.status,
      ratio: row.visual_match_ratio ?? null,
      progress: row.progress_ratio ?? null,
      reason: row.withheld_reason || null,
      owning_layer_hint: row.owning_layer_hint || null,
      side_by_side: row.side_by_side || null,
    })),
    deltas: ids.map((id) => failing.filter((row) => row.component_id === id)
      .sort((left, right) => progressOf(left) - progressOf(right))
      .slice(0, DELTA_ROWS)),
    page_composite: failingComposites(parity, new Set(failing.map((row) => row.page))),
  };
}

const pageLine = (entry) => {
  const problems = pageProblems(entry);
  return `    ${entry.page}  ${entry.status.padEnd(5)} ${entry.components_passed}/${entry.components_total} components pass`
    + `${problems.length ? ` | ${problems.join(' | ')}` : ''}  ${entry.aem_path}`;
};

/**
 * The parity and remediation phases of a site build. Every page is scored; then each failing component
 * spends its budget in rounds: a shared repair first when the design layer is blamed, one agent per
 * failing component in its own copy of the repository, a build check, a redeploy, and every page scored
 * again. Returns the final measurement, the ledger, and whether every gate now holds.
 */
export async function runSiteParity(options, {
  renderer, runId, evidenceDir, repoRoot, print, execFn, fetchFn, spawnFn, copilot, runTool, start, end, aemUrl,
  plan, catalog, pages, composed, template,
}) {
  const threshold = isNumber(options.threshold) ? options.threshold : DEFAULT_VISUAL_PASS_RATIO;
  const retries = options.maxParityRetries ?? 2;
  const tuning = { model: options.model || null, effort: options.effort || null };
  const parityDir = path.join(evidenceDir, 'parity');
  const sitePath = path.join(parityDir, 'site-parity.json');
  const ledgerPath = path.join(evidenceDir, 'remediation-ledger.json');
  const username = options.aemUser || 'admin';
  const password = process.env.AEM_PASSWORD;

  // Parity: one run per page, every block where discovery saw it, then one view of the whole site.
  let phase = start('parity');
  const coverage = new Map(composed.coverage.map((entry) => [entry.page, entry]));
  const jobs = [];
  const unscored = [];
  for (const page of pages) {
    const entry = coverage.get(page.id);
    if (!entry) continue;
    const container = contentContainer(template, page.aem_path);
    const targets = pageTargets({
      coverage: entry, fragments: composed.fragments, catalog, container,
    });
    const config = pageParityConfig({
      runId,
      page,
      targets,
      aemUrl,
      breakpoints: options.breakpoints,
      threshold,
      username,
      onNested: (row, host, share) => print(`    ${page.id} ${row.instance} @${row.source.bp}px is scored inside ${host.instance} (${Math.round(share * 100)}% of it)`),
    });
    if (!config.components.length) {
      unscored.push(page.id);
      continue;
    }
    const dir = path.join(parityDir, page.id);
    jobs.push({
      page,
      container,
      dir,
      configPath: writeJson(path.join(dir, 'parity-config.json'), config),
      content: targets.some((target) => !target.slot),
      slots: [...new Set(targets.map((target) => target.slot).filter(Boolean))],
    });
  }
  if (!jobs.length) {
    const reason = 'no page has a block parity can compare: discovery resolved no selector for any authored block';
    end(phase, 'FAIL', reason);
    return {
      status: 'FAIL', parity: null, ledger: null, rounds: 0, reason,
    };
  }
  const missing = await locateTargets(jobs, {
    aemUrl, username, password, fetchFn,
  });
  if (missing.length) {
    for (const problem of missing.slice(0, 8)) print(`    ${problem}`);
    const reason = `AEM does not render ${missing.length} element(s) the scores are taken from: ${missing[0]}`;
    end(phase, 'FAIL', reason);
    return {
      status: 'FAIL', parity: null, ledger: null, rounds: 0, reason,
    };
  }
  const measure = async (cycle) => {
    const runs = await pool(jobs, PARITY_PARALLEL, async (job) => ({
      page: job.page, dir: job.dir, ...(await scorePage({ runTool, job, cycle })),
    }));
    const merged = mergeSiteParity(runs, { threshold, cycle, unscored });
    for (const entry of merged.pages) print(pageLine(entry));
    return { merged, broken: runs.filter((run) => !run.artefact) };
  };

  let cycle = 0;
  const first = await measure(cycle);
  let parity = first.merged;
  writeJson(sitePath, parity);
  if (first.broken.length) {
    end(phase, 'FAIL', `${first.broken.length} page(s) could not be scored: ${first.broken[0].error}`);
    return { status: 'FAIL', parity, ledger: null, rounds: 0 };
  }
  const { summary } = parity;
  end(phase, parity.status, `${summary.pages_passed}/${summary.pages_total} pages, ${summary.components_passed}/${summary.components_total} components,`
    + ` lowest block ${percent(summary.min_ratio)}, gate > ${percent(threshold)} per block${unscored.length ? `; ${unscored.length} page(s) with nothing to compare` : ''}`);

  // Remediation: bounded rounds, and a component's budget spans every page it is on.
  phase = start('remediation');
  const byId = new Map(plan.components.map((component) => [component.id, component]));
  const ownedPaths = (id) => byId.get(id)?.owned_paths || [];
  // Code authored a mapped component's blocks and no agent owns its files, so only the last score speaks for it.
  const ledger = createLedger(parity.components.map((entry) => entry.component_id).filter((id) => ownedPaths(id).length), { retries });
  applyParity(ledger, parity);
  const blocked = environmentBlocked(parity);
  if (blocked) {
    writeJson(ledgerPath, ledgerSnapshot(ledger));
    end(phase, 'FAIL', `${blocked}; fix the target or its credentials, then rerun`);
    return {
      status: 'FAIL', parity, ledger: ledgerSnapshot(ledger), rounds: 0,
    };
  }

  let rounds = 0;
  while (parity.status !== 'PASS' && rounds < retries) {
    if (advanceRound(ledger).done) break;
    const routed = routeFailures(parity, plan, ledger);
    if (!routed.batches.length) break;
    rounds += 1;
    // Watched per round, because the redeploy between rounds regenerates build output in the tree.
    const guard = watchTree(repoRoot, options.workspace);
    const edited = new Set();

    const fix = async ({
      label, scopePaths, task, prompt, validate,
    }) => {
      const workspaceRoot = path.join(evidenceDir, 'workspaces', `fix-${ledger.round}-${label}`);
      const workspace = createWorkspace(repoRoot, workspaceRoot, options.workspace);
      workspace.id = `fix-${label}`;
      const agentDir = path.join(evidenceDir, 'agents', `remediation-${ledger.round}-${label}`);
      try {
        const invocation = await runAgentRole({
          copilot,
          role: 'remediation',
          id: `fix-${label}`,
          prompt: [
            readPrompt('_contract.md'), '', ...prompt, '',
            '## Task', '', '```json',
            JSON.stringify({ ...task, result_path: path.join(agentDir, 'result.json') }, null, 2),
            '```',
          ].join('\n'),
          cwd: workspaceRoot,
          ...tuning,
          agentDir,
          renderer,
          spawnFn,
        });
        const changes = collectChanges(workspace, scopePaths);
        if (!changes.valid) return { reason: `wrote outside its scope: ${changes.violations.slice(0, 4).join(', ')}` };
        if (invocation.status !== 'PASS') return { reason: invocation.error || `its result reported ${invocation.status}` };
        if (validate && changes.changed.length) {
          const validation = await runValidation({ workspaceRoot, steps: validationPlan(changes.changed), execFn });
          if (validation.status !== 'PASS') return { reason: `its change does not build (${validation.label}): ${validation.detail.split('\n')[0]}` };
        }
        const merged = mergeChanges(workspace, repoRoot, changes, new Map(), guard);
        merged.edited.forEach((file) => edited.add(file));
        return merged.edited.length ? { edited: true } : { applied: true, changes, notes: invocation.result?.notes || null };
      } finally {
        removeWorkspace(workspaceRoot);
      }
    };

    // A shared cause is fixed once, first and alone, so every component agent builds on the fix.
    let sharedRepair = null;
    if (routed.shared) {
      const shared = routed.shared;
      renderer.note(`round ${ledger.round} | shared repair | ${shared.components.join(', ')}`);
      const outcome = await fix({
        label: 'shared',
        scopePaths: SITE_SHARED_PATHS,
        prompt: [readPrompt('site-foundations.md')],
        task: {
          mode: 'repair',
          round: ledger.round,
          batch: shared.batch_id,
          owning_layer: shared.layer,
          components: shared.components,
          owned_paths: SITE_SHARED_PATHS,
          breakpoints: shared.breakpoints,
          threshold,
          ...batchEvidence(parity, shared.components),
        },
      });
      if (outcome.applied) sharedRepair = { changed_files: outcome.changes.changed, notes: outcome.notes };
      else if (outcome.reason) renderer.note(`shared repair not applied: ${outcome.reason}`);
      for (const file of guard.drift()) edited.add(file);
    }

    // One agent per failing component, all at once up to --max-parallel; a page batch only ever comes alone.
    const batches = edited.size ? [] : routed.batches;
    await pool(batches, options.maxParallel || 4, async (batch) => {
      const pageScope = batch.scope === 'page';
      const ids = batch.components;
      const label = pageScope ? 'page' : ids.join('-');
      const scopePaths = ids.flatMap(ownedPaths);
      renderer.note(`round ${ledger.round} | ${batch.scope} batch | ${batch.layer} | ${pageScope ? 'every component' : ids.join(', ')}`);
      const outcome = await fix({
        label,
        scopePaths,
        validate: true,
        prompt: [readPrompt('remediation.md'), '', SITE_REMEDIATION],
        task: {
          round: ledger.round,
          batch: batch.batch_id,
          owning_layer: batch.layer,
          components: ids,
          owned_paths: scopePaths,
          // The widths these blocks fail at; one edit has to hold at all of them, on every page.
          breakpoints: batch.breakpoints,
          threshold,
          ...(pageScope ? { page_composite: failingComposites(parity) } : batchEvidence(parity, ids)),
          ...(sharedRepair ? { shared_repair: sharedRepair } : {}),
        },
      });
      if (outcome.edited) return;
      for (const id of pageScope ? [PAGE_SCOPE_ID] : ids) {
        recordAttempt(ledger, {
          componentId: id,
          batchId: batch.batch_id,
          layer: batch.layer,
          hypothesis: outcome.applied ? outcome.notes : outcome.reason,
          changedFiles: outcome.applied ? outcome.changes.changed : [],
        });
      }
      if (!outcome.applied) renderer.note(`${label} not applied: ${outcome.reason}`);
    });
    for (const file of guard.drift()) edited.add(file);
    if (edited.size) {
      const files = [...edited].sort();
      writeJson(ledgerPath, ledgerSnapshot(ledger));
      end(phase, 'FAIL', `${files.length} file(s) changed in the repository while remediation ran: ${files.slice(0, 6).join(', ')}. `
        + `Nothing was merged over them; finish editing, then rerun with --resume ${runId}`);
      return {
        status: 'FAIL', parity, ledger: ledgerSnapshot(ledger), rounds,
      };
    }
    for (const index of syncClientlibIndexes(repoRoot, plan)) renderer.note(`${index} now lists a file remediation added`);

    const redeploy = await runDeployment({
      repoRoot,
      steps: planDeployment(options.aemPort),
      renderer,
      execFn,
      logPath: path.join(evidenceDir, 'deploy.log'),
      writeLog: fs.appendFileSync,
    });
    if (redeploy.status !== 'PASS') {
      renderer.warn(`the redeploy after round ${ledger.round} failed (${redeploy.failure.step} exited ${redeploy.failure.exit_code}); keeping the last measurement`);
      break;
    }
    // A fix that leaves a bundle unresolved would be measured as if it had deployed.
    const bundles = await verifyBundles({
      aemUrl, username, password, fetchFn,
    });
    if (bundles.status === 'FAIL') {
      renderer.warn(`round ${ledger.round} left bundles unresolved:\n${describeBrokenBundles(bundles.broken)}`);
      break;
    }

    cycle += 1;
    const next = await measure(cycle);
    if (next.broken.length) {
      renderer.warn(`${next.broken.length} page(s) could not be scored again (${next.broken[0].error}); keeping cycle ${cycle - 1}`);
      break;
    }
    parity = next.merged;
    writeJson(sitePath, parity);
    applyParity(ledger, parity);
  }

  // The loop can stop on its own bound, leaving entries merely FAILING; unresolved is final.
  if (parity.status !== 'PASS') finalizeLedger(ledger);
  const terminal = terminalStatus(ledger);
  const unowned = parity.components.filter((entry) => !ledger.components.has(entry.component_id) && entry.status !== 'PASS');
  const status = parity.status === 'PASS' && terminal.status === 'PASS' && !unowned.length ? 'PASS' : 'FAIL';
  const snapshot = ledgerSnapshot(ledger);
  writeJson(ledgerPath, snapshot);
  end(phase, status, `${terminal.passed.length} passed, ${terminal.failed_final.length} failed-final`
    + `${unowned.length ? `, ${unowned.length} authored by code still failing` : ''}, ${rounds} round(s)`);
  return {
    status, parity, ledger: snapshot, rounds,
  };
}
