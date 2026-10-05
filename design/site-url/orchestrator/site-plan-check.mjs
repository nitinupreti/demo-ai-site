/**
 * Site plan and compose check: the gate rejects every way a site plan can leave a page incomplete or
 * a component unbuildable, the expansion derives disjoint scopes, a worker's contributions must cover
 * every unit it claims, and links and rich text are rewritten safely.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  brandTokens, checkSiteContribution, expandSitePlan, javaPackageName, ownedPathsFor, validateSitePlan,
} from './site-plan.mjs';
import { createLinkRewriter, itemsToHtml, mappedDeclaration } from './site-compose.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'site-plan-check-'));
const component = (name) => {
  const dir = path.join(repoRoot, 'ui.apps/src/main/content/jcr_root/apps/demo/components', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.content.xml'), '<jcr:root/>');
};
component('text');
component('teaser');

const unit = (id, extra = {}) => ({
  id, label: id, features: [], group: null, chrome: null, ...extra,
});
const catalog = {
  fingerprint: 'sha256:catalog',
  pages: [
    { id: 'p-001', units: ['p-001/inst-001', 'p-001/inst-002', 'p-001/inst-003', 'p-001/inst-004'] },
    { id: 'p-002', units: ['p-002/inst-001', 'p-002/inst-002', 'p-002/inst-003'] },
  ],
  chrome: [
    { id: 'c-01', slot: 'header', members: ['p-001/inst-001', 'p-002/inst-001'], representative: 'p-001/inst-001', label: 'nav' },
    { id: 'c-02', slot: 'footer', members: ['p-001/inst-004', 'p-002/inst-003'], representative: 'p-001/inst-004', label: 'foot' },
  ],
  groups: [
    { id: 'g-001', count: 2, members: ['p-001/inst-002', 'p-002/inst-002'], examples: ['p-001/inst-002', 'p-002/inst-002'] },
    { id: 'g-002', count: 1, members: ['p-001/inst-003'], examples: ['p-001/inst-003'] },
  ],
  units: {
    'p-001/inst-001': unit('p-001/inst-001', { chrome: 'c-01' }),
    'p-002/inst-001': unit('p-002/inst-001', { chrome: 'c-01' }),
    'p-001/inst-004': unit('p-001/inst-004', { chrome: 'c-02' }),
    'p-002/inst-003': unit('p-002/inst-003', { chrome: 'c-02' }),
    'p-001/inst-002': unit('p-001/inst-002', { group: 'g-001', features: ['heading', 'media'] }),
    'p-002/inst-002': unit('p-002/inst-002', { group: 'g-001', features: ['heading', 'media'] }),
    'p-001/inst-003': unit('p-001/inst-003', { group: 'g-002', features: ['heading'] }),
  },
};
const good = {
  run_id: 'r1',
  catalog_fingerprint: 'sha256:catalog',
  components: [
    { id: 'site-header', title: 'Header', role: 'chrome', tier: 4, groups: ['c-01'] },
    { id: 'site-footer', title: 'Footer', role: 'chrome', tier: 4, groups: ['c-02'], java: false },
    { id: 'hero', title: 'Hero', role: 'content', tier: 4, groups: ['g-001'] },
    {
      id: 'body-text', title: 'Text', role: 'content', tier: 1, reuse_target: 'demo/components/text', authoring: 'mapped', groups: ['g-002'],
    },
  ],
};
const gateOptions = {
  catalog, runId: 'r1', app: 'demo', repoRoot, siteUrl: 'https://www.acmepets.test/',
};
const gate = validateSitePlan(good, gateOptions);
expect(gate.valid, `a complete plan must pass: ${gate.errors.join('; ')}`);
expect(gate.assignment.size === 7 && gate.assignment.get('p-002/inst-001') === 'site-header', 'every unit must be assigned, chrome by its entry');

const rejects = (label, mutate, fragment) => {
  const plan = structuredClone(good);
  mutate(plan);
  const outcome = validateSitePlan(plan, gateOptions);
  expect(!outcome.valid && outcome.errors.some((error) => error.includes(fragment)),
    `${label}: expected an error containing "${fragment}", got ${outcome.errors.join(' | ') || 'none'}`);
};
rejects('unassigned group', (plan) => { plan.components[2].groups = []; }, 'g-001 (2 unit(s)');
rejects('double claim', (plan) => { plan.components[3].groups.push('g-001'); }, 'claimed by both');
rejects('chrome on content', (plan) => { plan.components[2].groups.push('c-01'); }, 'is site chrome');
rejects('content on chrome', (plan) => { plan.components[0].groups.push('g-002'); plan.components[3].groups = []; }, 'is chrome, so it renders chrome entries');
rejects('mixed slots', (plan) => { plan.components[0].groups.push('c-02'); plan.components[1].groups = []; }, 'both header and footer');
rejects('brand name', (plan) => { plan.components[2].id = 'acmepets-hero'; }, 'carries the site\'s name');
rejects('mapped media', (plan) => { plan.components[3].groups = ['g-002', 'g-001']; plan.components[2].groups = []; }, 'also holds media');
rejects('mapped tier', (plan) => { plan.components[2].authoring = 'mapped'; }, 'is mapped, which only');
rejects('missing reuse', (plan) => { plan.components[2].tier = 2; plan.components[2].reuse_target = 'demo/components/hero-base'; }, 'does not exist in ui.apps');
rejects('core reuse format', (plan) => { plan.components[2].tier = 3; plan.components[2].reuse_target = 'demo/components/teaser'; }, 'must be a Core Component');
rejects('overwrite', (plan) => { plan.components[2].id = 'teaser'; }, 'would overwrite the existing component');
rejects('cycle', (plan) => { plan.components[0].depends_on = ['hero']; plan.components[2].depends_on = ['site-header']; }, 'dependency cycle');
rejects('stale catalog', (plan) => { plan.catalog_fingerprint = 'sha256:old'; }, 'stale catalog');
rejects('unit moved twice', (plan) => { plan.components[2].units = ['p-001/inst-003']; plan.components[3].units = ['p-001/inst-003']; }, 'moved into both');
expect(validateSitePlan({ ...good, components: [{ ...good.components[2], groups: ['g-001'] }, ...good.components.filter((_, i) => i !== 2)] }, {
  ...gateOptions, builtByRun: new Set(['teaser']),
}).valid, 'reordering components must not matter');
const rebuilt = structuredClone(good);
rebuilt.components[2].id = 'teaser';
expect(validateSitePlan(rebuilt, { ...gateOptions, builtByRun: new Set(['teaser']) }).valid, 'a component this run built itself may be rebuilt');
const moved = structuredClone(good);
moved.components[2].units = ['p-001/inst-003'];
moved.components[3].groups = ['g-002'];
const movedGate = validateSitePlan(moved, gateOptions);
expect(!movedGate.valid && movedGate.errors.some((error) => error.includes('body-text renders no unit')), 'moving a unit out must leave its old component accountable');

expect(brandTokens('https://www.destinationpet.com/').join() === 'destinationpet', 'the brand is the site name');
expect(javaPackageName('switch') === 'switchcomponent' && javaPackageName('media-text') === 'mediatext', 'package names must be legal Java');
const owned = ownedPathsFor({ id: 'hero', tier: 4 }, { app: 'demo', javaRoot: 'com/demo/core/models' });
expect(owned.includes('ui.apps/src/main/content/jcr_root/apps/demo/components/hero')
  && owned.includes('core/src/test/java/com/demo/core/models/hero')
  && owned.includes('ui.apps/src/main/content/jcr_root/apps/demo/clientlibs/clientlib-components/css/hero.css'), `unexpected owned paths ${owned.join(', ')}`);
expect(ownedPathsFor({ id: 'body-text', tier: 1, authoring: 'mapped' }, { app: 'demo', javaRoot: 'x' }).length === 0, 'a mapped component owns nothing');

const plan = expandSitePlan(good, {
  catalog, gate, app: 'demo', javaRoot: 'com/demo/core/models', siteRoot: '/content/demo/site', xfRoot: '/content/experience-fragments/demo/site', container: 'root/container', breakpoints: [1440], componentGroup: 'Demo',
});
const hero = plan.components.find((entry) => entry.id === 'hero');
const header = plan.components.find((entry) => entry.id === 'site-header');
expect(hero.instances.join() === 'p-001/inst-002,p-002/inst-002' && hero.resource_type === 'demo/components/hero', 'units in page order, own resource type');
expect(hero.java_package === 'com.demo.core.models.hero', `unexpected package ${hero.java_package}`);
expect(header.chrome_slot === 'header' && header.contribution.path === '/content/experience-fragments/demo/site/header/master/jcr:content/root', 'chrome goes to its fragment');
expect(plan.components.find((entry) => entry.id === 'site-footer').java_package === null, 'java: false means no package');
expect(plan.waves.flat().sort().join() === 'hero,site-footer,site-header', 'mapped components get no worker');

const asNode = (instance, properties = {}) => ({ name: 'hero', instance, resource_type: 'demo/components/hero', properties });
expect(checkSiteContribution(hero, { contributions: { page_node: [asNode('p-001/inst-002')] } }, { damPaths: [] })
  .some((problem) => problem.includes('1 of your 2 units have no page_node')), 'a missing unit must be named');
expect(checkSiteContribution(hero, { contributions: { page_node: [asNode('p-001/inst-002', { fileReference: '/content/dam/site/a.jpg' }), asNode('p-002/inst-002')] } }, { damPaths: [] })
  .some((problem) => problem.includes('not in your assets list')), 'an invented DAM path must be refused');
expect(checkSiteContribution(hero, { contributions: { page_node: [asNode('p-001/inst-002'), asNode('p-002/inst-002')] } }, { damPaths: [] }).length === 0,
  'full coverage must pass');
expect(checkSiteContribution(header, { contributions: { experience_fragment_node: [{ name: 'nav', instance: 'p-002/inst-001' }] } }, { damPaths: [] })
  .some((problem) => problem.includes('instance "p-001/inst-001"')), 'chrome must author its representative');

const rewriter = createLinkRewriter({
  linkEntries: [
    { source_url: 'https://www.acmepets.test/', aem_path: '/content/demo/site' },
    { source_url: 'https://www.acmepets.test/about/', aem_path: '/content/demo/site/about' },
  ],
  hosts: ['www.acmepets.test', 'acmepets.test'],
  canonicalOrigin: 'https://www.acmepets.test',
});
expect(rewriter.rewrite('https://acmepets.test/about') === '/content/demo/site/about', 'a link to a migrated page becomes its AEM path');
expect(rewriter.rewrite('/about/#team') === '/content/demo/site/about#team', 'a root-relative link keeps its fragment');
expect(rewriter.rewrite('https://www.acmepets.test/careers/') === 'https://www.acmepets.test/careers/', 'an unmigrated same-site page stays absolute');
expect(rewriter.rewrite('/content/dam/site/a.jpg') === '/content/dam/site/a.jpg', 'DAM paths are left alone');
expect(rewriter.rewrite('Call us today') === 'Call us today', 'plain text is left alone');
const rich = rewriter.rewrite('<p>See <a href="https://www.acmepets.test/about/">us</a>, <a href="https://elsewhere.test/x">them</a> and <a href="java\tscript:alert(1)">this</a></p>');
expect(rich.includes('href="/content/demo/site/about.html"') && rich.includes('href="https://elsewhere.test/x"') && !/script:/i.test(rich),
  `rich text must be rewritten and made safe, got ${rich}`);
const summary = rewriter.summary();
expect(summary.external_hosts.includes('elsewhere.test') && summary.unsafe_links_dropped === 1 && summary.unmigrated_same_site.length === 1, `unexpected link summary ${JSON.stringify(summary)}`);

const html = itemsToHtml([
  { type: 'heading', level: 2, text: 'Terms', html: 'Terms' },
  { type: 'text', text: 'A & B', html: 'A &amp; B' },
  { type: 'list', ordered: true, items: [{ text: 'one', html: 'one' }] },
  { type: 'image', src: 'x' },
]);
expect(html === '<h2>Terms</h2>\n<p>A &amp; B</p>\n<ol><li>one</li></ol>', `unexpected rich text ${html}`);
const image = mappedDeclaration({ id: 'pic', reuse_target: 'demo/components/image', resource_type: 'demo/components/image' }, 'p-001/inst-009',
  { items: [{ type: 'image', src: 'https://cdn.test/a.jpg', alt: 'A dog' }] },
  (url) => (url === 'https://cdn.test/a.jpg' ? { dam_path: '/content/dam/site/a.jpg' } : null));
expect(image.properties.fileReference === '/content/dam/site/a.jpg' && image.properties.alt === 'A dog', 'a mapped image authors its DAM asset');

fs.rmSync(repoRoot, { recursive: true, force: true });
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('site plan and compose assertions: all passed');
}
