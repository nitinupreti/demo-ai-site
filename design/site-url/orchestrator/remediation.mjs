/**
 * Remediation routing and the attempt ledger. The orchestrator owns the counters, so the
 * loop is provably bounded: three attempts per component in round 1, one in round 2.
 */
export const ROUND_1_ATTEMPTS = 3;
export const ROUND_2_ATTEMPTS = 1;

/** Failures that belong to one owning layer are fixed once, not once per component. */
const SHARED_LAYERS = new Set(['typography-tokens', 'color-tokens', 'font-delivery', 'capture-readiness']);
const PLAN_LAYERS = new Set(['plan-or-selector']);

/** The whole page is an owner in its own right: no single component owns a missing section. */
export const PAGE_SCOPE_ID = '__page__';
export const PAGE_LAYER = 'page-composition';

function allEntries(ledger) {
  const entries = [...ledger.components.values()];
  if (ledger.page) entries.push(ledger.page);
  return entries;
}

/** A run with no composite measurements has nothing to fix, so it must not block the gate. */
export function compositeStatus(parity) {
  const entries = Object.values(parity.page_composite || {});
  if (!entries.length) return { measured: false, passing: true, ratios: [] };
  return {
    measured: true,
    passing: entries.every((entry) => entry.status === 'PASS'),
    ratios: entries.map((entry) => entry.ratio).filter((value) => typeof value === 'number'),
  };
}

/** A capture that never reached the page is an environment fault; no code edit can fix it. */
export function environmentBlocked(parity) {
  const preflight = parity?.preflight;
  if (!preflight || preflight.environment_blocked !== true) return null;
  const landed = (preflight.checks || [])
    .map((check) => check.target_redirected_to)
    .filter(Boolean);
  return `the target navigated away from the page under test (${[...new Set(landed)].join(', ') || 'unknown destination'})`;
}

export function createLedger(componentIds) {
  return {
    round: 1,
    components: new Map(componentIds.map((id) => [id, {
      id, round: 1, attempts: 0, status: 'PENDING', best_ratio: null, best_progress_ratio: null, history: [],
    }])),
    page: {
      id: PAGE_SCOPE_ID, round: 1, attempts: 0, status: 'PENDING', best_ratio: null, best_progress_ratio: null, history: [],
    },
    batches: [],
  };
}

export function ledgerSnapshot(ledger) {
  return {
    round: ledger.round,
    components: [...ledger.components.values()].map((entry) => ({ ...entry })),
    page: ledger.page ? { ...ledger.page } : null,
    batches: ledger.batches,
  };
}

function attemptCap(round) {
  return round === 1 ? ROUND_1_ATTEMPTS : ROUND_2_ATTEMPTS;
}

export function eligible(ledger) {
  return allEntries(ledger).filter((entry) => entry.status !== 'PASS'
    && entry.status !== 'FAILED-FINAL'
    && entry.round === ledger.round
    && entry.attempts < attemptCap(entry.round));
}

/**
 * Groups failing components by the layer that owns the defect. Component-scoped batches can
 * run in parallel; shared and plan batches are serialized because they touch one owner.
 */
export function routeFailures(parity, plan, ledger) {
  const byLayer = new Map();
  for (const component of parity.components) {
    if (component.status === 'PASS' || component.status === 'SKIPPED') continue;
    const entry = ledger.components.get(component.component_id);
    if (!entry || entry.status === 'PASS' || entry.status === 'FAILED-FINAL') continue;
    if (entry.round !== ledger.round || entry.attempts >= attemptCap(entry.round)) continue;

    const layer = component.owning_layer_hint || 'component-css';
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(component.component_id);
  }

  const order = new Map(plan.components.map((component, index) => [component.id, index]));
  const batches = [...byLayer.entries()]
    .map(([layer, components]) => ({
      batch_id: `${ledger.round}-${layer}`,
      layer,
      scope: PLAN_LAYERS.has(layer) ? 'plan' : SHARED_LAYERS.has(layer) ? 'shared' : 'component',
      // One component with several parity targets must still cost one attempt, not one per target.
      components: [...new Set(components)].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)),
    }))
    .sort((left, right) => left.layer.localeCompare(right.layer));

  // Only once no component is still fixable: a component fix usually moves the page with it, and
  // every crop can score green while the page is short, reordered or missing a section entirely.
  const page = ledger.page;
  if (!batches.length && page
    && !compositeStatus(parity).passing
    && page.status !== 'PASS' && page.status !== 'FAILED-FINAL'
    && page.round === ledger.round && page.attempts < attemptCap(page.round)) {
    batches.push({
      batch_id: `${ledger.round}-${PAGE_LAYER}`,
      layer: PAGE_LAYER,
      scope: 'page',
      components: plan.components.map((component) => component.id),
    });
  }

  return {
    batches,
    parallel: batches.filter((batch) => batch.scope === 'component'),
    serialized: batches.filter((batch) => batch.scope !== 'component'),
  };
}

export function recordAttempt(ledger, { componentId, batchId, layer, hypothesis, changedFiles }) {
  const entry = componentId === PAGE_SCOPE_ID ? ledger.page : ledger.components.get(componentId);
  if (!entry) return null;
  if (entry.attempts >= attemptCap(entry.round)) return entry;
  entry.attempts += 1;
  entry.history.push({
    round: entry.round,
    attempt: entry.attempts,
    batch_id: batchId,
    layer,
    hypothesis: hypothesis || null,
    changed_files: changedFiles || [],
    at: new Date().toISOString(),
  });
  return entry;
}

/** Applies a fresh parity run to the ledger and advances or terminates each component. */
export function applyParity(ledger, parity) {
  for (const component of parity.components) {
    const entry = ledger.components.get(component.component_id);
    if (!entry || entry.status === 'FAILED-FINAL') continue;
    if (typeof component.min_ratio === 'number') {
      entry.best_ratio = entry.best_ratio === null ? component.min_ratio : Math.max(entry.best_ratio, component.min_ratio);
    }
    // A withheld row issues no score, so without this the ledger cannot tell a fix from a regression.
    if (typeof component.min_progress_ratio === 'number') {
      entry.best_progress_ratio = entry.best_progress_ratio === null || entry.best_progress_ratio === undefined
        ? component.min_progress_ratio
        : Math.max(entry.best_progress_ratio, component.min_progress_ratio);
    }
    if (component.status === 'PASS') {
      entry.status = 'PASS';
      continue;
    }
    entry.status = 'FAILING';
    if (entry.attempts >= attemptCap(entry.round)) {
      if (entry.round === 1) {
        entry.round = 2;
        entry.attempts = 0;
        entry.status = 'FAILED-ROUND-1';
      } else {
        entry.status = 'FAILED-FINAL';
      }
    }
  }

  const composite = compositeStatus(parity);
  const page = ledger.page;
  if (page && page.status !== 'FAILED-FINAL') {
    if (!composite.measured || composite.passing) {
      page.status = 'PASS';
    } else {
      const worst = composite.ratios.length ? Math.min(...composite.ratios) : null;
      if (worst !== null) page.best_ratio = page.best_ratio === null ? worst : Math.max(page.best_ratio, worst);
      page.status = 'FAILING';
      if (page.attempts >= attemptCap(page.round)) {
        if (page.round === 1) {
          page.round = 2;
          page.attempts = 0;
          page.status = 'FAILED-ROUND-1';
        } else {
          page.status = 'FAILED-FINAL';
        }
      }
    }
  }
  return ledger;
}

export function advanceRound(ledger) {
  const remaining = allEntries(ledger)
    .filter((entry) => entry.status !== 'PASS' && entry.status !== 'FAILED-FINAL');
  if (!remaining.length) return { done: true, round: ledger.round };
  if (remaining.every((entry) => entry.round === 2)) ledger.round = 2;
  const workable = eligible(ledger);
  if (!workable.length) {
    for (const entry of remaining) entry.status = 'FAILED-FINAL';
    return { done: true, round: ledger.round };
  }
  return { done: false, round: ledger.round };
}

export function terminalStatus(ledger) {
  const entries = allEntries(ledger);
  const failed = entries.filter((entry) => entry.status === 'FAILED-FINAL');
  return {
    status: failed.length ? 'FAIL' : 'PASS',
    passed: entries.filter((entry) => entry.status === 'PASS').map((entry) => entry.id),
    failed_final: failed.map((entry) => ({ id: entry.id, best_ratio: entry.best_ratio, attempts: entry.history.length })),
  };
}
