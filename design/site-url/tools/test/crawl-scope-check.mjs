#!/usr/bin/env node
/**
 * Proof for the crawler's pure rules: which URLs count as the same site, how each one is
 * normalised, what is excluded and why, and how robots.txt, sitemaps and served HTML are read.
 * No network and no browser.
 *
 *   node design/site-url/tools/test/crawl-scope-check.mjs
 */
import process from 'node:process';

import {
  bodyText, detectChallenge, extractHtml, notFoundSignature, parseRobots, parseSitemap, robotsRules,
} from '../lib/crawl-parse.mjs';
import { createScope, globToRegExp, wwwTwin } from '../lib/url-scope.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// www and the bare domain are one site; nothing else is, including other subdomains.
expect(wwwTwin('www.example.test') === 'example.test', 'www host must pair with the bare domain');
expect(wwwTwin('example.test') === 'www.example.test', 'bare domain must pair with www');
expect(wwwTwin('localhost') === null && wwwTwin('127.0.0.1') === null, 'hosts without a domain have no twin');

const SEED = 'https://www.example.test/';
const scope = createScope({ seedUrl: SEED });
const classify = (href, base = SEED) => scope.classify(href, base);

const cases = [
  // [href, kind, url or reason]
  ['https://www.example.test/about-us/', 'page', 'https://www.example.test/about-us/'],
  ['https://example.test/about-us/', 'page', 'https://www.example.test/about-us/'],
  ['http://WWW.Example.TEST./about-us/?utm_source=x#team', 'page', 'https://www.example.test/about-us/'],
  ['//www.example.test/contact/', 'page', 'https://www.example.test/contact/'],
  ['/about-us/../careers/', 'page', 'https://www.example.test/careers/'],
  ['/index.php', 'page', 'https://www.example.test/'],
  ['/locations/store/?id=42', 'page', 'https://www.example.test/locations/store/'],
  ['https://careers.example.test/jobs', 'external', 'careers.example.test'],
  ['https://www.facebook.com/example', 'external', 'www.facebook.com'],
  ['https://www.example.test:8443/x', 'external', 'www.example.test:8443'],
  ['https://example.test.evil.test/', 'external', 'example.test.evil.test'],
  ['mailto:hello@example.test', 'ignored', 'mailto'],
  ['tel:+15550100', 'ignored', 'tel'],
  ['javascript:void(0)', 'ignored', 'javascript'],
  ['https://user:secret@www.example.test/', 'ignored', 'credentials'],
  ['/files/Report.PDF', 'document', 'pdf'],
  ['/wp-content/uploads/hero.jpg', 'document', 'jpg'],
  ['/wp-admin/', 'excluded', 'default:cms-admin'],
  ['/blog/feed/', 'excluded', 'default:feed'],
  ['/news/page/2/', 'excluded', 'default:pagination'],
  ['/my-account/orders/', 'excluded', 'default:account'],
  ['/account-management-services/', 'page', 'https://www.example.test/account-management-services/'],
  ['/a/b/c/d/e/', 'page', 'https://www.example.test/a/b/c/d/e/'],
  ['/a/b/c/d/e/f/', 'excluded', 'depth'],
];
for (const [href, kind, expected] of cases) {
  const result = classify(href);
  const actual = { page: result.url, external: result.host, ignored: result.reason, document: result.extension, excluded: result.reason }[kind];
  expect(result.kind === kind && actual === expected,
    `${href}: expected ${kind} ${expected}, got ${result.kind} ${result.url || result.host || result.reason || result.extension}`);
}

// Identity ignores trailing slashes and dropped queries, so one page is never queued twice.
expect(classify('/about-us').key === classify('/about-us/?ref=nav').key, 'trailing slash and query must not split a page');
expect(classify('/locations/store/?id=42').query_dropped === true, 'a dropped query must be reported');
expect(classify(SEED).depth === 0 && classify('/about-us/meet-the-team/leadership/').depth === 3, 'depth counts path segments');

// --keep-query keeps meaningful parameters in a stable order and still strips tracking ones.
const keeping = createScope({ seedUrl: SEED, keepQuery: true });
expect(keeping.classify('/?page_id=12&utm_source=x', SEED).url === 'https://www.example.test/?page_id=12',
  `tracking parameters must be stripped under --keep-query, got ${keeping.classify('/?page_id=12&utm_source=x', SEED).url}`);
expect(keeping.classify('/x/?b=2&a=1', SEED).url === 'https://www.example.test/x/?a=1&b=2', 'query parameters must be sorted');
expect(keeping.classify('/?s=dogs', SEED).reason === 'default:utility-query', 'search results are never pages');

// --include restricts, --exclude removes, and neither can remove the start page.
const narrowed = createScope({ seedUrl: SEED, include: ['/about-us/**'], exclude: ['/about-us/private/**'] });
expect(narrowed.classify('/about-us/', SEED).kind === 'page', '/about-us/** must include /about-us/ itself');
expect(narrowed.classify('/about-us/team/', SEED).kind === 'page', '/about-us/** must include its children');
expect(narrowed.classify('/careers/', SEED).reason === 'not-included', 'paths outside --include must be excluded');
expect(narrowed.classify('/about-us/private/x/', SEED).reason === 'exclude', '--exclude must win over --include');
expect(narrowed.classify(SEED).kind === 'page', 'the start page is always in scope');

// A start page below the root makes that section the site.
const section = createScope({ seedUrl: 'https://www.example.test/en/' });
expect(section.classify('/en/about/', 'https://www.example.test/en/').depth === 1, 'depth is measured below the start page');
expect(section.classify('/fr/about/', 'https://www.example.test/en/').reason === 'outside-start-path',
  'pages outside the start path have no place in the tree');

// --include-host widens the site to an explicitly named host, keeping its own host name.
const widened = createScope({ seedUrl: SEED, includeHosts: ['shop.example.test'] });
expect(widened.classify('https://shop.example.test/gift-cards/').kind === 'page', '--include-host must admit that host');
expect(widened.classify('https://careers.example.test/').kind === 'external', 'only the named host is admitted');

expect(globToRegExp('/events/*').test('/events/spring/'), '* must match one segment');
expect(!globToRegExp('/events/*').test('/events/spring/replay/'), '* must not cross segments');
expect(globToRegExp('**/team/**').test('/about-us/team/'), '** must cross segments');

// A real-world robots.txt, stray line included.
const strayRobots = parseRobots('#Any search crawler can crawl our site\nUser-agent: *\n#allow everything\nelse\nallow: /\n\nSitemap: https://example.test/sitemap.xml\n');
const strayRules = robotsRules(strayRobots);
expect(strayRules.allows('/about-us/') && strayRules.group === '*', 'an allow-all file must allow everything');
expect(strayRobots.sitemaps[0] === 'https://example.test/sitemap.xml', 'Sitemap lines must be collected');

const layered = robotsRules(parseRobots([
  'User-agent: *',
  'Disallow: /private/',
  'Allow: /private/public/',
  'Disallow: /*.pdf$',
  'Crawl-delay: 2',
].join('\n')));
expect(!layered.allows('/private/x'), 'Disallow must apply');
expect(layered.allows('/private/public/x'), 'the longest match must win');
expect(!layered.allows('/files/a.pdf') && layered.allows('/files/a.pdf?download=1'), '$ must anchor the end');
expect(layered.crawlDelaySeconds === 2, 'Crawl-delay must be read');
expect(layered.allows('/robots.txt'), 'robots.txt itself is always allowed');

const named = robotsRules(parseRobots('User-agent: aem-migration-crawler\nDisallow: /\n\nUser-agent: *\nAllow: /\n'));
expect(named.group === 'aem-migration-crawler' && !named.allows('/x'), 'a group naming the crawler must win over *');
expect(robotsRules(parseRobots('User-agent: *\nDisallow: /x\nAllow: /x\n')).allows('/x'), 'Allow must win a tie');
expect(robotsRules(parseRobots('User-agent: *\nDisallow:\n')).allows('/anything'), 'an empty Disallow allows everything');

const index = parseSitemap('<?xml version="1.0"?><sitemapindex><sitemap><loc> https://x.test/a.xml </loc></sitemap><sitemap><loc><![CDATA[https://x.test/b.xml]]></loc></sitemap></sitemapindex>');
expect(index.kind === 'sitemapindex' && index.locs.join() === 'https://x.test/a.xml,https://x.test/b.xml', `sitemap index, got ${JSON.stringify(index)}`);
const urlset = parseSitemap('<urlset><url><loc>https://x.test/?a=1&amp;b=2</loc><image:image><image:loc>https://x.test/i.png</image:loc></image:image></url></urlset>');
expect(urlset.kind === 'urlset' && urlset.locs.join() === 'https://x.test/?a=1&b=2', `urlset entities and image locs, got ${JSON.stringify(urlset)}`);
expect(parseSitemap('<html><body>Not found</body></html>').locs.length === 0, 'an HTML error page holds no sitemap entries');

const served = extractHtml([
  '<html lang="en-US"><head><title>About &amp; Team &#8211; Pets</title>',
  '<base href="/sub/"><link rel="canonical" href="https://x.test/about/">',
  '<link rel="stylesheet" href="/css/post-42.css"><link rel="shortlink" href="https://x.test/?p=42">',
  '<meta name="robots" content="noindex, follow"><meta name="description" content="Who we are &amp; what we do"></head><body class="page page-id-42">',
  '<a href="/a">A</a> <a href=\'b\'>B</a> <a href=c>C</a> <a data-href="/not-a-link">D</a> <a>no href</a>',
  '<map><area href="/d"></map><!-- <a href="/commented">x</a> -->',
  '<iframe src="https://form.example.test/123"></iframe><script src="https://form.example.test/embed.js"></script>',
  '<script>const html = \'<a href="/scripted">x</a>\';</script></body></html>',
].join(''));
expect(served.title === 'About & Team \u2013 Pets', `title entities must decode, got ${served.title}`);
expect(served.lang === 'en-US' && served.base === '/sub/' && served.canonical === 'https://x.test/about/', 'head facts must be read');
expect(served.robots === 'noindex, follow', 'the robots meta tag must be read');
expect(served.description === 'Who we are & what we do', `the meta description must be read, got ${served.description}`);
expect(served.links.join() === '/a,b,c,/d', `only real links may be read, got ${served.links.join()}`);
expect(served.body_class === 'page page-id-42', `the body class must be read, got ${served.body_class}`);
expect(['/css/post-42.css', 'https://x.test/?p=42', 'https://form.example.test/123', 'https://form.example.test/embed.js']
  .every((source) => served.resources.includes(source)), `embedded resources must be read, got ${served.resources.join()}`);
expect(bodyText('<head><title>T</title></head><body><p>Hello&nbsp;<b>world</b></p><script>x()</script></body>') === 'Hello world',
  'body text must drop the head, markup and scripts');
expect(bodyText('<body><p style="visibility:hidden">Revealed on scroll</p></body>') === 'Revealed on scroll',
  'body text must keep content a scroll animation still hides');

const missing = (path) => notFoundSignature({
  title: 'Page not found', html: `<body><p>Sorry, ${path} does not exist.</p></body>`, url: `https://x.test${path}`,
});
expect(missing('/one/') === missing('/two/'), 'a not-found page echoing the address must still match the probe');
expect(missing('/one/') !== notFoundSignature({ title: 'Page not found', html: '<body>Our story</body>', url: 'https://x.test/one/' }),
  'a real page must not match the probe');

expect(detectChallenge({ status: 403, headers: { 'cf-mitigated': 'challenge' } }) !== null, 'a Cloudflare challenge must be recognised');
expect(detectChallenge({ status: 503, title: 'Just a moment...', body: '' }) !== null, 'a challenge title on a refusal must be recognised');
expect(detectChallenge({ status: 200, title: 'Home', body: '<script src="/cdn-cgi/challenge-platform/x.js"></script>' }) === null,
  'an ordinary page carrying the challenge script is not a challenge');
expect(detectChallenge({ status: 404, title: 'Not found', body: 'challenge-platform' }) === null, 'a 404 is a 404, not a challenge');

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('crawl scope assertions: all passed');
}
