#!/usr/bin/env node
/**
 * Preflight proof for the frozen parity runner: scores a fixture pair with known
 * seeded defects and asserts the gate that owns each defect fires, that advisory
 * gates never decide a verdict, that only a size difference beyond the
 * tolerance withholds a score, and that a target with no box is withheld
 * instead of aborting the run.
 *
 *   node design/site-url/tools/test/run-fixture-check.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PNG } from 'pngjs';

import { analysePng, environmentProblems, textSimilarity } from '../parity.mjs';
import { DEFAULT_BREAKPOINTS, DIMENSION_TOLERANCE, GEOMETRY_TOLERANCE } from '../lib/contracts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.dirname(here);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-fixture-'));
const DESKTOP = Math.max(...DEFAULT_BREAKPOINTS);

const config = {
  run_id: 'fixture-check',
  source_url: pathToFileURL(path.join(here, 'fixture-live.html')).href,
  targets: [{ mode: 'fixture', url: pathToFileURL(path.join(here, 'fixture-aem.html')).href }],
  breakpoints: [...DEFAULT_BREAKPOINTS],
  threshold: 0.9,
  dpr: 1,
  components: [
    { id: 'site-header', source: { css: '#site-header' }, target: { css: '#site-header' } },
    // Same component, a second target pinned to one breakpoint: it must score there and nowhere else.
    { id: 'site-header', source: { css: '#site-header', bp: DESKTOP }, target: { css: '#site-header' } },
    { id: 'hero', source: { css: '#hero' }, target: { css: '#hero' } },
    { id: 'cta', source: { css: '#cta' }, target: { css: '#cta' } },
    { id: 'cards', source: { css: '#cards' }, target: { css: '#cards' } },
    { id: 'media', source: { css: '#media' }, target: { css: '#media' } },
    { id: 'frame', source: { css: '#frame' }, target: { css: '#frame' } },
    { id: 'menu', source: { css: '#menu' }, target: { css: '#menu' }, signature_text: 'Contact Search India' },
    { id: 'tagline', source: { css: '#tagline' }, target: { css: '#tagline' }, signature_text: 'Hello world' },
    { id: 'banner', source: { css: '#banner' }, target: { css: '#banner' } },
    // Readiness problems inside one element; none of them may withhold any other row.
    { id: 'gallery', source: { css: '#gallery' }, target: { css: '#gallery' } },
    { id: 'promo', source: { css: '#promo' }, target: { css: '#promo' } },
    { id: 'ticker', source: { css: '#ticker' }, target: { css: '#ticker' } },
    { id: 'missing', source: { css: '#missing' }, target: { css: '#missing' } },
  ],
};
const configPath = path.join(outDir, 'parity-config.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

const run = spawnSync(process.execPath, [path.join(toolRoot, 'parity.mjs'), '--config', configPath, '--out', outDir], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.stdout.write(run.stdout || '');
if (run.stderr) process.stderr.write(run.stderr);

const artifact = JSON.parse(fs.readFileSync(path.join(outDir, 'parity.json'), 'utf8'));
const byId = Object.fromEntries(artifact.components.map((entry) => [entry.component_id, entry]));
const rowsFor = (id) => artifact.results.filter((row) => row.component_id === id);
const rowFor = (id, breakpoint = DESKTOP) => rowsFor(id).find((row) => row.breakpoint === breakpoint);
// The fixture has no media queries; at narrow widths a seeded defect covers more of its crop.
const ratioDecides = (id) => rowsFor(id).every((row) => (row.status === 'PASS') === (row.visual_match_ratio > config.threshold));

const failures = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}

// Identical component must score exactly and clear every gate.
const header = rowFor('site-header');
expect(byId['site-header'].status === 'PASS', `site-header should PASS, got ${byId['site-header'].status}`);
expect(header.exact_match === true, 'site-header should be an exact pixel match');
expect(byId['site-header'].failed_gates.length === 0, `site-header should clear all gates, got ${byId['site-header'].failed_gates}`);

// Larger heading changes typography and height, but stays inside the size tolerance, so it is
// scored over the union rather than withheld — and still fails where the union ratio is too low.
const hero = rowFor('hero');
expect(byId.hero.status === 'FAIL', `hero should FAIL, got ${byId.hero.status}`);
expect(Boolean(hero.deltas.dimension_mismatch), 'hero should report a dimension mismatch');
expect(hero.scored_over === 'union-within-tolerance',
  `a tolerated size difference must be scored over the union, got ${hero.scored_over}`);
expect(typeof hero.visual_match_ratio === 'number', 'hero should carry an authoritative ratio');
expect(hero.gates.typography === 'FAIL', 'hero should fail the typography gate');
expect(
  hero.deltas.inventory.typography.some((delta) => delta.property === 'fontSize'),
  'hero typography delta should name fontSize',
);

// Recoloured CTA keeps its geometry. The colour gate must catch it at every width and never decide
// the verdict: gates are advisory, so wherever the pixel ratio is above the threshold the row passes.
const cta = rowFor('cta');
expect(cta.status === 'PASS', `cta should PASS on pixels alone at ${DESKTOP}px, got ${cta.status}`);
expect(ratioDecides('cta'), `only the pixel ratio may decide cta, got ${rowsFor('cta').map((row) => `${row.breakpoint} ${row.status}`).join(', ')}`);
expect(cta.visual_match_ratio !== null && cta.visual_match_ratio < 1, 'cta should score below 1');
expect(rowsFor('cta').every((row) => row.gates?.color === 'FAIL'), 'cta should fail the colour gate at every breakpoint');
expect(byId.cta.failed_gates.includes('color'), 'cta should still report the colour gate as advisory');
expect(
  cta.deltas.inventory.color.some((delta) => delta.property === 'backgroundColor'),
  'cta colour delta should name backgroundColor',
);
expect(
  (cta.deltas.hot_regions || []).some((region) => region.elements.some((element) => element.startsWith('a'))),
  'cta hot regions should point at the anchor',
);

// Card padding changes inner spacing only, so the same advisory rule applies.
const cards = rowFor('cards');
expect(cards.status === 'PASS', `cards should PASS on pixels alone at ${DESKTOP}px, got ${cards.status}`);
expect(ratioDecides('cards'), `only the pixel ratio may decide cards, got ${rowsFor('cards').map((row) => `${row.breakpoint} ${row.status}`).join(', ')}`);
expect(rowsFor('cards').every((row) => row.gates?.spacing === 'FAIL'), 'cards should fail the spacing gate at every breakpoint');
expect(
  cards.deltas.inventory.spacing.some((delta) => String(delta.property).startsWith('padding')),
  'cards spacing delta should name a padding property',
);

// A video that matches pixel-for-pixel but not in behaviour must still fail: playback is not
// positionally paired, so it is one of the two gates that still blocks.
const media = rowFor('media');
expect(byId.media.status === 'FAIL', `media should FAIL on behaviour alone, got ${byId.media.status}`);
expect(media.gates.playback === 'FAIL', 'media should fail the playback gate');
expect(byId.media.owning_layer_hint === 'media-playback',
  `playback failures should route to media-playback, got ${byId.media.owning_layer_hint}`);
for (const property of ['autoplay', 'loop', 'muted', 'controls', 'playsinline']) {
  expect(media.deltas.playback.some((delta) => delta.property === property),
    `playback delta should report ${property}`);
}

// Playwright never sees an element without a box as visible, so its crop would wait out the timeout.
const frameRows = artifact.results.filter((row) => row.component_id === 'frame');
expect(frameRows.length === config.breakpoints.length && frameRows.every((row) => row.status === 'WITHHELD'
  && String(row.withheld_reason).startsWith('target element renders no box')),
`a collapsed target must be withheld at every breakpoint, got ${frameRows.map((row) => `${row.status}: ${row.withheld_reason}`).join('; ')}`);
expect(byId.frame?.owning_layer_hint === 'geometry-container',
  `a collapsed target should route to geometry-container, got ${byId.frame?.owning_layer_hint}`);

// Whitespace between tags is markup, not text: live markup without it still reads as separate words.
const menuRows = artifact.results.filter((row) => row.component_id === 'menu');
expect(menuRows.length === config.breakpoints.length
  && menuRows.every((row) => row.status === 'PASS' && row.deltas.signature?.matches_target === true),
`a signature split only by tags must match and be scored, got ${menuRows.map((row) => `${row.status}: ${row.withheld_reason}`).join('; ')}`);
expect(menuRows.every((row) => row.deltas.text?.similarity === 1),
  `whitespace between tags must not lower text similarity, got ${menuRows.map((row) => row.deltas.text?.similarity).join(', ')}`);

// Words that really run together inside the text are a difference, and the signature must say so.
const taglineRows = artifact.results.filter((row) => row.component_id === 'tagline');
expect(taglineRows.length === config.breakpoints.length && taglineRows.every((row) => row.status === 'WITHHELD'
  && row.deltas.signature?.matches_source === true && row.deltas.signature?.matches_target === false),
`run-together words must fail the signature, got ${taglineRows.map((row) => `${row.status} ${JSON.stringify(row.deltas.signature)}`).join('; ')}`);

expect(artifact.status === 'FAIL', 'overall fixture status should be FAIL');

// One component, several parity targets: it must be summarised once or remediation spends its
// attempt budget once per target instead of once per component.
const summarisedIds = artifact.components.map((entry) => entry.component_id);
expect(summarisedIds.length === new Set(summarisedIds).size,
  `each component must be summarised once, got ${summarisedIds.join(',')}`);
expect(summarisedIds.length === 13, `expected 13 components, got ${summarisedIds.length}`);

// A target pinned to a breakpoint is scored there and skipped everywhere else.
const headerRows = artifact.results.filter((row) => row.component_id === 'site-header');
expect(headerRows.filter((row) => row.breakpoint === DESKTOP).length === 2,
  `site-header should score twice at its pinned breakpoint, got ${headerRows.filter((row) => row.breakpoint === DESKTOP).length}`);
for (const breakpoint of config.breakpoints.filter((width) => width !== DESKTOP)) {
  expect(headerRows.filter((row) => row.breakpoint === breakpoint).length === 1,
    `site-header should score once at ${breakpoint}, where the pin does not apply, `
    + `got ${headerRows.filter((row) => row.breakpoint === breakpoint).length}`);
}

// Two rows of one component at one breakpoint must not overwrite each other's evidence.
const evidenceFiles = artifact.results.flatMap((row) => [row.side_by_side, row.diff_mask, row.source?.screenshot])
  .filter(Boolean);
const shared = evidenceFiles.filter((file, index) => evidenceFiles.indexOf(file) !== index);
expect(!shared.length, `every scored row needs its own evidence files, shared: ${[...new Set(shared)].join(', ')}`);

// Every breakpoint gets its own scored page and its own whole-page pair for remediation to read.
for (const breakpoint of config.breakpoints) {
  const composite = artifact.page_composite[`${breakpoint}-fixture`];
  expect(Boolean(composite), `page composite missing for ${breakpoint}`);
  expect(typeof composite?.side_by_side === 'string' && fs.existsSync(path.join(outDir, composite.side_by_side)),
    `a whole-page side-by-side must exist for ${breakpoint}, got ${composite?.side_by_side}`);
  expect(artifact.results.some((row) => row.breakpoint === breakpoint),
    `no component was scored at ${breakpoint}`);

  // Space between components falls outside every component crop, so only the page can gate it.
  const gaps = composite?.inter_component_gaps;
  expect(Array.isArray(gaps) && gaps.length > 0, `inter-component gaps must be measured at ${breakpoint}`);
  expect(gaps.every((gap) => typeof gap.source_gap === 'number' && typeof gap.target_gap === 'number'),
    `every gap at ${breakpoint} must carry both measurements`);
  expect(gaps.every((gap) => gap.status === (Math.abs(gap.delta) <= composite.gap_tolerance_px ? 'PASS' : 'FAIL')),
    `gap status at ${breakpoint} must follow the tolerance it reports`);
  expect(!gaps.some((gap) => gap.status === 'FAIL') || composite.status === 'FAIL',
    `a failing gap at ${breakpoint} must fail the page composite`);
}

// A score withheld beyond the size tolerance may never be substituted by a diagnostic:
// progress moves remediation, not the gate. Whether a crop is withheld follows its measured size.
const beyondTolerance = ({ source, target }) => Math.abs(target.w - source.w) > Math.max(GEOMETRY_TOLERANCE.width, source.w * DIMENSION_TOLERANCE)
  || Math.abs(target.h - source.h) > Math.max(GEOMETRY_TOLERANCE.height, source.h * DIMENSION_TOLERANCE);
const withheld = artifact.results.filter((row) => row.visual_status === 'WITHHELD' && row.deltas.dimension_mismatch);
expect(rowsFor('banner').length === config.breakpoints.length && rowsFor('banner').every((row) => withheld.includes(row)),
  'the out-of-tolerance banner must be withheld at every breakpoint');
expect(withheld.every((row) => beyondTolerance(row.deltas.dimension_mismatch)),
  `only a crop beyond the size tolerance may be withheld, got ${withheld.map((row) => `${row.component_id}@${row.breakpoint}`).join(',')}`);
expect(artifact.results.filter((row) => row.scored_over === 'union-within-tolerance')
  .every((row) => !beyondTolerance(row.deltas.dimension_mismatch)),
'a crop scored over the union must be within the size tolerance');
expect(withheld.every((row) => row.visual_match_ratio === null && row.status === 'FAIL'),
  'an unequal crop must never carry an authoritative ratio, and must fail');
expect(withheld.every((row) => typeof row.progress_ratio === 'number'),
  'a withheld row must still report progress for remediation to steer by');
expect(artifact.components.every((entry) => entry.status !== 'PASS' || entry.min_ratio !== null),
  'no component may pass without an authoritative score');

// A local fixture is reached directly, so nothing may be reported as an environment block.
expect(artifact.preflight.environment_blocked === false,
  'a reachable target must not be flagged as redirected');

// A readiness problem belongs to the element it occurs in. The rows above prove every other
// component was still scored; these prove each problem is named and routed on its own.
const expectWithheldAlone = (id, layer, pattern, why) => {
  const rows = artifact.results.filter((row) => row.component_id === id);
  expect(rows.length === config.breakpoints.length && rows.every((row) => row.status === 'WITHHELD'
    && row.owning_layer_hint === layer && pattern.test(row.withheld_reason || '')),
  `${why}, got ${rows.map((row) => `${row.status} ${row.owning_layer_hint}: ${row.withheld_reason}`).join('; ')}`);
};
expectWithheldAlone('missing', 'plan-or-selector', /^target selector matched 0 /,
  'a component missing on the target must be withheld as a selector problem');
expectWithheldAlone('gallery', 'media-assets', /^target media never loaded: image .*missing-aem-image\.png/,
  'an image that never loads on the target must be blamed on that component\'s media');
expectWithheldAlone('ticker', 'capture-readiness', /^target element kept moving/,
  'an element that never holds still must be withheld as itself');
expectWithheldAlone('promo', 'source-capture', /^source media never loaded: image .*missing-live-image\.png/,
  'a broken image on the live page must be blamed on the source, which no edit can fix');
expect(byId.promo?.owning_layer_hint === 'source-capture',
  `a component only the source fails must say so, got ${byId.promo?.owning_layer_hint}`);
expect(artifact.preflight.status === 'PASS',
  `element-level problems must not fail the capture as a whole, got ${artifact.preflight.status}`);

// Only what no edit can fix stops the run: an unreachable page or a live page that will not render.
const capture = (status, readiness = {}) => ({
  navigation: { http_status: status },
  readiness: { inner_width: DESKTOP, fonts_ready: true, ...readiness },
});
const environment = (source, deployed, redirectedTo = null) => environmentProblems({
  width: DESKTOP, source, deployed, requestedUrl: 'http://localhost:4502/content/page.html', redirectedTo,
});
expect(environment(capture(200), capture(200)).length === 0, 'a healthy capture must not be blocked');
expect(environment(capture(null), capture(null)).length === 0, 'a file:// capture has no HTTP status and must not be blocked');
expect(environment(capture(200), capture(404)).some((problem) => problem.includes('target page answered HTTP 404')),
  'a target page that answers 404 must block the run');
expect(environment(capture(500), capture(200)).some((problem) => problem.includes('live page answered HTTP 500')),
  'a live page that answers 500 must block the run');
expect(environment(capture(200), capture(200), 'http://localhost:4502/libs/granite/core/content/login.html')
  .some((problem) => problem.includes('login.html')), 'a redirect away from the target must block the run');
expect(environment(capture(200, { fonts_ready: false }), capture(200)).some((problem) => problem.includes('fonts')),
  'live fonts that never load must block the run, since no edit can fix them');
expect(environment(capture(200), capture(200, { fonts_ready: false })).length === 0,
  'target fonts that never load are the project\'s to fix, not an environment fault');

// A photographic full page samples far more distinct colours than one call can take as arguments.
const photo = new PNG({ width: 1500, height: 1400 });
for (let pixel = 0; pixel < photo.width * photo.height; pixel += 1) {
  photo.data.writeUIntBE(pixel, pixel * 4, 3);
  photo.data[pixel * 4 + 3] = 255;
}
let photoAnalysis;
try {
  photoAnalysis = analysePng(PNG.sync.write(photo));
} catch (error) {
  photoAnalysis = { error: error.message };
}
expect(photoAnalysis.distinct_colors === 300000,
  `a page with 300000 distinct sampled colours must be analysed, got ${JSON.stringify(photoAnalysis)}`);

// Case, punctuation and runs of whitespace never count; a missing space between words does.
expect(textSimilarity('Contact  Search\nIndia', 'contact search india') === 1,
  `case and whitespace runs must not lower text similarity, got ${textSimilarity('Contact  Search\nIndia', 'contact search india')}`);
expect(textSimilarity('Contact Search India', 'ContactSearchIndia') < 1,
  `words run together must lower text similarity, got ${textSimilarity('Contact Search India', 'ContactSearchIndia')}`);
expect(textSimilarity('Contact Search India', 'Careers About us') < 0.5,
  `different words must still read as different text, got ${textSimilarity('Contact Search India', 'Careers About us')}`);

console.log('\nFixture assertions');
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed. Evidence: ${outDir}`);
  process.exitCode = 1;
} else {
  console.log('  all assertions passed');
  console.log(`\nEvidence: ${outDir}`);
  process.exitCode = 0;
}
