/**
 * Proof for the page writer: which template and container a site uses, what every empty page carries,
 * how placeholders, sibling order and digit-led names are written, that stale pages are removed while
 * a page's own content is kept, how source addresses map to AEM paths, and how AEM's answers are read.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { buildSiteTree } from './inventory.mjs';
import { findPath, getAttribute, parseJcrXml } from './jcr-xml.mjs';
import {
  CONTENT_ROOT, linkMap, resolveTemplate, toJcrLanguage, verifyPages, writeLinkMap, writeSitePages, xmlName,
} from './pages.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const refuses = (action, why) => {
  let threw = false;
  try {
    action();
  } catch {
    threw = true;
  }
  expect(threw, why);
};

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-check-'));
const write = (relativePath, text) => {
  const file = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
};
const jcrFile = (jcrPath) => path.join(repoRoot, CONTENT_ROOT, ...jcrPath.split('/').filter(Boolean), '.content.xml');
const content = (jcrPath) => findPath(parseJcrXml(fs.readFileSync(jcrFile(jcrPath), 'utf8')).root, ['jcr:content']);
const NS = 'xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"';
const TEMPLATE = '/conf/demo/settings/wcm/templates/page-content';

// The archetype layout: a parent page naming its template, and that template's structure and initial content.
write(`${CONTENT_ROOT}/content/demo/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page">
    <jcr:content cq:template="${TEMPLATE}" jcr:primaryType="cq:PageContent" sling:resourceType="demo/components/page"/>
</jcr:root>
`);
write(`${CONTENT_ROOT}${TEMPLATE}/structure/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page">
    <jcr:content cq:template="${TEMPLATE}" jcr:primaryType="cq:PageContent" sling:resourceType="demo/components/page">
        <root jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid">
            <header jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/experiencefragment"/>
            <container jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid">
                <title jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/title" editable="{Boolean}true"/>
                <container jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" editable="{Boolean}true" layout="responsiveGrid"/>
            </container>
        </root>
    </jcr:content>
</jcr:root>
`);
write(`${CONTENT_ROOT}${TEMPLATE}/initial/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page">
    <jcr:content cq:template="${TEMPLATE}" jcr:primaryType="cq:PageContent" sling:resourceType="demo/components/page">
        <root jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid">
            <container jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid">
                <title jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/title"/>
                <container jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid"/>
            </container>
        </root>
    </jcr:content>
</jcr:root>
`);

expect(xmlName('2024-report') === '_x0032_024-report' && xmlName('about') === 'about', 'a digit-led name must be ISO 9075 encoded');
expect(toJcrLanguage('en-US') === 'en_US' && toJcrLanguage('en') === 'en' && toJcrLanguage('zh-Hant-TW') === 'zh_TW',
  'languages must be stored the way AEM stores them');
expect(toJcrLanguage('') === null && toJcrLanguage('x-klingon') === null, 'an unusable language is not stored');

const SITE = '/content/demo/site';
const template = resolveTemplate({ repoRoot, siteRoot: SITE });
expect(template.path === TEMPLATE, `the template must come from the nearest ancestor page, got ${template.path}`);
expect(template.container === 'root/container/container', `components go in the last editable layout container, got ${template.container}`);
expect(resolveTemplate({ repoRoot, siteRoot: SITE, template: TEMPLATE }).path === TEMPLATE, 'a named template must be used');
refuses(() => resolveTemplate({ repoRoot, siteRoot: '/content/elsewhere/site' }), 'a site with no ancestor page needs --template');
refuses(() => resolveTemplate({ repoRoot, siteRoot: SITE, template: '/conf/demo/settings/wcm/templates/missing' }),
  'a template that is not in the repository must be refused');

const page = (id, pathname, extra = {}) => ({
  id, url: `https://x.test${pathname}`, key: `https://x.test${pathname.replace(/\/$/, '') || '/'}`, sitemap_index: null, ...extra,
});
const inventory = {
  fingerprint: 'sha256:fixture',
  scope: { seed_path_prefix: '' },
  link_order: [],
  pages: [
    page('p-001', '/', { title: 'Home | X', description: 'Welcome & more', lang: 'en-US' }),
    page('p-002', '/about-us/', { title: 'About us | X', lang: 'en-US' }),
    page('p-003', '/about-us/meet-the-team/leadership/', { title: 'Leadership | X', noindex: true }),
    page('p-004', '/2024-report/', { title: 'Annual report', lang: 'fr-FR' }),
  ],
  aliases: [{ url: 'https://x.test/home', key: 'https://x.test/home', alias_of: 'p-001', reason: 'redirect' }],
};
const tree = buildSiteTree(inventory, { siteRoot: SITE });

// Left by an earlier, larger crawl, and a page's own binary content, which is not a page.
write(`${CONTENT_ROOT}${SITE}/old-page/.content.xml`, '<jcr:root/>');
write(`${CONTENT_ROOT}${SITE}/about-us/_jcr_content/image/.content.xml`, '<jcr:root/>');

const first = writeSitePages({
  repoRoot, tree, inventory, template,
});
expect(first.written.length === tree.nodes.length, `one file per tree node, got ${first.written.length} for ${tree.nodes.length}`);
expect(first.removed.length === 1 && first.removed[0].endsWith('/site/old-page'), `a stale page must be removed, got ${first.removed.join(', ')}`);
expect(fs.existsSync(path.join(repoRoot, CONTENT_ROOT, 'content/demo/site/about-us/_jcr_content/image/.content.xml')),
  "a page's own content folder must be kept");

const root = content(SITE);
expect(getAttribute(root, 'jcr:title') === 'Home | X', 'the source title must be the page title');
expect(getAttribute(root, 'jcr:description') === 'Welcome &amp; more', `the description must be carried and escaped, got ${getAttribute(root, 'jcr:description')}`);
expect(getAttribute(root, 'jcr:language') === 'en_US', 'the root must carry the site language');
expect(getAttribute(root, 'cq:template') === TEMPLATE && getAttribute(root, 'sling:resourceType') === 'demo/components/page',
  'the template and page component come from the initial content');
expect(findPath(root, ['root', 'container', 'container']), 'every page must have the container components go into');
const rootDocument = parseJcrXml(fs.readFileSync(jcrFile(SITE), 'utf8')).root;
expect(rootDocument.children.map((child) => child.name).join() === 'jcr:content,about-us,_x0032_024-report',
  `child pages must be listed in tree order, got ${rootDocument.children.map((child) => child.name).join()}`);

const placeholder = content(`${SITE}/about-us/meet-the-team`);
expect(getAttribute(placeholder, 'hideInNav') === '{Boolean}true'
  && getAttribute(placeholder, 'cq:redirectTarget') === `${SITE}/about-us/meet-the-team/leadership`
  && getAttribute(placeholder, 'jcr:title') === 'Meet The Team', 'a missing parent must be a hidden redirect to its first child');
const leadership = content(`${SITE}/about-us/meet-the-team/leadership`);
expect(getAttribute(leadership, 'cq:robotsTags') === '[noindex]', 'a noindex page must keep noindex');
expect(getAttribute(leadership, 'jcr:language') === null, 'a page in the site language inherits it');
expect(getAttribute(content(`${SITE}/2024-report`), 'jcr:language') === 'fr_FR', 'a page in another language keeps its own');

const before = first.written.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8'));
const second = writeSitePages({
  repoRoot, tree, inventory, template,
});
expect(second.written.every((file, index) => fs.readFileSync(path.join(repoRoot, file), 'utf8') === before[index]) && !second.removed.length,
  'writing the same tree twice must produce the same files and remove nothing');

const links = linkMap(inventory, tree);
expect(links.find((entry) => entry.source_url === 'https://x.test/home')?.aem_path === SITE, 'an alias must map to the page it is an alias of');
expect(links.find((entry) => entry.page_id === 'p-003')?.aem_path === `${SITE}/about-us/meet-the-team/leadership`, 'pages map to their AEM path');
const mapDir = path.join(repoRoot, 'evidence');
const files = writeLinkMap(mapDir, [...links, {
  key: 'k', source_url: 'https://x.test/a,b', aem_path: `${SITE}/a-b`, page_id: 'p-009', kind: 'page',
}]);
const csv = fs.readFileSync(files.csv, 'utf8').split('\n');
expect(csv[0] === 'source_url,aem_path' && csv.includes(`"https://x.test/a,b",${SITE}/a-b`), 'the CSV must quote values holding a comma');

const answers = new Map([
  [`${SITE}.html`, { status: 200, title: 'Home | X' }],
  [`${SITE}/about-us.html`, { status: 200, title: 'About us | X | Brand' }],
  [`${SITE}/about-us/meet-the-team.html`, { status: 302 }],
  [`${SITE}/about-us/meet-the-team/leadership.html`, { status: 200, title: 'Something else' }],
]);
const verification = await verifyPages({
  aemUrl: 'http://localhost:4502',
  tree,
  inventory,
  password: 'admin',
  fetchFn: async (url, init) => {
    expect(init.headers.authorization.startsWith('Basic '), 'AEM must be asked with credentials');
    const { pathname } = new URL(url);
    if (pathname.endsWith('2024-report.html')) throw new Error('ECONNRESET');
    const answer = answers.get(pathname) || { status: 404 };
    return { status: answer.status, text: async () => `<html><head><title>${answer.title || ''}</title></head></html>` };
  },
});
const verdict = (aemPath) => verification.results.find((entry) => entry.aem_path === aemPath);
expect(verdict(SITE).ok && verdict(`${SITE}/about-us`).ok, 'a page answering 200 with its title, brand suffix or not, passes');
expect(verdict(`${SITE}/about-us/meet-the-team`).ok, 'a placeholder answering with its redirect passes');
expect(!verdict(`${SITE}/about-us/meet-the-team/leadership`).ok, 'a page answering with another title fails');
expect(!verdict(`${SITE}/2024-report`).ok && verdict(`${SITE}/2024-report`).detail.startsWith('unreachable'), 'an unreachable page fails');
expect(verification.status === 'FAIL' && verification.failed === 2, `two pages must fail, got ${verification.failed}`);

fs.rmSync(repoRoot, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('page writer assertions: all passed');
}
