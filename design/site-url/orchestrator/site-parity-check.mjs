/**
 * Site parity check: each page's blocks are located in AEM by position inside the element that holds
 * them, scored only where discovery saw them, merged across pages into one verdict per component, and
 * shown to remediation worst first. The id Core Components generate is checked against real AEM output.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { parseJcrXml } from './jcr-xml.mjs';
import {
  batchEvidence, contentContainer, generatedId, locateTargets, mergeSiteParity, pageParityConfig, pageProblems, pageTargets,
  syncClientlibIndexes,
} from './site-parity.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// Rendered by AEM for the about page of a migrated site: <div id="container-98b0b97747" class="cmp-container">.
expect(generatedId('demo-ai-site/components/container', '/content/demo-ai-site/destinationpet-trial/about-us/about/jcr:content/root/container/container')
  === 'container-98b0b97747', 'the generated id must match what Core Components render');

const NS = 'xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"';
const template = (attributes) => ({
  container: 'root/container/container',
  initial: parseJcrXml(`<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page">
    <jcr:content jcr:primaryType="cq:PageContent">
        <root jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid">
            <container jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid">
                <container jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" ${attributes}/>
            </container>
        </root>
    </jcr:content>
</jcr:root>
`),
});
const generated = contentContainer(template('layout="responsiveGrid"'), '/content/demo/site/about');
expect(generated.id === generatedId('demo/components/container', '/content/demo/site/about/jcr:content/root/container/container') && generated.grid,
  `a container with no id gets the generated one, got ${JSON.stringify(generated)}`);
const authored = contentContainer(template('id=" main  content "'), '/content/demo/site/about');
expect(authored.id === 'main-content' && !authored.grid, `an authored id wins, normalised as AEM does, got ${JSON.stringify(authored)}`);

const catalog = {
  pages: [{ id: 'p-002', units: ['p-002/inst-001', 'p-002/inst-002', 'p-002/inst-003', 'p-002/inst-004'] }],
  units: {
    'p-002/inst-001': { chrome: 'c-01' },
    'p-002/inst-002': { chrome: null },
    'p-002/inst-003': { chrome: null },
    'p-002/inst-004': { chrome: 'c-02' },
  },
};
const fragments = {
  header: [{ entry: 'c-01', unit: 'p-001/inst-001', component: 'site-header' }],
  footer: [{ entry: 'c-03', unit: 'p-001/inst-009', component: 'legal-bar' }, { entry: 'c-02', unit: 'p-001/inst-005', component: 'site-footer' }],
};
const coverage = {
  page: 'p-002',
  nodes: [{ unit: 'p-002/inst-002', component: 'hero' }, { unit: 'p-002/inst-003', component: 'hero' }],
};
const targets = pageTargets({
  coverage, fragments, catalog, container: { id: 'container-abc', grid: true },
});
const css = (unit) => targets.find((entry) => entry.unit === unit)?.target.css;
expect(css('p-002/inst-001') === '.cmp-experiencefragment--header > .cmp-container > .aem-Grid > :nth-child(1)', `header target: ${css('p-002/inst-001')}`);
expect(css('p-002/inst-004') === '.cmp-experiencefragment--footer > .cmp-container > .aem-Grid > :nth-child(2)', `footer target: ${css('p-002/inst-004')}`);
expect(css('p-002/inst-003') === '[id="container-abc"] > .aem-Grid > :nth-child(2)', `content target: ${css('p-002/inst-003')}`);
expect(targets.find((entry) => entry.unit === 'p-002/inst-004').component === 'site-footer', 'chrome is scored as the component its fragment renders');
const simple = pageTargets({
  coverage, fragments: {}, catalog, container: { id: 'main', grid: false },
});
expect(simple.length === 2 && simple[0].target.css === '[id="main"] > :nth-child(1)', 'a simple container holds its children directly');

const block = (id, selectors, text) => ({
  id,
  selector: Object.fromEntries(Object.entries(selectors).map(([bp, cssText]) => [bp, { css: cssText, match_index: 0 }])),
  rect: Object.fromEntries(Object.keys(selectors).map((bp) => [bp, { x: 0, y: Number(id.slice(-1)) * 200, w: Number(bp), h: 100 }])),
  signature: { text },
  class_chain: Object.values(selectors).slice(0, 1),
});
const page = {
  id: 'p-002',
  url: 'https://www.example.test/about/',
  aem_path: '/content/demo/site/about',
  discovery: {
    source: { final_url: 'https://www.example.test/about/' },
    instances: [
      block('inst-001', { 375: 'header.top', 1440: 'header.top' }, 'Home About'),
      block('inst-002', { 1440: 'div.hero' }, 'About our team'),
      block('inst-003', { 375: 'div.hero-two', 1440: 'div.hero-two' }, 'Second'),
      block('inst-004', { 375: 'footer.bottom', 1440: 'footer.bottom' }, 'Copyright'),
    ],
  },
};
const config = pageParityConfig({
  runId: 'r1', page, targets, aemUrl: 'http://localhost:4502', breakpoints: [375, 1440], threshold: 0.85, username: 'admin',
});
const rows = (instance) => config.components.filter((entry) => entry.instance === instance);
expect(config.source_url === 'https://www.example.test/about/' && config.targets[0].url === 'http://localhost:4502/content/demo/site/about.html?wcmmode=disabled',
  'the page is compared with its own source, wcmmode disabled');
expect(config.auth.password_env === 'AEM_PASSWORD' && !JSON.stringify(config).includes('admin:'), 'credentials stay in the environment');
expect(rows('inst-002').length === 1 && rows('inst-002')[0].source.bp === 1440, 'a block is scored only where discovery saw it');
expect(rows('inst-003').length === 2 && rows('inst-003').every((entry) => entry.target.css === '[id="container-abc"] > .aem-Grid > :nth-child(2)'),
  'every breakpoint of a block points at the same element');
expect(rows('inst-001')[0].id === 'site-header' && rows('inst-001')[0].signature_text === 'Home About', 'rows carry their component and source text');

// Merge: one component on two pages, failing on one, with relative evidence made absolute.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'site-parity-check-'));
const row = (component, instance, status, ratio, extra = {}) => ({
  component_id: component,
  instance,
  breakpoint: 1440,
  mode: 'disabled',
  status,
  visual_match_ratio: ratio,
  progress_ratio: null,
  owning_layer_hint: status === 'PASS' ? null : 'spacing',
  side_by_side: `evidence/${component}-${instance}.png`,
  source: { selector: 'div.hero' },
  target: { selector: '[id="c"] > .aem-Grid > :nth-child(1)' },
  ...extra,
});
const artefact = (status, results, composite, blocked = false) => ({
  status,
  source_url: 'https://www.example.test/',
  results,
  preflight: { status: blocked ? 'FAIL' : 'PASS', environment_blocked: blocked, checks: [{ breakpoint: 1440, target_redirected_to: blocked ? 'http://localhost:4502/libs/granite/core/content/login.html' : null }] },
  page_composite: { '1440-disabled': { status: composite >= 0.85 ? 'PASS' : 'FAIL', ratio: composite, side_by_side: 'evidence/full.png' } },
  summary: { components_passed: results.filter((entry) => entry.status === 'PASS').length, components_total: results.length },
});
const runs = [
  {
    page: { id: 'p-001', aem_path: '/content/demo/site' },
    dir: path.join(sandbox, 'p-001'),
    artefact: artefact('PASS', [row('hero', 'inst-002', 'PASS', 0.97), row('site-header', 'inst-001', 'PASS', 0.99)], 0.95),
  },
  {
    page: { id: 'p-002', aem_path: '/content/demo/site/about' },
    dir: path.join(sandbox, 'p-002'),
    artefact: artefact('FAIL', [
      row('hero', 'inst-002', 'FAIL', 0.71),
      row('hero', 'inst-003', 'FAIL', 0.8, { owning_layer_hint: 'color-tokens' }),
      row('hero', 'inst-005', 'WITHHELD', null, { progress_ratio: 0.4, withheld_reason: 'crop dimensions differ', owning_layer_hint: 'spacing' }),
      row('site-header', 'inst-001', 'PASS', 0.98),
    ], 0.7),
  },
];
const merged = mergeSiteParity(runs, { threshold: 0.85, cycle: 0 });
const hero = merged.components.find((entry) => entry.component_id === 'hero');
const header = merged.components.find((entry) => entry.component_id === 'site-header');
expect(merged.status === 'FAIL' && merged.summary.pages_passed === 1 && merged.summary.pages_total === 2, 'one failing page fails the site');
expect(hero.status === 'FAIL' && hero.min_ratio === 0.71 && hero.min_progress_ratio === 0.4 && hero.failed_pages.join() === 'p-002',
  `the hero fails where it failed, got ${JSON.stringify(hero)}`);
expect(hero.owning_layer_hint === 'spacing', 'the layer most failures point at is the one blamed');
expect(header.status === 'PASS' && header.pages.length === 2, 'a component passing on every page passes');
expect(merged.results.find((entry) => entry.unit === 'p-002/inst-003')?.side_by_side === path.join(sandbox, 'p-002', 'evidence', 'hero-inst-003.png'),
  'evidence paths are absolute and rows carry their unit');
expect(merged.page_composite['p-002@1440-disabled']?.status === 'FAIL' && merged.page_composite['p-002@1440-disabled'].page === 'p-002',
  'composites are keyed by page');
const about = merged.pages.find((entry) => entry.page === 'p-002');
expect(pageProblems(about).join(' | ') === 'hero fail | whole page: screenshot only 70.00% alike at 1440',
  `a failing page names what failed, got ${pageProblems(about).join(' | ')}`);
const spacing = mergeSiteParity([{
  ...runs[0],
  artefact: {
    ...runs[0].artefact,
    status: 'FAIL',
    page_composite: {
      '768-disabled': { status: 'FAIL', ratio: 0.98, gap_failure_reason: 'hero->media-text 89px vs 0px (-89)' },
      '1440-disabled': { status: 'FAIL', ratio: 0.99, gap_failure_reason: 'hero->media-text 88px vs 0px (-88)' },
    },
  },
}], { threshold: 0.85 });
expect(pageProblems(spacing.pages[0]).join() === 'whole page: spacing between blocks differs at 768, 1440',
  `a page alike in pixels but wrong in spacing must say so, got ${pageProblems(spacing.pages[0]).join()}`);
expect(!merged.preflight.environment_blocked, 'nothing was blocked');
const blockedRuns = [{ ...runs[0], artefact: artefact('FAIL', [], 0.9, true) }];
expect(mergeSiteParity(blockedRuns, { threshold: 0.85 }).preflight.environment_blocked, 'a login bounce on any page blocks the site');
expect(mergeSiteParity([{ ...runs[0], artefact: null, error: 'parity crashed' }], { threshold: 0.85 }).pages[0].status === 'ERROR',
  'a page with no artefact is an error, never a pass');

// Remediation sees the worst rows first, and the pages they sit on.
const evidence = batchEvidence(merged, ['hero']);
expect(evidence.failing.length === 3 && evidence.deltas[0][0].instance === 'inst-005' && evidence.deltas[0][1].visual_match_ratio === 0.71,
  'deltas are the worst rows first, withheld progress included');
expect(Object.keys(evidence.page_composite).join() === 'p-002@1440-disabled', 'only the pages the component fails on are shown');

// A file remediation adds inside a component's paths is loaded.
const clientlib = path.join(sandbox, 'repo', 'clientlib-components');
fs.mkdirSync(path.join(clientlib, 'js'), { recursive: true });
fs.mkdirSync(path.join(clientlib, 'css'), { recursive: true });
fs.writeFileSync(path.join(clientlib, 'css.txt'), '#base=css\nhero.css\n');
fs.writeFileSync(path.join(clientlib, 'js.txt'), '#base=js\n');
fs.writeFileSync(path.join(clientlib, 'css', 'hero.css'), '');
fs.writeFileSync(path.join(clientlib, 'js', 'hero.js'), '');
const sitePlan = {
  shared: { clientlib_index: 'clientlib-components/css.txt', clientlib_js_index: 'clientlib-components/js.txt' },
  components: [{ id: 'hero' }, { id: 'body-text' }],
};
const synced = syncClientlibIndexes(path.join(sandbox, 'repo'), sitePlan);
expect(synced.join() === 'clientlib-components/js.txt' && fs.readFileSync(path.join(clientlib, 'js.txt'), 'utf8') === '#base=js\nhero.js\n',
  'a new script is listed, an index already complete is left alone');
expect(syncClientlibIndexes(path.join(sandbox, 'repo'), sitePlan).length === 0, 'listing is idempotent');

// Before anything is scored, every element the selectors need must exist in AEM.
const html = {
  '/content/demo/site.html': '<div class="cmp-experiencefragment cmp-experiencefragment--header"></div><div id="container-a" class="cmp-container"></div>',
  '/content/demo/site/about.html': '<div class="cmp-experiencefragment--header"></div><div id="container-x" class="cmp-container"></div>',
};
const problems = await locateTargets([
  { page: { aem_path: '/content/demo/site' }, container: { id: 'container-a' }, content: true, slots: ['header'] },
  { page: { aem_path: '/content/demo/site/about' }, container: { id: 'container-b' }, content: true, slots: ['header', 'footer'] },
  { page: { aem_path: '/content/demo/site/gone' }, container: { id: 'container-c' }, content: true, slots: [] },
], {
  aemUrl: 'http://localhost:4502',
  username: 'admin',
  password: 'admin',
  fetchFn: async (address) => {
    const body = html[new URL(address).pathname];
    return { status: body ? 200 : 404, text: async () => body };
  },
});
expect(problems.length === 3 && problems.some((entry) => entry.includes('"container-b"')) && problems.some((entry) => entry.includes('no footer fragment'))
  && problems.some((entry) => entry.includes('HTTP 404')), `every missing element is named, got ${problems.join(' | ')}`);

fs.rmSync(sandbox, { recursive: true, force: true });
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('site parity assertions: all passed');
}
