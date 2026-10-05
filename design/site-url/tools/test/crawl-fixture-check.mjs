#!/usr/bin/env node
/**
 * Preflight proof for the frozen site crawler: crawls a local two-host fixture and asserts which
 * pages it keeps, why it leaves the rest out, and that the second host, standing in for every
 * external site, never receives a single request.
 *
 *   node design/site-url/tools/test/crawl-fixture-check.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const crawlTool = path.join(path.dirname(here), 'crawl.mjs');
const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-fixture-'));

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const origins = { site: '', external: '' };
const page = (title, body) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;
const ABOUT = '<main><h1>About</h1><p>We look after pets.</p><a href="/about/team/">Team</a>'
  + ' <a href="/soft-missing/">Old link</a> <a href="/">Home</a></main>';
// Visible text is identical until the hidden section is scrolled into view, as with entrance animations.
const REVEALED = (text) => '<header><h1>Site name</h1></header>'
  + `<section style="visibility:hidden"><p>${text}</p></section><footer>Footer</footer>`;

function homePage() {
  return page('Home', [
    '<header><nav><a href="/about/">About</a> <a href="/services/">Services</a> <a href="/contact">Contact</a></nav></header>',
    '<main>',
    `<a href="${origins.external}/partner">Partner</a>`,
    '<a href="mailto:hello@example.test">Mail</a> <a href="tel:+15550100">Call</a>',
    '<a href="/files/brochure.pdf">Brochure</a> <a href="/wp-admin/">Admin</a> <a href="/leave/">Leave</a>',
    '<a href="/about/?utm_source=nav#team">About again</a> <a href="/clone/">Clone</a> <a href="/a/b/c/d/e/f/">Deep</a>',
    '<a href="/reveal-a/">Reveal A</a> <a href="/reveal-b/">Reveal B</a>',
    '<!-- <a href="/commented/">Commented</a> -->',
    '</main>',
    // Only a browser running this script ever sees the link it adds.
    "<script>document.addEventListener('DOMContentLoaded', () => { const link = document.createElement('a');"
      + " link.href = '/rendered-only/'; link.textContent = 'Rendered'; document.querySelector('nav').appendChild(link); });</script>",
  ].join(''));
}

function siteRoute(pathname) {
  const html = (body) => ({ type: 'text/html; charset=utf-8', body });
  const urlset = (locs) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
  switch (pathname) {
    case '/robots.txt':
      return {
        type: 'text/plain',
        body: ['# fixture', 'User-agent: *', 'Disallow: /private/', 'a stray line with no field',
          `Sitemap: ${origins.site}/sitemap_index.xml`, `Sitemap: ${origins.external}/sitemap.xml`].join('\n'),
      };
    case '/sitemap_index.xml':
      return {
        type: 'application/xml',
        body: `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origins.site}/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
      };
    case '/sitemap-pages.xml':
      return {
        type: 'application/xml',
        body: urlset([`${origins.site}/`, `${origins.site}/about/`, `${origins.site}/about/team/`, `${origins.site}/only-in-sitemap/`,
          `${origins.site}/private/secret/`, `${origins.external}/elsewhere/`, `${origins.site}/gone/`, `${origins.site}/files/brochure.pdf`]),
      };
    case '/': return html(homePage());
    case '/about/': return html(page('About', ABOUT));
    // The same page served at a second address: same title, same body.
    case '/clone/': return html(page('About', ABOUT));
    case '/reveal-a/': return html(page('Reveal', REVEALED('Grooming, boarding and daycare.')));
    case '/reveal-b/': return html(page('Reveal', REVEALED('Veterinary care and surgery.')));
    case '/about/team/': return html(page('Team', '<main><h1>Team</h1></main>'));
    case '/services/': return html(page('Services', '<main><h1>Services</h1><a href="/services/grooming/">Grooming</a></main>'));
    case '/services/grooming/': return html(page('Grooming', '<main><h1>Grooming</h1><p>Baths and trims.</p></main>'));
    case '/contact': return { status: 301, headers: { location: '/contact/' } };
    case '/contact/': return html(page('Contact', '<main><h1>Contact</h1></main>'));
    case '/rendered-only/': return html(page('Rendered', '<main><h1>Rendered</h1></main>'));
    case '/only-in-sitemap/': return html(page('Only in sitemap', '<main><h1>Unlinked</h1></main>'));
    case '/leave/': return { status: 302, headers: { location: `${origins.external}/landing` } };
    case '/gone/': return { status: 404, type: 'text/html', body: page('Gone', '<main>Gone</main>') };
    // Unknown addresses answer 200, the way a soft-404 site does, echoing the address asked for.
    default: return html(page('Page not found', `<main>Sorry, ${pathname} does not exist.</main>`));
  }
}

function serve(route) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    const answer = route(new URL(request.url, 'http://fixture').pathname);
    response.writeHead(answer.status || 200, { ...(answer.type ? { 'content-type': answer.type } : {}), ...answer.headers });
    response.end(answer.body || '');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

// The servers live in this process, so the crawler must run alongside them, never blocking them.
function crawl(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [crawlTool, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => child.kill(), 240000);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const site = await serve(siteRoute);
const external = await serve(() => ({ type: 'text/html', body: page('External', '<main>Elsewhere</main>') }));
origins.site = site.origin;
origins.external = external.origin;
const at = (pathname) => `${site.origin}${pathname}`;

const RUNS = [
  { id: 'rendered', args: [] },
  { id: 'served-html', args: ['--no-render'] },
  { id: 'capped', args: ['--no-render', '--max-pages', '3'] },
];

for (const run of RUNS) {
  site.requests.length = 0;
  external.requests.length = 0;
  const outDir = path.join(outRoot, run.id);
  const result = await crawl(['--url', site.origin, '--out', outDir, '--delay-ms', '0', '--run-id', `crawl-fixture-${run.id}`, ...run.args]);
  const artifactPath = path.join(outDir, 'inventory.json');
  if (!fs.existsSync(artifactPath)) {
    failures.push(`${run.id}: the crawl wrote no inventory (exit ${result.code})\n${result.output}`);
    continue;
  }
  const inventory = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const before = failures.length;
  const label = run.id;
  const pagePaths = inventory.pages.map((entry) => new URL(entry.url).pathname).sort();
  const reasons = Object.fromEntries(inventory.excluded.map((entry) => [entry.url, entry.reason]));

  expect(inventory.status === 'PASS', `${label}: the crawl must PASS, got ${inventory.status}: ${inventory.failures.join('; ')}`);
  expect(inventory.pages[0]?.id === 'p-001' && inventory.pages[0].url === at('/'), `${label}: the start page must be p-001`);
  expect(external.requests.length === 0, `${label}: the external host must never be requested, got ${external.requests.join(', ')}`);
  for (const never of ['/private/secret/', '/files/brochure.pdf', '/wp-admin/', '/a/b/c/d/e/f/', '/commented/']) {
    expect(!site.requests.includes(never), `${label}: ${never} must never be requested`);
  }
  expect(!site.requests.some((entry) => entry.includes('utm_source')), `${label}: tracking parameters must never be requested`);

  if (run.id === 'capped') {
    expect(inventory.pages.length === 3, `${label}: --max-pages 3 must keep 3 pages, got ${inventory.pages.length}`);
    expect(reasons[at('/services/')] === 'over-cap', `${label}: pages beyond the cap must be listed as over-cap, got ${reasons[at('/services/')]}`);
    expect(!site.requests.includes('/services/'), `${label}: a page beyond the cap must never be requested`);
  } else {
    const expected = ['/', '/about/', '/about/team/', '/contact/', '/only-in-sitemap/', '/reveal-a/', '/reveal-b/', '/services/',
      '/services/grooming/', ...(run.id === 'rendered' ? ['/rendered-only/'] : [])].sort();
    expect(JSON.stringify(pagePaths) === JSON.stringify(expected), `${label}: pages ${pagePaths.join(', ')}; expected ${expected.join(', ')}`);
    const want = {
      [at('/private/secret/')]: 'robots',
      [`${external.origin}/elsewhere/`]: 'external-host',
      [at('/gone/')]: 'http-404',
      [at('/leave/')]: 'external-redirect',
      [at('/wp-admin/')]: 'default:cms-admin',
      [at('/a/b/c/d/e/f/')]: 'depth',
      [at('/soft-missing/')]: 'soft-404',
    };
    for (const [url, reason] of Object.entries(want)) {
      expect(reasons[url] === reason, `${label}: ${url} must be excluded as ${reason}, got ${reasons[url] ?? 'not excluded'}`);
    }
    const about = inventory.pages.find((entry) => entry.url === at('/about/'));
    const clone = inventory.aliases.find((entry) => entry.url === at('/clone/'));
    expect(clone?.reason === 'same-content' && clone.alias_of === about?.id, `${label}: /clone/ must be an alias of /about/, got ${JSON.stringify(clone)}`);
    const contact = inventory.pages.find((entry) => entry.url === at('/contact/'));
    expect(contact?.requested_url === at('/contact') && contact.redirects?.length === 1,
      `${label}: /contact must be followed to /contact/, got ${JSON.stringify(contact)}`);
    const partner = inventory.external_links.find((entry) => entry.host === new URL(external.origin).host);
    expect(partner?.links === 1 && partner.found_on.includes('p-001'), `${label}: the external link must be recorded, got ${JSON.stringify(partner)}`);
    expect(inventory.documents.some((entry) => entry.url === at('/files/brochure.pdf')), `${label}: the brochure must be listed as a document`);
    expect(inventory.ignored.mailto === 1 && inventory.ignored.tel === 1, `${label}: mailto and tel links must be counted, got ${JSON.stringify(inventory.ignored)}`);
    expect(JSON.stringify(inventory.coverage.sitemap_only) === JSON.stringify([at('/only-in-sitemap/')]),
      `${label}: only /only-in-sitemap/ is unlinked, got ${inventory.coverage.sitemap_only.join(', ')}`);
    expect(inventory.link_order.slice(0, 3).join() === [at('/about'), at('/services'), at('/contact')].join(),
      `${label}: link order must follow the start page, got ${inventory.link_order.slice(0, 3).join(', ')}`);
    expect(inventory.sitemaps.some((entry) => entry.url === `${external.origin}/sitemap.xml` && entry.skipped),
      `${label}: a sitemap on another host must be skipped`);
    // The browser may ask for a favicon on its own; only the crawler's own requests are counted.
    const served = site.requests.filter((entry) => entry !== '/favicon.ico');
    expect(inventory.requests.total === served.length, `${label}: every request must be counted, `
      + `counted ${inventory.requests.total}, served ${served.length}`);
  }

  console.log(`  ${failures.length === before ? 'PASS' : 'FAIL'}  ${label.padEnd(12)} pages ${inventory.pages.length}`
    + `  excluded ${inventory.excluded_total}  aliases ${inventory.aliases.length}  site requests ${site.requests.length}`
    + `  external requests ${external.requests.length}`);
}

site.server.close();
external.server.close();

console.log('\nCrawl fixture assertions');
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed. Evidence: ${outRoot}`);
  process.exitCode = 1;
} else {
  console.log('  all assertions passed');
  console.log(`\nEvidence: ${outRoot}`);
}
