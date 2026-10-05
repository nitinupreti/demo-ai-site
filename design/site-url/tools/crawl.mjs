#!/usr/bin/env node
/**
 * Frozen deterministic site inventory for the AEM migration pipeline: which pages of one site exist,
 * and which links leave it. Only the site itself is ever requested; an external link is recorded and
 * never followed, not even through a redirect.
 *
 *   node design/site-url/tools/crawl.mjs --url <site-root> --out <dir> [--max-pages 50] [--max-depth 5]
 *
 * No agent may hand-write, edit or estimate the output of this tool.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { TOOL_VERSION } from './lib/contracts.mjs';
import {
  ROBOTS_AGENT, bodyText, detectChallenge, extractHtml, notFoundSignature, parseRobots, parseSitemap, robotsRules,
} from './lib/crawl-parse.mjs';
import { createScope } from './lib/url-scope.mjs';
import {
  ensureDir, parseArgs, relativePath, sha256, toolDependencies, writeJson,
} from './lib/util.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

const USER_AGENT = `Mozilla/5.0 (compatible; ${ROBOTS_AGENT}/${TOOL_VERSION})`;
const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1';
// Two requests in flight is the politeness ceiling; the delay paces when each one may start.
const CONCURRENCY = 2;
const MAX_REDIRECTS = 10;
const REQUEST_TIMEOUT_MS = 30000;
const RENDER_TIMEOUT_MS = 45000;
// Menus are built long before the network goes quiet, and analytics never let it go quiet.
const RENDER_IDLE_MS = 5000;
const RENDER_WIDTH = 1440;
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_SITEMAPS = 50;
const MAX_RETRY_AFTER_SECONDS = 60;
const SAMPLE_LIMIT = 5;
const LIST_LIMIT = 1000;
// At least this many challenges, and more than half of everything fetched, is a site refusing the crawl.
const BOT_WALL_MIN = 3;
const PROBE_PATH = '/__aem-migration-crawler-404-probe__/';
const HTML_TYPE = /^\s*(text\/html|application\/xhtml\+xml)/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Pictures, media and fonts never carry a link, so the site is not asked for them.
const SKIPPED_RESOURCES = new Set(['image', 'media', 'font']);
const SOURCE_ORDER = ['seed', 'sitemap', 'link', 'canonical', 'redirect'];

function usage() {
  console.log(`
crawl.mjs - deterministic site inventory

  --url <url>             Start page, normally the site root (required)
  --out <dir>             Output directory (required)
  --run-id <id>           Run identifier recorded in the artifact
  --max-pages <n>         Pages to keep, the start page included (default 50)
  --max-depth <n>         Deepest path to keep, in segments below the start page (default 5)
  --include <globs>       Comma-separated path globs; only matching pages are kept
  --exclude <globs>       Comma-separated path globs; matching pages are never requested
  --include-host <hosts>  Comma-separated extra hosts that count as the same site
  --keep-query            Treat URLs that differ only by query string as different pages
  --delay-ms <n>          Pause between request starts (default 500; robots.txt Crawl-delay may raise it)
  --no-render             Read links from the served HTML only, without running the page's scripts
  --headed                Run Chromium headed
  --help
`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function listOption(value) {
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function integerOption(value, name, { min, max }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}, not "${value}".`);
  }
  return number;
}

function pathAndQuery(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function retryAfterSeconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : null;
}

function decodeBody(buffer, contentType) {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1] || 'utf-8';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function gunzipIfNeeded(buffer) {
  if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) return buffer;
  try {
    return zlib.gunzipSync(buffer, { maxOutputLength: 50 * 1024 * 1024 });
  } catch {
    return Buffer.alloc(0);
  }
}

/** `undefined` when the body was not wanted, `null` when it was too large to keep. */
async function readBody(response) {
  if (!response.body) return Buffer.alloc(0);
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
    await response.body.cancel();
    return null;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function createClient({ isSiteUrl, delayMs }) {
  let delay = delayMs;
  let nextStart = 0;
  let total = 0;
  const byHost = {};

  async function pace() {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + delay;
    if (wait) await sleep(wait);
  }

  function count(url) {
    const { host } = new URL(url);
    byHost[host] = (byHost[host] || 0) + 1;
    total += 1;
  }

  async function get(url, { accept, read }) {
    // The crawl's one promise: nothing outside the site is ever requested.
    if (!isSiteUrl(url)) throw new Error(`refusing to request ${url}: it is not part of the site`);
    for (let attempt = 1; ; attempt += 1) {
      await pace();
      count(url);
      let response;
      try {
        response = await fetch(url, {
          redirect: 'manual',
          headers: { 'user-agent': USER_AGENT, accept },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        return {
          error: error?.cause?.code || error?.name || 'fetch-error',
          detail: String(error?.cause?.message || error?.message || error),
        };
      }
      const wait = retryAfterSeconds(response.headers.get('retry-after'));
      if (attempt === 1 && [429, 503].includes(response.status) && wait !== null && wait <= MAX_RETRY_AFTER_SECONDS) {
        await response.body?.cancel();
        await sleep(wait * 1000);
        continue;
      }
      const type = response.headers.get('content-type') || '';
      const wanted = !REDIRECT_STATUSES.has(response.status) && (read === 'any' || !type || HTML_TYPE.test(type));
      if (!wanted) {
        await response.body?.cancel();
        return { status: response.status, headers: response.headers, type, body: undefined };
      }
      return { status: response.status, headers: response.headers, type, body: await readBody(response) };
    }
  }

  return {
    get,
    pace,
    count,
    setDelay(ms) { delay = ms; },
    get delay() { return delay; },
    requests: () => ({ total, by_host: { ...byHost } }),
  };
}

/** Follows redirects one hop at a time; `nextHop` decides whether a hop may be requested at all. */
async function follow(client, startUrl, { accept, read, nextHop }) {
  const redirects = [];
  let current = startUrl;
  for (;;) {
    const response = await client.get(current, { accept, read });
    if (response.error) {
      return { outcome: 'fetch-error', detail: `${response.error}: ${response.detail}`, redirects, url: current };
    }
    const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get('location') : null;
    if (!location) return { outcome: 'response', response, redirects, url: current };
    if (redirects.length >= MAX_REDIRECTS) return { outcome: 'too-many-redirects', redirects, url: current };
    const hop = nextHop(location, current);
    redirects.push({ from: current, status: response.status, to: hop.url || location });
    if (hop.stop) return { outcome: hop.stop, detail: hop.detail, redirects, url: current };
    if (hop.url === current || redirects.some((entry) => entry.from === hop.url)) {
      return { outcome: 'redirect-loop', redirects, url: current };
    }
    current = hop.url;
  }
}

/** robots.txt, sitemaps and the start page: any address on the site, exactly as given. */
function resourceHop(scope) {
  return (location, from) => {
    let target;
    try {
      target = new URL(location, from).href;
    } catch {
      return { stop: 'bad-redirect', detail: location };
    }
    return scope.isSiteUrl(target) ? { url: target } : { stop: 'external-redirect', detail: new URL(target).host, url: target };
  };
}

/** A page may only redirect to another address that would itself have been crawled. */
function pageHop(scope, rules) {
  return (location, from) => {
    const target = scope.classify(location, from);
    if (target.kind === 'external') return { stop: 'external-redirect', detail: target.host, url: target.url };
    if (target.kind === 'ignored') return { stop: 'bad-redirect', detail: target.reason };
    if (target.kind === 'document') return { stop: 'not-html', detail: target.extension, url: target.url };
    if (target.kind === 'excluded') return { stop: 'excluded-redirect', detail: target.reason, url: target.url };
    if (!rules.allows(pathAndQuery(target.url))) return { stop: 'robots', detail: 'redirect target', url: target.url };
    return { url: target.url };
  };
}

function seedHop(scope, rules) {
  const onSite = resourceHop(scope);
  return (location, from) => {
    const hop = onSite(location, from);
    if (hop.stop || rules.allows(pathAndQuery(hop.url))) return hop;
    return { stop: 'robots', detail: 'redirect target', url: hop.url };
  };
}

async function loadRobots(client, scope, origin) {
  const url = `${origin}/robots.txt`;
  const fetched = await follow(client, url, { accept: 'text/plain,*/*;q=0.1', read: 'any', nextHop: resourceHop(scope) });
  const status = fetched.response?.status ?? null;
  // Unreachable means "disallow everything"; missing means "allow everything" (RFC 9309, 2.3.1).
  if (['fetch-error', 'too-many-redirects', 'redirect-loop'].includes(fetched.outcome) || status === 429 || status >= 500) {
    return {
      record: { url, status, outcome: fetched.outcome },
      blocked: `robots.txt at ${url} could not be read (${status ?? fetched.outcome}${fetched.detail ? `: ${fetched.detail}` : ''});`
        + ' RFC 9309 treats that as "disallow everything"',
    };
  }
  if (fetched.outcome !== 'response' || status !== 200 || !fetched.response.body) {
    return { record: { url, status, absent: true }, parsed: parseRobots('') };
  }
  return { record: { url, status }, parsed: parseRobots(decodeBody(fetched.response.body, fetched.response.type)) };
}

async function loadSitemaps(client, scope, rules, urls) {
  const records = [];
  const locs = [];
  const seen = new Set();
  const pending = [...urls];
  const tried = new Set();
  while (pending.length && tried.size < MAX_SITEMAPS) {
    const url = pending.shift();
    if (tried.has(url)) continue;
    tried.add(url);
    if (!scope.isSiteUrl(url)) {
      records.push({ url, skipped: 'not on the site' });
      continue;
    }
    if (!rules.allows(pathAndQuery(url))) {
      records.push({ url, skipped: 'robots' });
      continue;
    }
    const fetched = await follow(client, url, {
      accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1', read: 'any', nextHop: resourceHop(scope),
    });
    const status = fetched.response?.status ?? null;
    if (fetched.outcome !== 'response' || status !== 200 || !fetched.response.body) {
      records.push({ url, status, outcome: fetched.outcome });
      continue;
    }
    const parsed = parseSitemap(gunzipIfNeeded(fetched.response.body).toString('utf8'));
    records.push({ url, status, kind: parsed.kind, urls: parsed.locs.length });
    if (parsed.kind === 'sitemapindex') {
      pending.push(...parsed.locs);
      continue;
    }
    for (const loc of parsed.locs) {
      if (seen.has(loc)) continue;
      seen.add(loc);
      locs.push(loc);
    }
  }
  return { records, locs };
}

/** Runs in the page: every link the live DOM holds, including those scripts added. */
function collectRendered() {
  const hrefOf = (node) => {
    try {
      // An SVG link exposes an animated string, not a resolved URL.
      return typeof node.href === 'string' ? node.href : new URL(node.href.baseVal, document.baseURI).href;
    } catch {
      return null;
    }
  };
  // innerText skips content a scroll animation still hides, so the text is read from a copy instead.
  const copy = document.body ? document.body.cloneNode(true) : null;
  copy?.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
  return {
    url: window.location.href,
    title: document.title,
    description: document.querySelector('meta[name="description" i]')?.content || null,
    lang: document.documentElement.lang || null,
    canonical: document.querySelector('link[rel~="canonical"]')?.href || null,
    text: (copy?.textContent || '').replace(/\s+/g, ' ').trim(),
    links: Array.from(document.querySelectorAll('a[href], area[href]'), hrefOf).filter(Boolean),
  };
}

async function openRenderer({ headed, client, isSiteUrl }) {
  const { createPage, launchBrowser } = await import('./lib/browser.mjs');
  const browser = await launchBrowser({ headless: !headed });
  return {
    async render(url) {
      await client.pace();
      client.count(url);
      let page = null;
      try {
        page = await createPage(browser, { width: RENDER_WIDTH });
        await page.route('**/*', async (route) => {
          const request = route.request();
          // A script may try to navigate anywhere; only the site's own documents are ever loaded.
          const refused = SKIPPED_RESOURCES.has(request.resourceType())
            || (request.isNavigationRequest() && !isSiteUrl(request.url()));
          try {
            await (refused ? route.abort() : route.continue());
          } catch { /* the page closed while the request was in flight */ }
        });
        await page.goto(url, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: RENDER_IDLE_MS }).catch(() => {});
        const collected = await page.evaluate(collectRendered);
        if (!isSiteUrl(collected.url)) return { error: `the page navigated off the site to ${collected.url}` };
        return collected;
      } catch (error) {
        return { error: String(error?.message || error).split('\n')[0] };
      } finally {
        await page?.context().close().catch(() => {});
      }
    },
    close: () => browser.close(),
  };
}

async function crawl(seedInput, settings, { runId, headed }) {
  const startedAt = Date.now();
  const failures = [];
  const scopeOptions = {
    includeHosts: settings.includeHosts,
    include: settings.include,
    exclude: settings.exclude,
    maxDepth: settings.maxDepth,
    keepQuery: settings.keepQuery,
  };
  let scope = createScope({ seedUrl: seedInput, ...scopeOptions });
  const client = createClient({ isSiteUrl: (url) => scope.isSiteUrl(url), delayMs: settings.delayMs });
  const report = (line) => process.stdout.write(`  ${line}\n`);
  const shortUrl = (url) => (url.startsWith(scope.canonicalOrigin) ? url.slice(scope.canonicalOrigin.length) || '/' : url);

  const known = new Map();
  const queue = [];
  const ruled = new Map();
  const externalHosts = new Map();
  const documents = new Map();
  const ignored = {};
  const pages = [];
  const aliases = [];
  const contentOwners = new Map();
  let sitemapLocs = [];
  let linkOrder = [];
  let sequence = 0;
  let botWalls = 0;
  let visited = 0;
  let robots = null;
  let probeSignature = null;

  const artifact = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    tool: {
      name: 'crawl.mjs',
      version: TOOL_VERSION,
      dependencies: toolDependencies(toolRoot),
      source_sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
      user_agent: USER_AGENT,
    },
    seed: { requested_url: seedInput, final_url: null, http_status: null, redirects: [] },
    scope: null,
    robots: null,
    sitemaps: [],
    soft_404_probe: null,
    pages: [],
    aliases: [],
    excluded: [],
    excluded_total: 0,
    external_links: [],
    documents: [],
    ignored: {},
    link_order: [],
    coverage: null,
    requests: null,
    fingerprint: '',
    status: 'FAIL',
    failures,
    duration_seconds: 0,
  };

  const remember = (list, value) => {
    if (value && !list.includes(value) && list.length < SAMPLE_LIMIT) list.push(value);
  };
  const record = (fields) => {
    sequence += 1;
    return {
      seq: sequence, sources: new Set(), found_on: [], inbound: 0, ...fields,
    };
  };
  const linkedFrom = (entry, source, from) => {
    entry.sources.add(source);
    if (!from || from === entry) return;
    entry.inbound += 1;
    remember(entry.found_on, from.id);
  };
  const ownerOf = (entry) => {
    let current = entry;
    const seen = new Set();
    while (current?.status === 'alias' && !seen.has(current)) {
      seen.add(current);
      current = current.alias;
    }
    return current;
  };

  function ruleOut(target, source, from) {
    const id = target.key || target.url;
    if (!ruled.has(id)) ruled.set(id, record({ url: target.url, reason: target.reason }));
    linkedFrom(ruled.get(id), source, from);
  }

  /** Files every href under the one bucket it belongs in. Only pages are ever queued. */
  function admit(target, { source, from = null, sitemapIndex = null }) {
    if (target.kind === 'page') {
      if (!robots.rules.allows(pathAndQuery(target.url))) {
        ruleOut({ ...target, reason: 'robots' }, source, from);
        return null;
      }
      let entry = known.get(target.key);
      if (!entry) {
        entry = record({
          key: target.key, url: target.url, depth: target.depth, status: 'queued', sitemap_index: null,
        });
        known.set(target.key, entry);
        queue.push(entry);
      }
      if (sitemapIndex !== null && entry.sitemap_index === null) entry.sitemap_index = sitemapIndex;
      linkedFrom(entry, source, from);
      return entry;
    }
    if (target.kind === 'external') {
      // A sitemap entry on another host is a page this crawl will never own.
      if (source === 'sitemap') {
        ruleOut({ ...target, reason: 'external-host' }, source, from);
        return null;
      }
      if (!externalHosts.has(target.host)) {
        externalHosts.set(target.host, {
          host: target.host, urls: new Set(), pages: new Set(), samples: [], found_on: [],
        });
      }
      const host = externalHosts.get(target.host);
      host.urls.add(target.url);
      if (host.samples.length < 3 && !host.samples.includes(target.url)) host.samples.push(target.url);
      if (from) {
        host.pages.add(from.id);
        remember(host.found_on, from.id);
      }
      return null;
    }
    if (target.kind === 'document') {
      if (!documents.has(target.key)) documents.set(target.key, record({ url: target.url, extension: target.extension }));
      linkedFrom(documents.get(target.key), source, from);
      return null;
    }
    if (target.kind === 'excluded') {
      ruleOut(target, source, from);
      return null;
    }
    ignored[target.reason] = (ignored[target.reason] || 0) + 1;
    return null;
  }

  async function visit(entry) {
    const fetched = entry.prefetched
      ?? await follow(client, entry.url, { accept: HTML_ACCEPT, read: 'html', nextHop: pageHop(scope, robots.rules) });
    delete entry.prefetched;
    const outcome = { entry, requested: entry.url, redirects: fetched.redirects };
    if (fetched.outcome !== 'response') return { ...outcome, outcome: fetched.outcome, detail: fetched.detail };
    const { response } = fetched;
    const html = response.body ? decodeBody(response.body, response.type) : '';
    const raw = extractHtml(html);
    const challenge = detectChallenge({
      status: response.status, headers: response.headers, title: raw.title, body: html,
    });
    if (challenge) return { ...outcome, outcome: 'bot-wall', detail: challenge };
    if (response.status !== 200) return { ...outcome, outcome: `http-${response.status}` };
    if (response.body === undefined) {
      return { ...outcome, outcome: 'not-html', detail: response.type.split(';')[0].trim() || 'unknown' };
    }
    if (response.body === null) return { ...outcome, outcome: 'too-large' };
    if (probeSignature && notFoundSignature({ title: raw.title, html, url: fetched.url }) === probeSignature) {
      return { ...outcome, outcome: 'soft-404' };
    }
    const rendered = renderer ? await renderer.render(fetched.url) : null;
    return {
      ...outcome, outcome: 'page', url: fetched.url, response, html, raw, rendered,
    };
  }

  function apply(result) {
    const { entry } = result;
    visited += 1;
    if (result.outcome === 'bot-wall') botWalls += 1;
    if (result.outcome !== 'page') {
      Object.assign(entry, {
        status: 'excluded', reason: result.outcome, detail: result.detail ?? null, redirects: result.redirects,
      });
      report(`----   ${result.outcome.padEnd(18)} ${shortUrl(entry.url)}${result.detail ? `  (${result.detail})` : ''}`);
      return;
    }

    const final = scope.classify(result.url);
    if (final.kind !== 'page') {
      Object.assign(entry, { status: 'excluded', reason: `redirect-to-${final.kind}`, redirects: result.redirects });
      return;
    }
    // A redirect lands on the page that really exists; the address that was asked for is its alias.
    let owner = entry;
    if (final.key !== entry.key) {
      const existing = known.get(final.key);
      Object.assign(entry, { status: 'alias', alias: existing, reason: 'redirect' });
      aliases.push(entry);
      // Settled, or being fetched right now: its own visit decides it.
      if (existing && existing.status !== 'queued') {
        existing.sources.add('redirect');
        report(`----   alias              ${shortUrl(entry.url)} -> ${shortUrl(existing.url)}`);
        return;
      }
      owner = existing || record({
        key: final.key, url: final.url, depth: final.depth, sitemap_index: null,
      });
      known.set(final.key, owner);
      entry.alias = owner;
      owner.sources.add('redirect');
    }
    owner.url = final.url;

    const rendered = result.rendered && !result.rendered.error ? result.rendered : null;
    const rawBase = (() => {
      try {
        return result.raw.base ? new URL(result.raw.base, result.url).href : result.url;
      } catch {
        return result.url;
      }
    })();
    // Rendered links first, in DOM order, so menus built by scripts keep their place.
    const hrefs = [
      ...(rendered ? rendered.links.map((href) => [href, result.url]) : []),
      ...result.raw.links.map((href) => [href, rawBase]),
    ];
    const targets = new Map();
    for (const [href, base] of hrefs) {
      const target = scope.classify(href, base);
      const identity = target.key || target.url || `${target.kind}:${href}`;
      if (!targets.has(identity)) targets.set(identity, target);
    }

    // Visible text alone is not identity: content hidden until it is scrolled into view leaves only
    // the header and footer, which every page shares. Two addresses are one page only when all agree.
    const served = bodyText(result.html);
    const text = rendered?.text || served;
    const fingerprint = sha256(JSON.stringify({
      title: rendered?.title || result.raw.title || '',
      body_class: result.raw.body_class || '',
      served,
      rendered: rendered?.text || '',
      links: [...targets.keys()].sort(),
      resources: [...new Set(result.raw.resources.map((source) => {
        try {
          return new URL(source, rawBase).href;
        } catch {
          return source;
        }
      }))].sort(),
    }));
    const twin = text ? contentOwners.get(fingerprint) : null;
    if (twin) {
      Object.assign(owner, { status: 'alias', alias: twin, reason: 'same-content' });
      aliases.push(owner);
      report(`----   alias              ${shortUrl(owner.url)} -> ${twin.id} (same content)`);
      return;
    }
    if (pages.length >= settings.maxPages) {
      Object.assign(owner, { status: 'excluded', reason: 'over-cap' });
      return;
    }

    const id = `p-${String(pages.length + 1).padStart(3, '0')}`;
    if (text) contentOwners.set(fingerprint, owner);
    const canonicalHref = rendered?.canonical || result.raw.canonical;
    const canonical = canonicalHref ? scope.classify(canonicalHref, rawBase) : null;
    Object.assign(owner, {
      status: 'page',
      id,
      page: {
        id,
        url: owner.url,
        key: owner.key,
        ...(result.requested !== owner.url ? { requested_url: result.requested } : {}),
        ...(result.redirects.length ? { redirects: result.redirects } : {}),
        http_status: 200,
        content_type: result.response.type.split(';')[0].trim() || null,
        title: rendered?.title || result.raw.title || null,
        description: rendered?.description || result.raw.description || null,
        lang: rendered?.lang || result.raw.lang || null,
        canonical: canonical?.url || canonicalHref || null,
        noindex: /noindex/i.test(`${result.raw.robots || ''} ${result.response.headers.get('x-robots-tag') || ''}`),
        depth: final.depth,
        content_sha256: fingerprint,
        text_length: text.length,
        rendered: Boolean(rendered),
        ...(result.rendered?.error ? { render_error: result.rendered.error } : {}),
      },
    });
    pages.push(owner);

    const counts = {
      site: 0, external: 0, documents: 0, excluded: 0, ignored: 0,
    };
    const order = [];
    for (const target of targets.values()) {
      if (target.kind === 'page') {
        counts.site += 1;
        if (target.key === owner.key) continue;
        order.push(target.key);
      } else if (target.kind === 'external') counts.external += 1;
      else if (target.kind === 'document') counts.documents += 1;
      else if (target.kind === 'excluded') counts.excluded += 1;
      else counts.ignored += 1;
      admit(target, { source: 'link', from: owner });
    }
    if (canonical?.kind === 'page' && canonical.key !== owner.key) admit(canonical, { source: 'canonical' });
    owner.page.links = counts;
    if (pages.length === 1) linkOrder = order;
    report(`${id}  ${shortUrl(owner.url).padEnd(48)} links ${counts.site} site, ${counts.external} external, ${counts.documents} files`
      + `${result.rendered?.error ? `  (served HTML only: ${result.rendered.error})` : ''}`);
  }

  function finish(status) {
    const sourcesOf = (entry) => SOURCE_ORDER.filter((source) => entry.sources.has(source));
    artifact.scope = {
      ...scope.describe(), max_pages: settings.maxPages, delay_ms: client.delay, render: settings.render, concurrency: CONCURRENCY,
    };
    artifact.pages = pages.map((entry) => ({
      ...entry.page,
      sources: sourcesOf(entry),
      sitemap_index: entry.sitemap_index,
      found_on: entry.found_on,
      inbound: entry.inbound,
    }));
    artifact.aliases = aliases.map((entry) => {
      const owner = ownerOf(entry);
      return {
        url: entry.url,
        key: entry.key,
        alias_of: owner?.status === 'page' ? owner.id : null,
        alias_of_url: owner?.url ?? null,
        reason: entry.reason,
      };
    });
    const excluded = [...[...known.values()].filter((entry) => entry.status === 'excluded'), ...ruled.values()]
      .sort((left, right) => left.seq - right.seq);
    artifact.excluded_total = excluded.length;
    artifact.excluded = excluded.slice(0, LIST_LIMIT).map((entry) => ({
      url: entry.url,
      reason: entry.reason,
      ...(entry.detail ? { detail: entry.detail } : {}),
      sources: sourcesOf(entry),
      found_on: entry.found_on,
      inbound: entry.inbound,
    }));
    artifact.external_links = [...externalHosts.values()]
      .map((host) => ({
        host: host.host, links: host.urls.size, pages: host.pages.size, samples: host.samples, found_on: host.found_on,
      }))
      .sort((left, right) => right.pages - left.pages || right.links - left.links || left.host.localeCompare(right.host));
    artifact.documents = [...documents.values()].sort((left, right) => left.seq - right.seq).map((entry) => ({
      url: entry.url, extension: entry.extension, sources: sourcesOf(entry), found_on: entry.found_on, inbound: entry.inbound,
    }));
    artifact.ignored = Object.fromEntries(Object.entries(ignored).sort(([left], [right]) => left.localeCompare(right)));
    // An address the home page links to may have redirected; the tree orders the page it landed on.
    artifact.link_order = [...new Set(linkOrder.map((key) => {
      const owner = known.has(key) ? ownerOf(known.get(key)) : null;
      return owner?.status === 'page' ? owner.key : key;
    }))];
    artifact.coverage = {
      sitemap_urls: sitemapLocs.length,
      pages_from_sitemap: artifact.pages.filter((page) => page.sources.includes('sitemap')).length,
      pages_from_links: artifact.pages.filter((page) => page.sources.some((source) => source !== 'sitemap')).length,
      sitemap_only: artifact.pages.filter((page) => page.sources.every((source) => source === 'sitemap')).map((page) => page.url),
      links_only: artifact.pages.filter((page) => !page.sources.includes('sitemap')).map((page) => page.url),
    };
    artifact.requests = client.requests();
    // Pacing changes how long a crawl takes, never what it finds.
    const identity = { ...artifact.scope };
    delete identity.delay_ms;
    artifact.fingerprint = sha256(JSON.stringify({ scope: identity, pages: artifact.pages.map((page) => page.key).sort() }));
    artifact.status = status;
    artifact.duration_seconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
    return artifact;
  }

  // robots.txt first, before the site is asked for anything else.
  const loadRules = async (origin) => {
    const loaded = await loadRobots(client, scope, origin);
    if (loaded.blocked) return loaded;
    const rules = robotsRules(loaded.parsed);
    if (rules.crawlDelaySeconds) client.setDelay(Math.max(settings.delayMs, Math.round(rules.crawlDelaySeconds * 1000)));
    report(`robots.txt ${loaded.record.status ?? '-'}${loaded.record.absent ? ' (none, everything allowed)' : ''}`
      + `, group ${rules.group || 'none'}, ${rules.rules} rule(s), ${loaded.parsed.sitemaps.length} sitemap(s) declared`
      + `${rules.crawlDelaySeconds ? `, crawl-delay ${rules.crawlDelaySeconds}s` : ''}`);
    return {
      ...loaded,
      rules,
      record: {
        ...loaded.record,
        group: rules.group,
        rules: rules.rules,
        crawl_delay_seconds: rules.crawlDelaySeconds,
        sitemaps: loaded.parsed.sitemaps,
      },
    };
  };

  const requested = new URL(seedInput);
  // Extra hosts from --include-host are held to the start host's robots.txt.
  robots = await loadRules(requested.origin);
  artifact.robots = robots.record;
  if (robots.blocked) {
    failures.push(robots.blocked);
    return finish('BLOCKED');
  }

  const seedTarget = scope.classify(requested.href);
  if (!robots.rules.allows(pathAndQuery(seedTarget.url))) {
    failures.push(`robots.txt disallows the start page ${seedTarget.url}`);
    return finish('BLOCKED');
  }
  const seedFetch = await follow(client, seedTarget.url, {
    accept: HTML_ACCEPT, read: 'html', nextHop: seedHop(scope, robots.rules),
  });
  Object.assign(artifact.seed, {
    final_url: seedFetch.url, http_status: seedFetch.response?.status ?? null, redirects: seedFetch.redirects,
  });
  if (seedFetch.outcome === 'external-redirect') {
    failures.push(`the start page redirects off the site to ${seedFetch.detail}; rerun with that address as --url`);
    return finish('BLOCKED');
  }
  if (seedFetch.outcome !== 'response') {
    failures.push(`the start page could not be fetched: ${seedFetch.outcome}${seedFetch.detail ? ` (${seedFetch.detail})` : ''}`);
    return finish(seedFetch.outcome === 'robots' ? 'BLOCKED' : 'FAIL');
  }

  // The site is wherever the start page actually lives, `www` or not.
  scope = createScope({ seedUrl: seedFetch.url, ...scopeOptions });
  const finalOrigin = new URL(seedFetch.url).origin;
  if (finalOrigin !== requested.origin) {
    robots = await loadRules(finalOrigin);
    artifact.robots = robots.record;
    if (robots.blocked) {
      failures.push(robots.blocked);
      return finish('BLOCKED');
    }
  }

  if (robots.rules.allows(PROBE_PATH)) {
    const probeUrl = `${scope.canonicalOrigin}${PROBE_PATH}`;
    const probe = await follow(client, probeUrl, { accept: HTML_ACCEPT, read: 'html', nextHop: resourceHop(scope) });
    const response = probe.response;
    artifact.soft_404_probe = {
      url: probeUrl, status: response?.status ?? null, redirected_to: probe.redirects.length ? probe.url : null,
    };
    // A probe redirected onto a real page proves nothing; such redirects surface as aliases instead.
    if (response?.status === 200 && !probe.redirects.length && response.body) {
      const html = decodeBody(response.body, response.type);
      const { title } = extractHtml(html);
      probeSignature = notFoundSignature({ title, html, url: probe.url });
      artifact.soft_404_probe.title = title;
    }
    report(`soft-404 probe answered ${response?.status ?? probe.outcome}${probeSignature ? ' with a page; matching pages are dropped' : ''}`);
  }

  const declared = robots.record.sitemaps || [];
  const sitemaps = await loadSitemaps(client, scope, robots.rules, declared.length ? declared : [`${scope.canonicalOrigin}/sitemap.xml`]);
  artifact.sitemaps = sitemaps.records;
  sitemapLocs = sitemaps.locs;
  for (const entry of sitemaps.records) {
    report(`sitemap ${entry.url}: ${entry.skipped ? `skipped, ${entry.skipped}` : entry.kind ? `${entry.kind}, ${entry.urls} url(s)` : `unreadable (${entry.status ?? entry.outcome})`}`);
  }

  const seedEntry = admit(scope.classify(seedFetch.url), { source: 'seed' });
  if (!seedEntry) {
    failures.push(`robots.txt disallows the start page ${seedFetch.url}`);
    return finish('BLOCKED');
  }
  seedEntry.prefetched = seedFetch;
  sitemaps.locs.forEach((loc, index) => admit(scope.classify(loc), { source: 'sitemap', sitemapIndex: index }));

  let renderer = null;
  if (settings.render) {
    try {
      renderer = await openRenderer({ headed, client, isSiteUrl: (url) => scope.isSiteUrl(url) });
    } catch (error) {
      failures.push(`the browser could not start: ${String(error?.message || error).split('\n')[0]};`
        + ' rerun with --no-render to read the served HTML only');
      return finish('FAIL');
    }
  }

  let blockedBy = null;
  try {
    let cursor = 0;
    while (cursor < queue.length && pages.length < settings.maxPages && !blockedBy) {
      const batch = [];
      while (batch.length < CONCURRENCY && cursor < queue.length) {
        const entry = queue[cursor];
        cursor += 1;
        if (entry.status === 'queued') batch.push(entry);
      }
      if (!batch.length) continue;
      for (const entry of batch) entry.status = 'visiting';
      // Fetched together, settled in queue order, so timing never changes the inventory.
      const results = await Promise.all(batch.map(visit));
      results.forEach(apply);
      if (botWalls >= BOT_WALL_MIN && botWalls * 2 > visited) {
        blockedBy = `${botWalls} of ${visited} pages answered with a bot challenge instead of content`;
      }
    }
  } finally {
    await renderer?.close();
  }
  for (const entry of queue) {
    if (entry.status === 'queued') Object.assign(entry, { status: 'excluded', reason: 'over-cap' });
  }

  if (!pages.length) {
    failures.push(`the start page was not kept: ${seedEntry.reason || seedEntry.status}${seedEntry.detail ? ` (${seedEntry.detail})` : ''}`);
    return finish(seedEntry.reason === 'bot-wall' ? 'BLOCKED' : 'FAIL');
  }
  if (blockedBy) {
    failures.push(blockedBy);
    return finish('BLOCKED');
  }
  return finish('PASS');
}

async function main() {
  const options = parseArgs(process.argv.slice(2), {
    values: ['url', 'out', 'run-id', 'max-pages', 'max-depth', 'include', 'exclude', 'include-host', 'delay-ms'],
    flags: ['keep-query', 'no-render', 'headed', 'help'],
    defaults: { 'max-pages': '50', 'max-depth': '5', 'delay-ms': '500' },
  });
  if (options.help || !options.url || !options.out) {
    usage();
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  let settings;
  try {
    let seed;
    try {
      seed = new URL(options.url);
    } catch {
      throw new Error(`--url must be an absolute http or https address, not "${options.url}".`);
    }
    if (seed.protocol !== 'http:' && seed.protocol !== 'https:') {
      throw new Error(`--url must be an http or https address, not "${options.url}".`);
    }
    if (seed.username || seed.password) throw new Error('--url must not carry credentials.');
    settings = {
      maxPages: integerOption(options['max-pages'], 'max-pages', { min: 1, max: 1000 }),
      maxDepth: integerOption(options['max-depth'], 'max-depth', { min: 0, max: 20 }),
      delayMs: integerOption(options['delay-ms'], 'delay-ms', { min: 0, max: 60000 }),
      include: listOption(options.include),
      exclude: listOption(options.exclude),
      includeHosts: listOption(options['include-host']),
      keepQuery: Boolean(options['keep-query']),
      render: !options['no-render'],
    };
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const outDir = ensureDir(path.resolve(options.out));
  console.log(`  crawling ${options.url}: up to ${settings.maxPages} pages, ${settings.maxDepth} levels deep,`
    + ` ${CONCURRENCY} requests in flight ${settings.delayMs}ms apart${settings.render ? '' : ', served HTML only'}`);
  const inventory = await crawl(options.url, settings, { runId: options['run-id'] || null, headed: Boolean(options.headed) });
  const artifactPath = writeJson(path.join(outDir, 'inventory.json'), inventory);

  console.log(`\nPages: ${inventory.pages.length}  aliases: ${inventory.aliases.length}  excluded: ${inventory.excluded_total}`
    + `  external hosts: ${inventory.external_links.length}  documents: ${inventory.documents.length}`
    + `  requests: ${inventory.requests?.total ?? 0}`);
  console.log(`Status: ${inventory.status}`);
  for (const failure of inventory.failures) console.log(`  FAIL ${failure}`);
  console.log(`Artifact: ${relativePath(process.cwd(), artifactPath)}`);
  process.exitCode = inventory.status === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  console.error(`crawl.mjs failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
