#!/usr/bin/env node
/**
 * Preflight proof for the frozen discovery scanner: scans every fixture layout at 375, 768 and 1440
 * and asserts which blocks each breakpoint splits the page into, and that every section is one
 * instance found at every width it renders at.
 *
 *   node design/site-url/tools/test/discover-fixture-check.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.dirname(here);
const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-fixture-'));
const fixture = pathToFileURL(path.join(here, 'fixture-discover.html')).href;

// The fixture's media queries are written against these widths, so the expectations are too.
const BREAKPOINTS = [375, 768, 1440];
const HEADER = 'header.site-header';
const FOOTER = 'footer.site-footer';
const everywhere = (blocks) => Object.fromEntries(BREAKPOINTS.map((width) => [width, blocks]));

const CASES = [
  {
    id: 'stacked',
    blocks: everywhere([HEADER, 'div.hero', 'div.image', 'div.feature', FOOTER]),
    instances: 5,
  },
  {
    // The wrapper carries the section while the image fills it, the image once it is capped.
    id: 'capped-image',
    blocks: {
      375: [HEADER, 'div.hero', 'div.image', 'div.feature', FOOTER],
      768: [HEADER, 'div.hero', 'div.image', 'div.feature', FOOTER],
      1440: [HEADER, 'div.hero', 'img.picture', 'div.feature', FOOTER],
    },
    instances: 5,
  },
  {
    id: 'capped-sections',
    blocks: everywhere([HEADER, 'div.hero', 'div.banner', 'div.feature', FOOTER]),
    instances: 5,
  },
  {
    id: 'card-row',
    blocks: everywhere([HEADER, 'div.hero', 'div.promo', 'div.panel', 'div.feature', FOOTER]),
    instances: 6,
  },
  {
    // Instance identity is not asserted: a whole container shares its first child's text key.
    id: 'columns',
    blocks: {
      375: [HEADER, 'div.panel', 'div.section', FOOTER],
      768: [HEADER, 'div.cmp-container.content', FOOTER],
      1440: [HEADER, 'div.cmp-container.content', FOOTER],
    },
  },
  {
    id: 'caption-beside',
    blocks: everywhere([HEADER, 'div.hero', 'img.picture', 'p.caption', 'div.feature', FOOTER]),
    instances: 6,
  },
];

const failures = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}

for (const spec of CASES) {
  const outDir = path.join(outRoot, spec.id);
  const run = spawnSync(process.execPath, [
    path.join(toolRoot, 'discover.mjs'),
    '--url', `${fixture}#${spec.id}`,
    '--out', outDir,
    '--breakpoints', BREAKPOINTS.join(','),
    '--settle-ms', '0',
    '--run-id', `discover-fixture-${spec.id}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const artifactPath = path.join(outDir, 'discovery.json');
  if (!fs.existsSync(artifactPath)) {
    failures.push(`${spec.id}: discovery produced no artifact\n${run.stdout}${run.stderr}`);
    continue;
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const before = failures.length;
  expect(artifact.status === 'PASS', `${spec.id}: discovery should PASS, got ${artifact.status}: ${artifact.failures.join('; ')}`);

  const found = {};
  for (const width of BREAKPOINTS) {
    found[width] = artifact.coverage[width].bands
      .map((band) => band.owner)
      .filter((owner) => !/^(WHITESPACE|UNCLAIMED)/.test(owner));
    expect(found[width].join(' | ') === spec.blocks[width].join(' | '),
      `${spec.id} @${width}: expected ${spec.blocks[width].join(' | ')}\n      got      ${found[width].join(' | ')}`);
  }

  if (spec.instances !== undefined) {
    expect(artifact.instances.length === spec.instances,
      `${spec.id}: expected ${spec.instances} instances, got ${artifact.instances.length}`);
    for (const instance of artifact.instances) {
      const missing = BREAKPOINTS.filter((width) => !instance.selector[width]);
      expect(!missing.length, `${spec.id}: "${instance.label}" is not one instance at every width, missing ${missing.join(', ')}`);
    }
  }

  const counts = BREAKPOINTS.map((width) => `${width}: ${found[width].length}`).join('  ');
  console.log(`  ${failures.length === before ? 'PASS' : 'FAIL'}  ${spec.id.padEnd(16)} blocks ${counts}  instances ${artifact.instances.length}`);
}

console.log('\nFixture assertions');
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed. Evidence: ${outRoot}`);
  process.exitCode = 1;
} else {
  console.log('  all assertions passed');
  console.log(`\nEvidence: ${outRoot}`);
  process.exitCode = 0;
}
