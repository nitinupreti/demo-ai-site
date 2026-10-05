/**
 * Catalog check: chrome found by repetition of words (not of classes), heroes that only repeat
 * their classes left as content, units grouped by structure, and a stable fingerprint.
 */
import process from 'node:process';

import {
  buildCatalog, featuresOf, selectorSignature, similarity, splitUnitId, unitId,
} from './catalog.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const instance = (id, order, css, text, extra = {}) => ({
  id,
  order,
  label: text.slice(0, 40),
  selector: { 1440: { css, match_index: 0 } },
  rect: { 1440: { x: 0, y: order * 100, w: 1440, h: 100 } },
  signature: { tag: 'div', text },
  class_chain: [css.split('.').slice(0, 2).join('.')],
  ...extra,
});
const content = (id, text, items = []) => ({ id, found: true, text, items, links: [], html: `<div>${text}</div>` });
const HEADER = 'Home About Services Contact Careers';
const FOOTER = 'Copyright Example Inc Privacy Terms Sitemap';

const page = (id, hero, { footerCss = 'footer.site-footer', extra = [] } = {}) => ({
  id,
  url: `https://example.test/${id}/`,
  aem_path: `/content/site/${id}`,
  discovery: {
    source_fingerprint: `sha256:${id}`,
    instances: [
      instance('inst-001', 1, 'header.site-header.aem-GridColumn', HEADER),
      instance('inst-002', 2, 'div.hero.aem-GridColumn--default--12', hero),
      ...extra.map((entry, index) => instance(`inst-${String(index + 3).padStart(3, '0')}`, index + 3, entry.css, entry.text, entry.instance)),
      instance(`inst-${String(extra.length + 3).padStart(3, '0')}`, extra.length + 3, footerCss, FOOTER),
    ],
  },
  content: {
    source: { source_fingerprint: `sha256:${id}` },
    instances: [
      content('inst-001', HEADER, [{ type: 'list', items: [] }]),
      content('inst-002', hero, [{ type: 'heading', level: 1, text: hero }, { type: 'image', src: 'https://cdn.test/a.jpg' }]),
      ...extra.map((entry, index) => content(`inst-${String(index + 3).padStart(3, '0')}`, entry.text, entry.items || [])),
      content(`inst-${String(extra.length + 3).padStart(3, '0')}`, FOOTER),
    ],
  },
});

const FORM = { css: 'div.rawhtml', text: '', items: [{ type: 'embed', tag: 'iframe', src: 'https://forms.example.net/123' }] };
const pages = [
  page('p-001', 'Welcome to the example company', { extra: [{ css: 'div.text', text: 'Intro words here', items: [{ type: 'text', text: 'Intro' }] }] }),
  page('p-002', 'About our long history', { footerCss: 'div.cmp-container', extra: [FORM] }),
  page('p-003', 'Services we offer'),
  {
    ...page('p-004', 'unused'),
    discovery: {
      source_fingerprint: 'sha256:p-004',
      instances: [
        instance('inst-001', 1, 'header.site-header', HEADER),
        instance('inst-002', 2, 'footer.site-footer', FOOTER),
      ],
    },
    content: { source: { source_fingerprint: 'sha256:p-004' }, instances: [content('inst-001', HEADER), content('inst-002', FOOTER)] },
  },
];

expect(unitId('p-001', 'inst-002') === 'p-001/inst-002' && splitUnitId('p-001/inst-002').instance === 'inst-002', 'unit ids must round-trip');
const signature = selectorSignature('main > div.hero.teaser.aem-GridColumn.aem-GridColumn--default--12');
expect(signature.tag === 'div' && signature.classes.join('.') === 'hero.teaser', `generated classes must be dropped, got ${signature.classes.join('.')}`);
expect(featuresOf([{ type: 'embed', src: 'https://forms.example.net/1' }]).features.includes('embed:forms.example.net'), 'an embed must name its host');
expect(similarity('a b c d', 'a b c d') === 1 && similarity('one two', 'three four') === 0, 'similarity must be word overlap');

const catalog = buildCatalog(pages);
const header = catalog.chrome.find((entry) => entry.slot === 'header');
const footer = catalog.chrome.find((entry) => entry.slot === 'footer');
expect(catalog.chrome.length === 2, `expected a header and a footer, got ${catalog.chrome.map((entry) => entry.slot).join(', ')}`);
expect(header?.members.length === 4 && header.representative === 'p-001/inst-001', `the header must be on every page, got ${header?.members.join(', ')}`);
expect(footer?.members.length === 4, `a footer with a different selector on one page is still the footer, got ${footer?.members.join(', ')}`);
expect(footer?.members.includes('p-004/inst-002'), 'on a two-block page, the last block is the footer, not a second header');
const heroGroup = catalog.groups.find((group) => group.members.includes('p-001/inst-002'));
expect(heroGroup && heroGroup.count === 3 && !catalog.units['p-001/inst-002'].chrome, 'heroes repeat their classes, not their words, so they stay content in one group');
expect(heroGroup?.examples.length === 3 && new Set(heroGroup.examples.map((id) => splitUnitId(id).page)).size === 3, 'examples must come from distinct pages');
const formGroup = catalog.groups.find((group) => group.members.includes('p-002/inst-003'));
expect(formGroup?.features.includes('embed:forms.example.net') && formGroup.count === 1, 'the form embed must be a group of its own');
expect(catalog.totals.units === 13 && catalog.totals.chrome_units === 8, `unexpected totals ${JSON.stringify(catalog.totals)}`);
expect(Object.values(catalog.units).every((unit) => Boolean(unit.group) !== Boolean(unit.chrome)), 'every unit is chrome or in exactly one group');
expect(JSON.stringify(buildCatalog(pages)) === JSON.stringify(catalog), 'the same captures must give the same catalog');
const changed = structuredClone(pages);
changed[1].discovery.source_fingerprint = 'sha256:other';
expect(buildCatalog(changed).fingerprint !== catalog.fingerprint, 'a new capture must change the fingerprint');

const single = buildCatalog([pages[0]]);
expect(single.chrome.length === 0, 'one page alone has nothing to repeat, so it has no chrome');

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('catalog assertions: all passed');
}
