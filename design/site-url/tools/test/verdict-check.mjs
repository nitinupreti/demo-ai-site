#!/usr/bin/env node
/**
 * Checks the plain-language parity verdict against artefacts shaped like parity.json: every failing
 * component is named with its device and width, a scored row carries its match, a row without a
 * score never shows a percentage, and a page-only or environment failure is called what it is.
 *
 *   node design/site-url/tools/test/verdict-check.mjs
 */
import process from 'node:process';

import { breakpointLabel, deviceName, explainParity, similarityOf } from '../lib/verdict.mjs';
import { buildReport } from '../../orchestrator/report.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const lineWith = (verdict, ...parts) => verdict.lines.find((line) => parts.every((part) => line.includes(part)));

for (const [width, device] of [[320, 'mobile'], [375, 'mobile'], [767, 'mobile'], [768, 'tablet'], [1023, 'tablet'],
  [1024, 'desktop'], [1440, 'desktop']]) {
  expect(deviceName(width) === device, `${width}px should be ${device}, got ${deviceName(width)}`);
}
expect(breakpointLabel('375-disabled') === 'mobile 375px', `a parity key should label as its width, got ${breakpointLabel('375-disabled')}`);

const scored = (componentId, breakpoint, ratio, extra = {}) => ({
  component_id: componentId,
  breakpoint,
  mode: 'disabled',
  status: 'PASS',
  visual_match_ratio: ratio,
  visual_status: ratio > 0.85 ? 'PASS' : 'FAIL',
  geometry_status: 'PASS',
  source: { selector: `.${componentId}`, rect: { x: 0, y: 0, w: breakpoint, h: 820 } },
  target: { selector: `.cmp-${componentId}`, rect: { x: 0, y: 0, w: breakpoint, h: 820 } },
  gates: { rendered_fonts: 'PASS', playback: 'PASS' },
  deltas: { rect: { x: 0, y: 0, w: 0, h: 0 }, rendered_fonts: [], playback: [] },
  ...extra,
});
const withheld = (componentId, breakpoint, reason, extra = {}) => ({
  component_id: componentId,
  breakpoint,
  mode: 'disabled',
  status: 'WITHHELD',
  withheld_reason: reason,
  visual_match_ratio: null,
  source: { selector: `.${componentId}` },
  target: { selector: `.cmp-${componentId}` },
  deltas: {},
  ...extra,
});
const summarise = (results) => [...new Set(results.map((row) => row.component_id))].map((id) => {
  const rows = results.filter((row) => row.component_id === id);
  const failing = rows.filter((row) => row.status !== 'PASS');
  const lowest = (values) => (values.length ? Math.min(...values) : null);
  return {
    component_id: id,
    status: !failing.length ? 'PASS' : failing.every((row) => row.status === 'WITHHELD') ? 'WITHHELD' : 'FAIL',
    min_ratio: lowest(rows.map((row) => row.visual_match_ratio).filter((value) => typeof value === 'number')),
    min_progress_ratio: lowest(rows.map(similarityOf).filter((value) => value !== null)),
    failed_breakpoints: [...new Set(failing.map((row) => row.breakpoint))],
    breakpoint_scope: failing.length ? 'partial' : 'none',
    breakpoints: Object.fromEntries(rows.map((row) => [`${row.breakpoint}-${row.mode}`,
      { status: row.status, ratio: row.visual_match_ratio, similarity: similarityOf(row) }])),
  };
});
const artefact = (results, pageComposite, extra = {}) => ({
  threshold: 0.85,
  breakpoints: [375, 768, 1440],
  results,
  components: summarise(results),
  page_composite: pageComposite,
  preflight: { status: 'PASS', environment_blocked: false, checks: [] },
  status: 'FAIL',
  ...extra,
});
const composite = (ratio, status, extra = {}) => ({
  ratio, status, width_delta: 0, height_delta: 0, height_allowance_px: 186.3, inter_component_gaps: [], gap_tolerance_px: 1, ...extra,
});

// One artefact with every way a row can fail, next to a component that passes everywhere.
const mixed = explainParity(artefact([
  scored('site-header', 375, 0.99), scored('site-header', 768, 0.99), scored('site-header', 1440, 0.99),
  scored('hero', 375, 0.724, { status: 'FAIL' }),
  scored('hero', 768, 0.913, {
    status: 'FAIL',
    geometry_status: 'FAIL',
    deltas: { rect: { x: 0, y: 0, w: 0, h: 120 }, rendered_fonts: [], playback: [] },
  }),
  scored('hero', 1440, 0.932),
  withheld('video', 1440, 'target element renders no box (0x0)', { owning_layer_hint: 'geometry-container' }),
  {
    ...withheld('banner', 375, 'crop dimensions differ: source 375x820, target 375x1020'),
    status: 'FAIL',
    visual_status: 'WITHHELD',
    progress_ratio: 0.6,
    deltas: { dimension_mismatch: { source: { w: 375, h: 820 }, target: { w: 375, h: 1020 } } },
  },
  // Similar enough to clear the bar, yet far too wide: it must still read as a failure.
  {
    ...withheld('promo', 768, 'crop dimensions differ: source 300x120, target 340x120'),
    status: 'FAIL',
    visual_status: 'WITHHELD',
    progress_ratio: 0.93,
    deltas: { dimension_mismatch: { source: { w: 300, h: 120 }, target: { w: 340, h: 120 } } },
  },
  scored('near', 375, 0.84996, { status: 'FAIL' }),
  scored('fonts', 1440, 0.97, {
    status: 'FAIL',
    gates: { rendered_fonts: 'FAIL', playback: 'PASS' },
    deltas: { rect: { x: 0, y: 0, w: 0, h: 0 }, rendered_fonts: [{ source: ['DM Sans'], target: ['Arial'] }], playback: [] },
  }),
  withheld('missing', 768, 'target selector matched 0 elements', { owning_layer_hint: 'plan-or-selector' }),
], {
  '375-disabled': composite(0.931, 'FAIL', { height_delta: -820 }),
  '768-disabled': composite(0.95, 'PASS'),
  '1440-disabled': composite(0.96, 'PASS'),
}));

expect(mixed.status === 'FAIL', `the mixed artefact should fail, got ${mixed.status}`);
expect(mixed.headline.startsWith('Visual parity FAILED: 5 of 8 components do not match the live site '
  + '(pass: visual similarity above 85% at every breakpoint)'),
`the headline should count the components that do not match, got: ${mixed.headline}`);
expect(mixed.headline.includes('2 could not be scored (video, missing)'),
  `a component with no score must not be counted as a mismatch, got: ${mixed.headline}`);
expect(mixed.headline.includes('the page as a whole also differs from the live site at mobile 375px'),
  `the headline should say where the page fails, got: ${mixed.headline}`);
expect(Boolean(lineWith(mixed, 'mobile 375px', 'visual similarity 72.40%, needs more than 85%')),
  'a low score must state its visual similarity and the bar it missed');
expect(Boolean(lineWith(mixed, 'tablet 768px', 'visual similarity 91.30%, but its box is 120px taller than on the live site (tolerance 41px)')),
  'a passing score that fails on its box must say so instead of implying the score failed');
expect(Boolean(lineWith(mixed, 'desktop 1440px', 'passes, visual similarity 93.20%')),
  'a failing component must still show where it passes');
expect(Boolean(lineWith(mixed, 'desktop 1440px', 'not scored: AEM element renders no box (0x0)')),
  'a withheld row must give the reason in live-site/AEM terms');
expect(Boolean(lineWith(mixed, 'mobile 375px', 'visual similarity 60.00%, needs more than 85%; '
  + 'its box is 200px taller than on the live site (tolerance 41px)')),
'a size mismatch must show the same visual similarity as every other breakpoint, and the size that fails it');
expect(Boolean(lineWith(mixed, 'tablet 768px', 'visual similarity 93.00%, but its box is 40px wider than on the live site (tolerance 15px)')),
  'a size mismatch above the bar must still read as a failure');
expect(Boolean(lineWith(mixed, 'visual similarity 84.996%')) && !lineWith(mixed, 'visual similarity 85.00%'),
  'rounding must never print a failing score at the bar');
expect(Boolean(lineWith(mixed, 'visual similarity 97.00%, but its fonts differ (live site: DM Sans; AEM: Arial)')),
  'a font failure must name both sides');
expect(Boolean(lineWith(mixed, 'tablet 768px', 'missing on the AEM page (`.cmp-missing` matched nothing)')),
  'a missing target must be named as missing');
expect(Boolean(lineWith(mixed, 'mobile 375px', 'the AEM page is 820px shorter than the live page (tolerance 186.3px)')),
  'the page section must give the height difference and its tolerance');
expect(Boolean(lineWith(mixed, 'tablet 768px', 'passes, visual similarity 95.00% where both pages overlap')),
  'the page section must show the passing widths too');
expect(!mixed.lines.includes('site-header'), 'a component that passes everywhere must not be listed');
expect(mixed.lines.at(-1) === 'visual similarity = share of pixels that match the live site; area only one side has counts as not matching',
  'the details must say what visual similarity means');
expect(mixed.lowest?.component_id === 'banner' && mixed.lowest?.ratio === 0.6,
  `the lowest visual similarity must include crops that fail on their size, got ${JSON.stringify(mixed.lowest)}`);

// Every component passes and only the page fails: the message must say exactly that.
const pageOnly = explainParity(artefact(
  [scored('hero', 1440, 0.97), scored('cards', 1440, 0.95)],
  { '1440-disabled': composite(0.97, 'FAIL', { width_delta: -1 }) },
  { breakpoints: [1440] },
));
expect(pageOnly.headline === 'Visual parity FAILED: every scored component passes, but the page as a whole differs from the live site at desktop 1440px',
  `a page-only failure must be named as one, got: ${pageOnly.headline}`);
expect(Boolean(lineWith(pageOnly, 'the AEM page is 1px narrower than the live page (widths must be equal); visual similarity 97.00%')),
  `the page line must give the width difference, got: ${pageOnly.lines.join(' | ')}`);

// The AEM page was never reached: nothing may be blamed on a component.
const environment = 'the target page answered HTTP 404';
const blocked = explainParity(artefact(
  [375, 768, 1440].map((width) => withheld('hero', width, `environment: ${environment}`, { owning_layer_hint: 'environment' })),
  { '375-disabled': composite(0.2, 'FAIL', { height_delta: -3000 }) },
  {
    preflight: {
      status: 'FAIL',
      environment_blocked: true,
      checks: [375, 768, 1440].map((width) => ({ breakpoint: width, mode: 'disabled', environment_failures: [environment] })),
    },
  },
));
expect(blocked.headline === 'Visual parity FAILED: AEM could not be compared with the live site at mobile 375px, tablet 768px '
  + 'and desktop 1440px (the AEM page answered HTTP 404); no component change can fix that',
`an environment failure must be named as one, got: ${blocked.headline}`);
expect(!blocked.lines.includes('hero') && !blocked.lines.includes('page as a whole'),
  `no component or page result may be reported from a page that was never reached, got: ${blocked.lines.join(' | ')}`);

// Target fonts that never load withhold every row at that width; that is one problem, not one per component.
const fonts = explainParity(artefact(
  [withheld('hero', 375, 'target fonts never finished loading (document.fonts.ready did not resolve)', { owning_layer_hint: 'font-delivery' }),
    scored('hero', 1440, 0.97)],
  { '375-disabled': composite(0.97, 'PASS'), '1440-disabled': composite(0.97, 'PASS') },
));
expect(fonts.headline === 'Visual parity FAILED: AEM web fonts never finished loading at mobile 375px, so no component was scored there',
  `unloaded fonts must be reported once for the width, got: ${fonts.headline}`);

// A pass names its lowest score and where it is.
const passed = explainParity(artefact(
  [scored('hero', 375, 0.912), scored('hero', 1440, 0.97), scored('cards', 768, 0.95)],
  { '375-disabled': composite(0.97, 'PASS') },
  { status: 'PASS' },
));
expect(passed.headline === 'Visual parity PASSED: all 2 components match the live site with visual similarity above 85% '
  + '(checked at mobile 375px, tablet 768px and desktop 1440px); lowest visual similarity 91.20% (hero at mobile 375px)',
`a pass must name its lowest score and where, got: ${passed.headline}`);
expect(!passed.lines.length, 'a pass needs no details');

// The report must call a page-only failure a failure, and never print an unscored component as 0%.
const zeroPercent = /(^|[^\d])0\.00%/;
const reportFor = (parity, ledgerStatus, pageStatus) => buildReport({
  state: { run_id: 'verdict-check', inputs: { BREAKPOINTS: [1440] }, duration_seconds: 1 },
  plan: {
    components: Object.keys(ledgerStatus).map((id, index) => ({ id, tier: 4, role: 'content', instances: [`inst-${index + 1}`] })),
  },
  parity,
  ledger: {
    components: Object.entries(ledgerStatus).map(([id, status]) => ({ id, status, history: [] })),
    page: { id: '__page__', status: pageStatus, history: [] },
  },
  phases: [],
});

const pageReport = reportFor(artefact(
  [scored('hero', 1440, 0.97), scored('cards', 1440, 0.95)],
  { '1440-disabled': composite(0.97, 'FAIL', { width_delta: -1 }) },
  { breakpoints: [1440] },
), { hero: 'PASS', cards: 'PASS' }, 'FAILED-FINAL');
expect(pageReport.markdown.includes('VISUAL PARITY GATE: FAILED after bounded remediation — every scored component passes, '
  + 'but the page as a whole differs from the live site at desktop 1440px'),
'a run whose page fails must report a failed gate and say it is the page');
expect(!pageReport.markdown.includes('BLOCKED'), 'a parity run that was measured must never be reported as not produced');
expect(pageReport.markdown.includes('## Visual parity verdict'), 'the report must carry the plain-language verdict');
expect(pageReport.markdown.includes('Lowest visual similarity: **95.00%** (cards at desktop 1440px)'),
  'the report must name the lowest visual similarity and where it is');

const unscoredReport = reportFor(artefact(
  [
    scored('hero', 1440, 0.8, { status: 'FAIL' }),
    withheld('cards', 1440, 'target selector matched 0 elements'),
    {
      ...withheld('banner', 1440, 'crop dimensions differ: source 300x120, target 200x120'),
      status: 'FAIL',
      visual_status: 'WITHHELD',
      progress_ratio: 0.7,
      deltas: { dimension_mismatch: { source: { w: 300, h: 120 }, target: { w: 200, h: 120 } } },
    },
  ],
  { '1440-disabled': composite(0.97, 'PASS') },
  { breakpoints: [1440] },
), { hero: 'FAILED-FINAL', cards: 'FAILED-FINAL', banner: 'FAILED-FINAL' }, 'PASS');
expect(unscoredReport.markdown.includes('3 component(s) unresolved: hero (desktop 1440px), cards (desktop 1440px), banner (desktop 1440px)'),
  'the status line must name every unresolved component with its device and width');
expect(unscoredReport.markdown.includes('Not scored at any breakpoint: cards\n') && !zeroPercent.test(unscoredReport.markdown),
  'only a component with nothing measured is unscored, and never shown as 0%');
expect(unscoredReport.markdown.includes('| banner | **70.00%** | 70.00% |')
  && unscoredReport.markdown.includes('Lowest visual similarity: **70.00%** (banner at desktop 1440px)'),
'a crop that fails on its size must show the same visual similarity as any other breakpoint');
expect(unscoredReport.summary.min_ratio === 0.8,
  `the summary minimum must stay the lowest pass score, got ${unscoredReport.summary.min_ratio}`);
expect(!mixed.lines.some((line) => zeroPercent.test(line)), 'no verdict line may invent a 0% score');

// A damaged or partial artefact must still produce a readable message, never NaN or a crash.
expect(!breakpointLabel(undefined).includes('NaN'), `a missing width must not print NaN, got ${breakpointLabel(undefined)}`);
let damaged;
try {
  damaged = explainParity({
    threshold: 0.85,
    status: 'FAIL',
    results: [
      scored('hero', 375, Number.NaN, { status: 'FAIL', withheld_reason: 'target crop could not be captured: timeout' }),
      { ...withheld('banner', 768, 'crop dimensions differ'), status: 'FAIL', visual_status: 'WITHHELD', progress_ratio: 0.5, deltas: { dimension_mismatch: {} } },
      null,
    ],
    components: null,
    page_composite: { '375-disabled': null, '768-disabled': composite(Number.NaN, 'WITHHELD') },
    preflight: { checks: 'not-a-list' },
  });
} catch (error) {
  damaged = { error: error.message };
}
expect(Boolean(damaged?.headline?.startsWith('Visual parity FAILED: ')), `a damaged artefact must still be explained, got ${JSON.stringify(damaged)}`);
expect(Boolean(damaged?.lines) && !damaged.lines.some((line) => line.includes('NaN')),
  `no line may print NaN, got ${damaged?.lines?.join(' | ')}`);
expect(Boolean(damaged?.lines && lineWith(damaged, 'mobile 375px', 'not scored: AEM crop could not be captured: timeout')),
  'a non-finite score must read as not scored with its reason');
expect(Boolean(damaged?.lines && lineWith(damaged, 'tablet 768px', 'visual similarity 50.00%, needs more than 85%; '
  + 'its box size differs from the live site beyond tolerance')),
'a size mismatch without recorded sizes must still name the size as the failure');

if (failures.length) {
  console.log(`verdict-check: ${failures.length} failure(s)`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('verdict-check: all assertions passed');
}
