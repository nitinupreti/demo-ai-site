/**
 * Remediation routing and ledger checks. One budget covers a component at every breakpoint, and
 * the page composite is an owner in its own right: without it a whole-page failure has no batch
 * to route to and the run dead-ends at FAIL with zero attempts made.
 */
import process from 'node:process';

import {
  advanceRound, applyParity, createLedger, DEFAULT_RETRIES, environmentBlocked, finalizeLedger,
  ledgerSnapshot, PAGE_LAYER, PAGE_SCOPE_ID, recordAttempt, routeFailures, terminalStatus,
} from './remediation.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const plan = { components: [{ id: 'hero' }, { id: 'cards' }] };

function parityFor({ components, composite, results = [] }) {
  return { components, page_composite: composite, results };
}

const allComponentsPass = [
  { component_id: 'hero', status: 'PASS', min_ratio: 0.99 },
  { component_id: 'cards', status: 'PASS', min_ratio: 0.98 },
];

// A page-level failure with every component green must still produce work.
let ledger = createLedger(['hero', 'cards']);
let parity = parityFor({
  components: allComponentsPass,
  composite: { '1440-disabled': { status: 'FAIL', ratio: 0.72 } },
});
applyParity(ledger, parity);

expect(ledger.page.status === 'FAILING', `page should be failing, got ${ledger.page.status}`);
expect(advanceRound(ledger).done === false, 'a failing page must keep the loop open');

let routed = routeFailures(parity, plan, ledger);
expect(routed.batches.length === 1, `exactly one page batch expected, got ${routed.batches.length}`);
expect(routed.batches[0].layer === PAGE_LAYER && routed.batches[0].scope === 'page',
  `the batch must be page-scoped, got ${JSON.stringify(routed.batches[0])}`);
expect(routed.serialized.length === 1 && routed.parallel.length === 0,
  'a page batch runs serialized, never in parallel');
expect(routed.batches[0].components.join(',') === 'hero,cards',
  `the page batch owns every component in plan order, got ${routed.batches[0].components}`);

// Its attempts are charged to the page, never to the components it is allowed to touch.
recordAttempt(ledger, { componentId: PAGE_SCOPE_ID, batchId: 'b', layer: PAGE_LAYER });
expect(ledger.page.attempts === 1, `page attempts should be 1, got ${ledger.page.attempts}`);
expect([...ledger.components.values()].every((entry) => entry.attempts === 0),
  'a page batch must not consume any component budget');

// Component work takes priority: a page batch only appears once nothing else is fixable.
const mixed = parityFor({
  components: [
    { component_id: 'hero', status: 'FAIL', min_ratio: 0.8, owning_layer_hint: 'spacing' },
    { component_id: 'cards', status: 'PASS', min_ratio: 0.98 },
  ],
  composite: { '1440-disabled': { status: 'FAIL', ratio: 0.72 } },
});
const mixedLedger = createLedger(['hero', 'cards']);
applyParity(mixedLedger, mixed);
const mixedRouted = routeFailures(mixed, plan, mixedLedger);
expect(mixedRouted.batches.length === 1 && mixedRouted.batches[0].layer === 'spacing',
  `a fixable component must be routed before the page, got ${JSON.stringify(mixedRouted.batches)}`);

// One budget covers every breakpoint, but the agent is still told which widths are failing.
const widthAware = parityFor({
  components: [
    { component_id: 'hero', status: 'FAIL', min_ratio: 0.8, owning_layer_hint: 'spacing' },
    { component_id: 'cards', status: 'PASS', min_ratio: 0.98 },
  ],
  composite: { '1440-disabled': { status: 'PASS', ratio: 0.99 } },
  results: [
    { component_id: 'hero', breakpoint: 375, status: 'FAIL' },
    { component_id: 'hero', breakpoint: 768, status: 'PASS' },
    { component_id: 'hero', breakpoint: 1440, status: 'FAIL' },
    { component_id: 'cards', breakpoint: 375, status: 'PASS' },
  ],
});
const widthLedger = createLedger(['hero', 'cards']);
applyParity(widthLedger, widthAware);
const widthRouted = routeFailures(widthAware, plan, widthLedger);
expect(widthRouted.batches[0].breakpoints.join(',') === '375,1440',
  `the batch must name the failing widths, got ${widthRouted.batches[0].breakpoints}`);
expect(widthRouted.batches[0].targets[0].component_id === 'hero',
  'the batch must name the component that failed');
recordAttempt(widthLedger, { componentId: 'hero', batchId: 'b', layer: 'spacing' });
expect(widthLedger.components.get('hero').attempts === 1,
  'a component failing at several widths must still cost one attempt');

// The page budget is bounded exactly like a component's, so the loop cannot spin.
ledger = createLedger(['hero', 'cards']);
for (let attempt = 0; attempt < ledger.caps[1]; attempt += 1) {
  applyParity(ledger, parity);
  recordAttempt(ledger, { componentId: PAGE_SCOPE_ID, batchId: 'b', layer: PAGE_LAYER });
}
applyParity(ledger, parity);
expect(ledger.page.round === 2, `page should fall to round 2, got round ${ledger.page.round}`);
recordAttempt(ledger, { componentId: PAGE_SCOPE_ID, batchId: 'b', layer: PAGE_LAYER });
applyParity(ledger, parity);
expect(ledger.page.status === 'FAILED-FINAL', `page should exhaust to FAILED-FINAL, got ${ledger.page.status}`);
expect(ledger.page.history.length === DEFAULT_RETRIES,
  `a component gets exactly ${DEFAULT_RETRIES} attempts, got ${ledger.page.history.length}`);
expect(terminalStatus(ledger).failed_final.some((entry) => entry.id === PAGE_SCOPE_ID),
  'an exhausted page must be reported as failed-final, not silently dropped');
expect(routeFailures(parity, plan, ledger).batches.length === 0,
  'an exhausted page must stop producing batches');

// A recovered page closes out, and a run with no composite measurement never blocks the gate.
const recovered = createLedger(['hero', 'cards']);
applyParity(recovered, parityFor({
  components: allComponentsPass,
  composite: { '1440-disabled': { status: 'PASS', ratio: 0.99 } },
}));
expect(recovered.page.status === 'PASS', `a passing composite must pass the page, got ${recovered.page.status}`);
expect(terminalStatus(recovered).status === 'PASS', 'a fully passing ledger must be PASS');

const unmeasured = createLedger(['hero', 'cards']);
applyParity(unmeasured, parityFor({ components: allComponentsPass, composite: {} }));
expect(unmeasured.page.status === 'PASS', 'an unmeasured composite must not invent a failure');
expect(ledgerSnapshot(unmeasured).page.id === PAGE_SCOPE_ID, 'the snapshot must carry the page entry');

// A component owning several parity targets appears once per parity artefact, and even if a
// duplicate leaks through it must cost one attempt per round, not one per target.
const duplicated = parityFor({
  components: [
    { component_id: 'hero', status: 'FAIL', min_ratio: 0.8, owning_layer_hint: 'spacing' },
    { component_id: 'hero', status: 'FAIL', min_ratio: 0.8, owning_layer_hint: 'spacing' },
    { component_id: 'cards', status: 'FAIL', min_ratio: 0.7, owning_layer_hint: 'spacing' },
  ],
  composite: { '1440-disabled': { status: 'PASS', ratio: 0.99 } },
});
const dupLedger = createLedger(['hero', 'cards']);
applyParity(dupLedger, duplicated);
const dupRouted = routeFailures(duplicated, plan, dupLedger);
expect(dupRouted.batches[0].components.join(',') === 'hero,cards',
  `a duplicated component must be routed once, got ${dupRouted.batches[0].components}`);

// The cap is enforced at the ledger, so no caller can overspend a budget.
const capped = createLedger(['hero', 'cards']);
for (let attempt = 0; attempt < capped.caps[1] + 3; attempt += 1) {
  recordAttempt(capped, { componentId: 'hero', batchId: 'b', layer: 'spacing' });
}
expect(capped.components.get('hero').attempts === capped.caps[1],
  `attempts must stop at the cap, got ${capped.components.get('hero').attempts}`);

// The ledger's budget must match the orchestrator's bound, or the loop stops while entries are
// still merely FAILING and a terminal read would call that a pass.
const budgeted = createLedger(['hero'], { retries: 4 });
expect(budgeted.caps[1] + budgeted.caps[2] === 4,
  `a retry budget must be spent in full, got ${budgeted.caps[1]}+${budgeted.caps[2]}`);
expect(createLedger(['hero'], { retries: 1 }).caps[2] === 0,
  'a single-retry budget leaves nothing for a second round');
expect(createLedger(['hero']).retries === DEFAULT_RETRIES,
  `the default budget must be ${DEFAULT_RETRIES}`);

const stopped = createLedger(['hero', 'cards']);
applyParity(stopped, parity);
expect(terminalStatus(stopped).status === 'PASS',
  'a ledger still working must not yet read as failed');
finalizeLedger(stopped);
expect(terminalStatus(stopped).status === 'FAIL',
  'anything unresolved when the loop stops must be final, not left as FAILING');
expect(stopped.page.status === 'FAILED-FINAL',
  `an unresolved page must be finalised, got ${stopped.page.status}`);
expect([...stopped.components.values()].every((entry) => entry.status === 'PASS'),
  'finalising must not clobber a component that already passed');

// A capture that never reached the page is an environment fault, not a code defect.
expect(environmentBlocked({ preflight: { environment_blocked: false, checks: [] } }) === null,
  'a healthy preflight must not report an environment block');
expect(environmentBlocked({}) === null, 'a parity artefact without preflight must not block');
const blockedReason = environmentBlocked({
  preflight: {
    environment_blocked: true,
    checks: [
      { target_redirected_to: 'http://localhost:4506/libs/granite/core/content/login.html' },
      { target_redirected_to: 'http://localhost:4506/libs/granite/core/content/login.html' },
    ],
  },
});
expect(typeof blockedReason === 'string' && blockedReason.includes('login.html'),
  `an environment block must name where the capture landed, got ${blockedReason}`);
expect((blockedReason.match(/login\.html/g) || []).length === 1,
  'the reason must list each destination once');

if (failures.length) {
  console.error(`remediation assertions failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('remediation routing assertions passed');
