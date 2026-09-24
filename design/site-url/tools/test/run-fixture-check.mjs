#!/usr/bin/env node
/**
 * Preflight proof for the frozen parity runner: scores a fixture pair with known
 * seeded defects and asserts the gate that owns each defect fires, that advisory
 * gates never decide a verdict, and that only a size difference beyond the
 * tolerance withholds a score.
 *
 *   node design/site-url/tools/test/run-fixture-check.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.dirname(here);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-fixture-'));

const config = {
  run_id: 'fixture-check',
  source_url: pathToFileURL(path.join(here, 'fixture-live.html')).href,
  targets: [{ mode: 'fixture', url: pathToFileURL(path.join(here, 'fixture-aem.html')).href }],
  breakpoints: [1024, 600],
  threshold: 0.9,
  dpr: 1,
  components: [
    { id: 'site-header', source: { css: '#site-header' }, target: { css: '#site-header' } },
    // Same component, a second target pinned to one breakpoint: it must score there and nowhere else.
    { id: 'site-header', source: { css: '#site-header', bp: 1024 }, target: { css: '#site-header' } },
    { id: 'hero', source: { css: '#hero' }, target: { css: '#hero' } },
    { id: 'cta', source: { css: '#cta' }, target: { css: '#cta' } },
    { id: 'cards', source: { css: '#cards' }, target: { css: '#cards' } },
    { id: 'media', source: { css: '#media' }, target: { css: '#media' } },
    { id: 'banner', source: { css: '#banner' }, target: { css: '#banner' } },
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
const rowFor = (id) => artifact.results.find((row) => row.component_id === id);

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

// Recoloured CTA keeps its geometry. The colour gate must catch it, and must not fail it:
// gates are advisory, so a pixel ratio above the threshold still passes.
const cta = rowFor('cta');
expect(byId.cta.status === 'PASS', `cta should PASS on pixels alone, got ${byId.cta.status}`);
expect(cta.visual_match_ratio !== null && cta.visual_match_ratio < 1, 'cta should score below 1');
expect(cta.gates.color === 'FAIL', 'cta should fail the colour gate');
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
expect(byId.cards.status === 'PASS', `cards should PASS on pixels alone, got ${byId.cards.status}`);
expect(cards.gates.spacing === 'FAIL', 'cards should fail the spacing gate');
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

expect(artifact.status === 'FAIL', 'overall fixture status should be FAIL');

// One component, several parity targets: it must be summarised once or remediation spends its
// attempt budget once per target instead of once per component.
const summarisedIds = artifact.components.map((entry) => entry.component_id);
expect(summarisedIds.length === new Set(summarisedIds).size,
  `each component must be summarised once, got ${summarisedIds.join(',')}`);
expect(summarisedIds.length === 6, `expected 6 components, got ${summarisedIds.length}`);

// A target pinned to a breakpoint is scored there and skipped everywhere else.
const headerRows = artifact.results.filter((row) => row.component_id === 'site-header');
expect(headerRows.filter((row) => row.breakpoint === 1024).length === 2,
  `site-header should score twice at its pinned breakpoint, got ${headerRows.filter((row) => row.breakpoint === 1024).length}`);
expect(headerRows.filter((row) => row.breakpoint === 600).length === 1,
  `site-header should score once where the pin does not apply, got ${headerRows.filter((row) => row.breakpoint === 600).length}`);

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
// progress moves remediation, not the gate.
const withheld = artifact.results.filter((row) => row.visual_status === 'WITHHELD' && row.deltas.dimension_mismatch);
expect(withheld.length > 0, 'the fixture should withhold at least one out-of-tolerance score');
expect(withheld.every((row) => row.component_id === 'banner'),
  `only the out-of-tolerance component may be withheld, got ${withheld.map((row) => row.component_id).join(',')}`);
expect(withheld.every((row) => row.visual_match_ratio === null && row.status === 'FAIL'),
  'an unequal crop must never carry an authoritative ratio, and must fail');
expect(withheld.every((row) => typeof row.progress_ratio === 'number'),
  'a withheld row must still report progress for remediation to steer by');
expect(artifact.components.every((entry) => entry.status !== 'PASS' || entry.min_ratio !== null),
  'no component may pass without an authoritative score');

// A local fixture is reached directly, so nothing may be reported as an environment block.
expect(artifact.preflight.environment_blocked === false,
  'a reachable target must not be flagged as redirected');

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
