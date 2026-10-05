/**
 * Pure parsers the site crawler relies on: robots.txt (RFC 9309), XML sitemaps, served HTML and
 * bot-challenge pages. No network and no browser, so every rule here is unit-testable.
 */

/** Product token matched against robots.txt user-agent groups. */
export const ROBOTS_AGENT = 'aem-migration-crawler';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  hellip: '\u2026', copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });
}

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let group = null;
  let collectingAgents = false;
  for (const rawLine of String(text || '').split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    // Lines without a field are noise; real files carry them (stray words, merge leftovers).
    if (colon < 1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!collectingAgents) {
        group = { agents: [], rules: [], crawlDelay: null };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (group && (field === 'allow' || field === 'disallow')) {
      // An empty Disallow allows everything, which is what having no rule means.
      if (value) group.rules.push({ allow: field === 'allow', pattern: value });
    } else if (group && field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) group.crawlDelay = seconds;
    }
  }
  return { groups, sitemaps };
}

function robotsPattern(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[^\x21-\x7e]/g, (character) => encodeURIComponent(character))
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/**
 * The rules that apply to this crawler: its own group when one names it, otherwise `*`. The longest
 * matching pattern decides, and Allow wins a tie (RFC 9309, 2.2.2).
 */
export function robotsRules(parsed, agent = ROBOTS_AGENT) {
  const token = agent.toLowerCase();
  const own = parsed.groups.filter((group) => group.agents.includes(token));
  const chosen = own.length ? own : parsed.groups.filter((group) => group.agents.includes('*'));
  const rules = chosen.flatMap((group) => group.rules)
    .map((rule) => ({ allow: rule.allow, length: rule.pattern.length, test: robotsPattern(rule.pattern) }));
  const delays = chosen.map((group) => group.crawlDelay).filter((value) => value !== null);
  return {
    group: own.length ? token : chosen.length ? '*' : null,
    rules: rules.length,
    crawlDelaySeconds: delays.length ? Math.max(...delays) : null,
    allows(pathAndQuery) {
      if (pathAndQuery === '/robots.txt') return true;
      let best = null;
      for (const rule of rules) {
        if (!rule.test.test(pathAndQuery)) continue;
        if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule;
      }
      return !best || best.allow;
    },
  };
}

export function parseSitemap(xml) {
  const text = String(xml || '').replace(/^\uFEFF/, '');
  const kind = /<sitemapindex[\s>]/i.test(text) ? 'sitemapindex' : /<urlset[\s>]/i.test(text) ? 'urlset' : 'unknown';
  if (kind === 'unknown') return { kind, locs: [] };
  const locs = [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)]
    .map((match) => decodeEntities(match[1].trim()))
    .filter(Boolean);
  return { kind, locs };
}

const COMMENTS = /<!--[\s\S]*?-->/g;
// Scripts and styles never hold a link or text a visitor can follow or read.
const SCRIPTS_AND_STYLES = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>/gi;
const SOURCE_TAGS = ['script', 'iframe', 'img', 'video', 'audio', 'source', 'embed'];

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]).trim() : null;
}

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
}

/** What the served HTML says before any script runs. Hrefs and sources are returned as written. */
export function extractHtml(html) {
  const uncommented = String(html || '').replace(COMMENTS, ' ');
  const live = uncommented.replace(SCRIPTS_AND_STYLES, ' ');
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(live)?.[1];
  const relOf = (tag) => (attribute(tag, 'rel') || '').toLowerCase().split(/\s+/);
  const meta = (name) => tags(live, 'meta').filter((tag) => (attribute(tag, 'name') || '').toLowerCase() === name)
    .map((tag) => attribute(tag, 'content')).find(Boolean) || null;
  return {
    title: title ? decodeEntities(title).replace(/\s+/g, ' ').trim() || null : null,
    description: meta('description'),
    lang: attribute(tags(live, 'html')[0] || '', 'lang'),
    base: tags(live, 'base').map((tag) => attribute(tag, 'href')).find(Boolean) || null,
    canonical: tags(live, 'link').filter((tag) => relOf(tag).includes('canonical'))
      .map((tag) => attribute(tag, 'href')).find(Boolean) || null,
    robots: meta('robots'),
    links: [...tags(live, 'a'), ...tags(live, 'area')].map((tag) => attribute(tag, 'href')).filter(Boolean),
    // Two pages can share every visible word; what each one loads and embeds still tells them apart.
    resources: [
      ...SOURCE_TAGS.flatMap((name) => tags(uncommented, name).map((tag) => attribute(tag, 'src'))),
      ...tags(live, 'object').map((tag) => attribute(tag, 'data')),
      ...tags(live, 'link').filter((tag) => relOf(tag).some((rel) => rel === 'stylesheet' || rel === 'shortlink'))
        .map((tag) => attribute(tag, 'href')),
    ].filter(Boolean),
    body_class: attribute(tags(live, 'body')[0] || '', 'class'),
  };
}

/** All text the served body holds, hidden or not: content waiting for a scroll animation counts too. */
export function bodyText(html) {
  const source = String(html || '');
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(source)?.[1] ?? source;
  return decodeEntities(body
    .replace(COMMENTS, ' ')
    .replace(SCRIPTS_AND_STYLES, ' ')
    .replace(/<(noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A "not found" page served with 200 echoes the address it was asked for, so the address is
 * removed before two of them are compared.
 */
export function notFoundSignature({ title, html, url }) {
  const { pathname } = new URL(url);
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch { /* keep the encoded form */ }
  const slug = pathname.split('/').filter(Boolean).pop() || '';
  const tokens = [...new Set([pathname, decoded, pathname.replace(/\/$/, ''), slug.length >= 3 ? slug : ''])]
    .filter((token) => token && token !== '/')
    .sort((left, right) => right.length - left.length);
  let text = bodyText(html);
  for (const token of tokens) text = text.split(token).join(' ');
  return `${title || ''}\u0000${text.replace(/\s+/g, ' ').trim()}`;
}

const CHALLENGE_TITLE = /just a moment|attention required|checking your browser|verify you are (a )?human|pardon our interruption|access denied|request unsuccessful/i;
// Cloudflare injects challenge-platform into ordinary pages too, so a marker alone proves nothing.
const CHALLENGE_BODY = /challenge-platform|cf-chl-|_incapsula_resource|captcha-delivery\.com|datadome|px-captcha|perimeterx/i;
const CHALLENGE_STATUS = new Set([403, 429, 503]);

/** Recognises a bot challenge served instead of the page, so it is never mistaken for content. */
export function detectChallenge({
  status, headers, title, body,
}) {
  const header = (name) => (typeof headers?.get === 'function' ? headers.get(name) : headers?.[name]) || '';
  if (/challenge/i.test(header('cf-mitigated'))) return 'Cloudflare challenge';
  const titled = CHALLENGE_TITLE.test(String(title || ''));
  const marked = CHALLENGE_BODY.test(String(body || '').slice(0, 200000));
  const refused = CHALLENGE_STATUS.has(status);
  if ((marked && (titled || refused)) || (titled && refused)) {
    return `bot challenge (${status}${title ? `, "${title}"` : ''})`;
  }
  return null;
}
