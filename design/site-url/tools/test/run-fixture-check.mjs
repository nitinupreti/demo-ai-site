#!/usr/bin/env node
/**
 * Preflight proof for the frozen parity runner: scores a fixture pair with known
 * seeded defects and asserts the gate that owns each defect fires.
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
  breakpoints: [1024],
  threshold: 0.9,
  dpr: 1,
  components: [
    { id: 'site-header', source: { css: '#site-header' }, target: { css: '#site-header' } },
    { id: 'hero', source: { css: '#hero' }, target: { css: '#hero' } },
    { id: 'cta', source: { css: '#cta' }, target: { css: '#cta' } },
    { id: 'cards', source: { css: '#cards' }, target: { css: '#cards' } },
    { id: 'media', source: { css: '#media' }, target: { css: '#media' } },
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

// Larger heading changes typography and height, so crops are not comparable.
const hero = rowFor('hero');
expect(byId.hero.status === 'FAIL', `hero should FAIL, got ${byId.hero.status}`);
expect(Boolean(hero.deltas.dimension_mismatch), 'hero should report a dimension mismatch');
expect(typeof hero.deltas.overlap_diagnostic?.ratio === 'number', 'hero should still report an overlap diagnostic');
expect(hero.gates.typography === 'FAIL', 'hero should fail the typography gate');
expect(
  hero.deltas.inventory.typography.some((delta) => delta.property === 'fontSize'),
  'hero typography delta should name fontSize',
);

// Recoloured CTA keeps its geometry, so the colour gate must catch it.
const cta = rowFor('cta');
expect(byId.cta.status === 'FAIL', `cta should FAIL, got ${byId.cta.status}`);
expect(cta.visual_match_ratio !== null && cta.visual_match_ratio < 1, 'cta should score below 1');
expect(cta.gates.color === 'FAIL', 'cta should fail the colour gate');
expect(
  cta.deltas.inventory.color.some((delta) => delta.property === 'backgroundColor'),
  'cta colour delta should name backgroundColor',
);
expect(
  (cta.deltas.hot_regions || []).some((region) => region.elements.some((element) => element.startsWith('a'))),
  'cta hot regions should point at the anchor',
);

// Card padding changes inner spacing only.
const cards = rowFor('cards');
expect(byId.cards.status === 'FAIL', `cards should FAIL, got ${byId.cards.status}`);
expect(cards.gates.spacing === 'FAIL', 'cards should fail the spacing gate');
expect(
  cards.deltas.inventory.spacing.some((delta) => String(delta.property).startsWith('padding')),
  'cards spacing delta should name a padding property',
);

// A video that matches pixel-for-pixel but not in behaviour must still fail.
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
