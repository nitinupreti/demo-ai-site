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
  {
    // decode() on a lazy image the viewport never reaches waits for a fetch that never starts.
    id: 'clipped-lazy',
    blocks: everywhere([HEADER, 'div.hero', 'div.ticker', 'div.feature', FOOTER]),
    instances: 5,
    promoted: 2,
  },
  {
    // An author rebuilds a block from its copy, links, icons and background art, not from a signature.
    id: 'content',
    blocks: everywhere([HEADER, 'div.hero', 'div.image', 'div.feature', FOOTER]),
    instances: 5,
    content: true,
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
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });

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

  if (spec.promoted !== undefined) {
    for (const readiness of artifact.readiness) {
      expect(readiness.images.promoted === spec.promoted,
        `${spec.id} @${readiness.breakpoint}: expected ${spec.promoted} clipped lazy images loaded eagerly, got ${readiness.images.promoted}`);
    }
  }

  if (spec.content) {
    const header = artifact.instances.find((instance) => instance.selector[1440]?.css === HEADER);
    const hero = artifact.instances.find((instance) => instance.selector[1440]?.css === 'div.hero');
    const svg = header?.content?.[1440]?.svgs?.[0];
    const svgFile = svg?.file ? path.join(outDir, svg.file) : null;
    const markup = svgFile && fs.existsSync(svgFile) ? fs.readFileSync(svgFile, 'utf8') : '';
    expect(Boolean(svg?.sha256) && !('markup' in svg), `${spec.id}: an inline SVG must be exported to a file, got ${JSON.stringify(svg)}`);
    expect(markup.includes('fill="rgb(229, 83, 75)"') && markup.includes('xmlns="http://www.w3.org/2000/svg"'),
      `${spec.id}: the exported SVG must carry the fill its CSS class gave it, got ${markup.slice(0, 200)}`);
    expect(String(svg?.in_link).endsWith('/home'), `${spec.id}: the SVG must record the link it sits in`);

    const text = hero?.content?.[1440]?.text || [];
    const paragraph = text.find((entry) => entry.tag === 'p');
    expect(text.some((entry) => entry.tag === 'h1' && entry.level === 1 && entry.text === 'Content is captured whole'),
      `${spec.id}: a heading must be captured whole with its level, got ${JSON.stringify(text)}`);
    expect(paragraph?.text === 'Read the full guide for every word of it.'
      && /<a href="file:[^"]+\/docs\/guide\.html">full guide<\/a>/.test(paragraph?.html || ''),
    `${spec.id}: a paragraph must keep its whole text and its inline link, got ${JSON.stringify(paragraph)}`);
    expect(!text.some((entry) => entry.tag === 'a'), `${spec.id}: a link inside captured text must not be captured twice`);
    expect((hero?.content?.[1440]?.links || []).some((link) => link.href.endsWith('/docs/guide.html') && link.text === 'full guide'),
      `${spec.id}: links must be recorded with absolute targets`);
    expect((hero?.content?.[1440]?.backgrounds || []).some((entry) => entry.url.startsWith('data:image/svg+xml')),
      `${spec.id}: CSS background art must be recorded, got ${JSON.stringify(hero?.content?.[1440]?.backgrounds)}`);

    const face = (artifact.fonts?.faces || []).find((entry) => entry.family === 'Fixture Face');
    expect(face && face.loaded === false && /\/fixture-face\.woff2$/.test(face.src?.[0]?.url || '') && face.src[0].format === 'woff2',
      `${spec.id}: an unused @font-face must be recorded with its absolute source and as not loaded, got ${JSON.stringify(face)}`);
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
