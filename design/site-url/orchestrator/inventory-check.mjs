/**
 * Proof for the AEM page tree: crawled pages map to stable page names, missing parents become
 * placeholders, clashing names get a suffix, and siblings follow the source's own order.
 */
import process from 'node:process';

import {
  buildSiteTree, formatTree, jcrName, summarizeInventory, validateSiteRoot,
} from './inventory.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const refuses = (run, message) => {
  let threw = false;
  try { run(); } catch { threw = true; }
  expect(threw, message);
};

expect(jcrName('About-Us') === 'about-us', 'names are lowercase');
expect(jcrName('Caf%C3%A9%20Menu') === 'cafe-menu', `accents and spaces must be cleaned, got ${jcrName('Caf%C3%A9%20Menu')}`);
expect(jcrName('page.html') === 'page', 'page extensions must be dropped');
expect(jcrName('__drafts__') === 'drafts', 'leading underscores would clash with FileVault names');
expect(jcrName('***') === 'page', 'a name is never empty');
expect(jcrName('x'.repeat(80)).length === 60, 'names are bounded');

refuses(() => validateSiteRoot('content/site'), 'a relative site root must be refused');
refuses(() => validateSiteRoot('/content/site/'), 'a trailing slash must be refused');
refuses(() => validateSiteRoot('/apps/site'), 'a site root outside /content must be refused');
refuses(() => validateSiteRoot('/content/my site'), 'spaces must be refused');
expect(validateSiteRoot('/content/demo-ai-site/site') === '/content/demo-ai-site/site', 'a page path is accepted');

const ROOT = '/content/demo/site';
const page = (id, path, sitemapIndex = null) => ({
  id, url: `https://x.test${path}`, key: `https://x.test${path.replace(/\/$/, '') || '/'}`, sitemap_index: sitemapIndex,
});
const inventory = {
  fingerprint: 'sha256:fixture',
  scope: { seed_path_prefix: '' },
  // The start page links to services before about-us, so that is the order authors see.
  link_order: ['https://x.test/services', 'https://x.test/about-us'],
  pages: [
    page('p-001', '/', 0),
    page('p-002', '/about-us/', 1),
    page('p-003', '/about-us/meet-the-team/leadership/', 2),
    page('p-004', '/services/'),
    page('p-005', '/About-Us/'),
    page('p-006', '/careers/', 3),
  ],
  aliases: [],
  excluded: [],
  external_links: [],
  documents: [],
};
const tree = buildSiteTree(inventory, { siteRoot: ROOT });
const paths = tree.nodes.map((node) => node.aem_path);
expect(JSON.stringify(paths) === JSON.stringify([
  ROOT,
  `${ROOT}/services`,
  `${ROOT}/about-us`,
  `${ROOT}/about-us/meet-the-team`,
  `${ROOT}/about-us/meet-the-team/leadership`,
  `${ROOT}/careers`,
  `${ROOT}/about-us-2`,
]), `tree order must follow links, then the sitemap, then the crawl, got\n      ${paths.join('\n      ')}`);
const placeholder = tree.nodes.find((node) => node.aem_path === `${ROOT}/about-us/meet-the-team`);
expect(placeholder?.placeholder && placeholder.redirect_to === `${ROOT}/about-us/meet-the-team/leadership`,
  'a missing parent must become a placeholder redirecting to its first child');
expect(tree.renamed.length === 1 && tree.renamed[0].id === 'p-005' && tree.renamed[0].aem_path === `${ROOT}/about-us-2`,
  `a clashing name must take the next suffix, got ${JSON.stringify(tree.renamed)}`);
expect(tree.pages === 6 && tree.placeholders === 1, `counts must match, got ${tree.pages} pages, ${tree.placeholders} placeholders`);
expect(tree.nodes[0].page_id === 'p-001', 'the start page is the site root');

const drawn = formatTree(tree);
expect(JSON.stringify(drawn) === JSON.stringify([
  `${ROOT}  <- /`,
  '|- services  <- /services/',
  '|- about-us  <- /about-us/',
  '|  `- meet-the-team  (placeholder, redirects to leadership)',
  '|     `- leadership  <- /about-us/meet-the-team/leadership/',
  '|- careers  <- /careers/',
  '`- about-us-2  <- /About-Us/',
]), `the drawn tree must be exact, got\n      ${drawn.join('\n      ')}`);

// A section start page is the root; its own path prefix is not repeated below it.
const section = buildSiteTree({
  ...inventory,
  scope: { seed_path_prefix: '/en' },
  link_order: [],
  pages: [page('p-001', '/en/'), page('p-002', '/en/about/')],
}, { siteRoot: ROOT });
expect(section.nodes.map((node) => node.aem_path).join() === `${ROOT},${ROOT}/about`,
  `a section must map below the root, got ${section.nodes.map((node) => node.aem_path).join()}`);

// Under --keep-query the query is what tells pages apart, so it names them.
const queried = buildSiteTree({
  ...inventory,
  link_order: [],
  pages: [page('p-001', '/'), page('p-002', '/?page_id=12')],
}, { siteRoot: ROOT });
expect(queried.nodes[1]?.aem_path === `${ROOT}/page_id-12`, `a query page must be named from its query, got ${queried.nodes[1]?.aem_path}`);

refuses(() => buildSiteTree({ ...inventory, pages: [page('p-001', '/'), page('p-002', '/')] }, { siteRoot: ROOT }),
  'two pages on one path must be refused, not silently merged');

const summary = summarizeInventory({
  ...inventory,
  coverage: {
    pages_from_sitemap: 4, pages_from_links: 5, links_only: ['https://x.test/services/'], sitemap_only: [],
  },
  aliases: [{ url: 'https://x.test/clone/', alias_of: 'p-002', reason: 'same-content' }],
  excluded: [{ url: 'https://x.test/a/', reason: 'depth' }, { url: 'https://x.test/b/', reason: 'depth' }, { url: 'https://x.test/c/', reason: 'robots' }],
  excluded_total: 3,
  external_links: [{ host: 'www.facebook.com', links: 1, pages: 6 }],
  documents: [{ url: 'https://x.test/files/a.pdf' }],
  requests: { total: 12, by_host: { 'x.test': 12 } },
});
expect(summary.some((line) => line.includes('only reached by links: /services/')), 'the summary must name pages the sitemap missed');
expect(summary.some((line) => line.includes('excluded   3  (depth 2, robots 1)')), `exclusions must be counted by reason, got ${summary.join(' | ')}`);
expect(summary.some((line) => line.includes('www.facebook.com (6 pages)')), 'external hosts must be listed');

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('site tree assertions: all passed');
}
