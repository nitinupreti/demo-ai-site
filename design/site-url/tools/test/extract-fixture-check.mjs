#!/usr/bin/env node
/**
 * Preflight proof for the frozen content capture: reads a fixture page through a known set of block
 * selectors and asserts that headings, rich text, lists, media, links, buttons, forms, icons,
 * menu links hidden until hover, scroll-revealed text and mobile-only blocks are all captured.
 *
 *   node design/site-url/tools/test/extract-fixture-check.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.dirname(here);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-fixture-'));
const fixture = pathToFileURL(path.join(here, 'fixture-extract.html')).href;

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// Selectors are given, not discovered, so this proves capture alone, whatever discovery would split.
const at = (css, widths = [375, 1440]) => Object.fromEntries(widths.map((width) => [width, { css, match_index: 0 }]));
const BLOCKS = {
  'inst-001': at('header.site-header'),
  'inst-002': at('div.mobile-cta', [375]),
  'inst-003': at('section.hero'),
  'inst-004': at('section.feature'),
  'inst-005': at('section.panel'),
  'inst-006': at('section.banner'),
  'inst-007': at('footer.site-footer'),
};
const discoveryPath = path.join(outDir, 'discovery.json');
fs.writeFileSync(discoveryPath, JSON.stringify({
  schema_version: 1,
  source: { requested_url: fixture, final_url: fixture },
  source_fingerprint: 'sha256:fixture',
  breakpoints: [375, 1440],
  instances: Object.entries(BLOCKS).map(([id, selector]) => ({ id, label: id, selector })),
  status: 'PASS',
}, null, 2));

const run = spawnSync(process.execPath, [
  path.join(toolRoot, 'extract.mjs'), '--discovery', discoveryPath, '--out', outDir, '--settle-ms', '0', '--run-id', 'extract-fixture',
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });

const artifactPath = path.join(outDir, 'content.json');
if (!fs.existsSync(artifactPath)) {
  console.log(`  FAIL extraction wrote no artifact\n${run.stdout}${run.stderr}`);
  process.exit(1);
}
const content = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const block = (id) => content.instances.find((instance) => instance.id === id) || { items: [], links: [] };
const items = (id, type) => block(id).items.filter((item) => item.type === type);

expect(content.status === 'PASS', `extraction must PASS, got ${content.status}: ${content.failures.join('; ')}`);
expect(content.instances.every((instance) => instance.found), 'every block must be found');

const header = block('inst-001');
expect(items('inst-001', 'link').some((item) => item.text === 'About us' && item.href.endsWith('/about/')), 'menu links must be items');
expect(header.links.some((link) => link.text === 'Grooming' && link.hidden === true),
  `a dropdown link hidden until hover must still be listed, got ${JSON.stringify(header.links)}`);
expect(!items('inst-001', 'link').some((item) => item.text === 'Grooming'), 'a hidden dropdown is not a visible item');

const mobile = block('inst-002');
expect(mobile.breakpoint === 375 && items('inst-002', 'link')[0]?.text === 'Call now',
  `a mobile-only block must be read at 375px, got ${mobile.breakpoint} ${JSON.stringify(mobile.items)}`);

expect(items('inst-003', 'heading')[0]?.level === 1 && items('inst-003', 'heading')[0]?.text === 'Care for every pet', 'the hero heading must be read');
const story = items('inst-003', 'text')[0];
expect(story?.html.includes('<strong>families</strong>') && /<a href="[^"]*\/about\/">Read our story<\/a>/.test(story.html),
  `rich text must keep emphasis and links, got ${story?.html}`);
expect(items('inst-003', 'link').some((item) => item.text === 'Book a visit' && item.button), 'a call to action must be marked as a button');
expect(items('inst-003', 'background').some((item) => item.src.startsWith('data:image/svg+xml')), 'a background image must be read');

expect(items('inst-004', 'image').map((item) => item.alt).join() === 'Grooming,Boarding,Daycare', 'card images must keep their alt text in order');
expect(items('inst-004', 'heading').map((item) => item.text).join() === 'Our services,Grooming,Boarding,Daycare', 'card headings must be read in order');
expect(items('inst-004', 'link').filter((item) => item.text === 'Learn more').length === 3, 'every card link must be read');

expect(items('inst-005', 'list')[0]?.items.map((entry) => entry.text).join() === 'Certified staff,Open every day,Free first visit', 'list items must be read');
expect(items('inst-005', 'text').some((item) => item.tag === 'div' && item.text === 'Open 7 days a week. See hours'),
  'text written straight into a layout box must be read');
const form = items('inst-005', 'form')[0];
expect(form?.method === 'post' && form.action.endsWith('/subscribe'), 'the form target must be read');
expect(form?.fields.some((field) => field.name === 'email' && field.label === 'Email address' && field.required), 'labelled fields must be read');
expect(!form?.fields.some((field) => field.name === 'token'), 'hidden fields are not content');
expect(form?.fields.some((field) => field.name === 'topic' && field.options?.join() === 'Grooming,Boarding'), 'select options must be read');

expect(items('inst-006', 'heading').some((item) => item.text === 'Revealed on scroll'), 'text hidden until scrolled into view must be read');
expect(items('inst-006', 'embed')[0]?.title === 'Map', 'an embedded frame must be read');

expect(items('inst-007', 'icon').some((item) => item.label === 'Facebook'), 'an inline SVG icon must be read with its label');
expect(block('inst-007').html.startsWith('<footer') && !block('inst-007').html.includes('<script'), 'the snapshot must be sanitised HTML');

console.log(`  ${failures.length ? 'FAIL' : 'PASS'}  ${content.instances.length} blocks, `
  + `${content.instances.reduce((sum, instance) => sum + instance.items.length, 0)} items`);
console.log('\nExtraction fixture assertions');
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed. Evidence: ${outDir}`);
  process.exitCode = 1;
} else {
  console.log('  all assertions passed');
  console.log(`\nEvidence: ${outDir}`);
}
