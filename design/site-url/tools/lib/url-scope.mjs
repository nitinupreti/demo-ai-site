/**
 * Decides which URLs belong to the site being migrated, and gives each one a single identity. The
 * crawler, the AEM page mapping and the link rewriter all ask this module, so they cannot disagree
 * about what "the same site" means.
 */

// Removed even under --keep-query: they label a visit, never a different page.
const TRACKING_PARAM = /^(utm_\w+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|__hstc|__hssc|__hsfp|hsctatracking)$/i;

// Under --keep-query these produce search results, comment replies or cart actions, not pages.
const UTILITY_QUERY_KEYS = new Set(['s', 'replytocom', 'add-to-cart']);

/** Same-site files that pages link to but that are never migrated as pages themselves. */
export const NON_PAGE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv', 'epub',
  'zip', 'gz', 'tgz', 'rar', '7z', 'dmg', 'exe', 'msi', 'apk', 'ics', 'vcf',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff',
  'mp4', 'webm', 'mov', 'm4v', 'mp3', 'wav', 'ogg', 'm4a',
  'js', 'mjs', 'css', 'map', 'json', 'xml', 'rss', 'atom', 'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

/** Paths that are never content pages, matched against the lowercased path. */
export const DEFAULT_EXCLUDES = [
  { name: 'cms-admin', pattern: /^\/(wp-admin|wp-login\.php|wp-json|wp-content|wp-includes|xmlrpc\.php|cdn-cgi)(\/|$)/ },
  { name: 'feed', pattern: /(^|\/)(feed|rss|atom|trackback)(\/|$)/ },
  { name: 'account', pattern: /(^|\/)(cart|basket|checkout|my-account|account|login|log-in|logout|log-out|signin|sign-in|signup|sign-up|register)(\/|$)/ },
  { name: 'search', pattern: /(^|\/)search(\/|$)/ },
  { name: 'archive', pattern: /(^|\/)(tag|tags|author|category)(\/|$)/ },
  { name: 'pagination', pattern: /(^|\/)page\/\d+(\/|$)/ },
];

export function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

/** `www.example.com` and `example.com` are one site; every other subdomain is a different one. */
export function wwwTwin(host) {
  const value = normalizeHost(host);
  if (!value.includes('.') || value.includes(':') || value.startsWith('[') || /^[\d.]+$/.test(value)) return null;
  return value.startsWith('www.') ? value.slice(4) : `www.${value}`;
}

/**
 * Path globs as users type them: `*` stays inside one segment, `**` crosses segments, and a
 * trailing `/**` also matches the folder itself, so `/about-us/**` covers `/about-us/`.
 */
export function globToRegExp(glob) {
  let text = String(glob).trim().replaceAll('\\', '/');
  if (!text.startsWith('/')) text = `/${text}`;
  text = text.replace(/\/+$/, '') || '/';
  const body = text
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*$/, '\u0001')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*')
    .replace('\u0001', '(?:/.*)?');
  return new RegExp(`^${body}/?$`, 'i');
}

function stripTrailingSlash(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

function normalizePath(pathname) {
  const collapsed = pathname.replace(/\/{2,}/g, '/').replace(/\/(index|default)\.(html?|php|aspx?|jsp)$/i, '/');
  return collapsed || '/';
}

/**
 * Builds the scope for one crawl. `classify` answers, for any href found anywhere, whether it is a
 * page of this site, a same-site file, an excluded path, an external link, or not a link at all.
 * Robots rules are not part of it: they depend on a fetched file, and the crawler applies them.
 */
export function createScope({
  seedUrl, includeHosts = [], include = [], exclude = [], maxDepth = 5, keepQuery = false,
}) {
  const seed = new URL(seedUrl);
  const canonicalHost = normalizeHost(seed.hostname);
  const aliases = new Set([canonicalHost, wwwTwin(canonicalHost)].filter(Boolean));
  const extraHosts = new Set(includeHosts.map(normalizeHost).filter((host) => host && !aliases.has(host)));
  const { port, protocol } = seed;
  const canonicalOrigin = `${protocol}//${canonicalHost}${port ? `:${port}` : ''}`;
  // A start page below the root makes that section the site: nothing outside it has a place in the tree.
  const sectionPrefix = stripTrailingSlash(normalizePath(seed.pathname)).replace(/^\/$/, '');
  const includes = include.map(globToRegExp);
  const excludes = exclude.map(globToRegExp);

  function resolve(raw, base) {
    let parsed;
    try {
      parsed = new URL(String(raw).trim(), base);
    } catch {
      return { kind: 'ignored', reason: 'invalid' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { kind: 'ignored', reason: parsed.protocol.slice(0, -1) || 'invalid' };
    }
    if (parsed.username || parsed.password) return { kind: 'ignored', reason: 'credentials' };
    const host = normalizeHost(parsed.hostname);
    const alias = aliases.has(host);
    if (parsed.port !== port || !(alias || extraHosts.has(host))) {
      return { kind: 'external', url: parsed.href, host: parsed.host.toLowerCase() };
    }
    if (alias) {
      parsed.protocol = protocol;
      parsed.hostname = canonicalHost;
    }
    parsed.hash = '';
    parsed.pathname = normalizePath(parsed.pathname);
    let queryDropped = false;
    let utility = false;
    if (keepQuery) {
      const kept = [...parsed.searchParams]
        .filter(([name]) => !TRACKING_PARAM.test(name))
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      utility = kept.some(([name]) => UTILITY_QUERY_KEYS.has(name.toLowerCase()));
      parsed.search = new URLSearchParams(kept).toString();
    } else {
      queryDropped = parsed.search.length > 1;
      parsed.search = '';
    }
    return { kind: 'site', parsed, queryDropped, utility };
  }

  // Trailing slashes never tell two pages apart, so identity ignores them while URLs keep them.
  const keyOf = (parsed) => `${parsed.origin}${stripTrailingSlash(parsed.pathname)}${parsed.search}`;
  const seedResolved = resolve(seed.href);
  const seedKey = keyOf(seedResolved.parsed);

  function classify(raw, base) {
    const resolved = resolve(raw, base);
    if (resolved.kind !== 'site') return resolved;
    const { parsed } = resolved;
    const url = parsed.href;
    const key = keyOf(parsed);
    const { pathname } = parsed;
    const extension = /\.([a-z0-9]{1,5})$/i.exec(pathname)?.[1].toLowerCase();
    if (extension && NON_PAGE_EXTENSIONS.has(extension)) return { kind: 'document', url, key, extension };

    const page = { kind: 'page', url, key, query_dropped: resolved.queryDropped };
    // The start page is the site root: no rule may exclude it.
    if (key === seedKey) return { ...page, depth: 0 };

    const excluded = (reason) => ({ kind: 'excluded', url, key, reason });
    if (resolved.utility) return excluded('default:utility-query');
    const lower = pathname.toLowerCase();
    const rule = DEFAULT_EXCLUDES.find((entry) => entry.pattern.test(lower));
    if (rule) return excluded(`default:${rule.name}`);
    if (excludes.some((pattern) => pattern.test(pathname))) return excluded('exclude');
    if (sectionPrefix && pathname !== sectionPrefix && !pathname.startsWith(`${sectionPrefix}/`)) {
      return excluded('outside-start-path');
    }
    if (includes.length && !includes.some((pattern) => pattern.test(pathname))) return excluded('not-included');
    const depth = pathname.slice(sectionPrefix.length).split('/').filter(Boolean).length;
    if (depth > maxDepth) return excluded('depth');
    return { ...page, depth };
  }

  return {
    canonicalOrigin,
    seedKey,
    seedUrl: seedResolved.parsed.href,
    sectionPrefix,
    classify,
    isSiteUrl: (raw, base) => resolve(raw, base).kind === 'site',
    describe: () => ({
      hosts: [...aliases, ...extraHosts],
      canonical_origin: canonicalOrigin,
      seed_path_prefix: sectionPrefix,
      max_depth: maxDepth,
      include: [...include],
      exclude: [...exclude],
      include_hosts: [...extraHosts],
      keep_query: keepQuery,
      default_excludes: DEFAULT_EXCLUDES.map((entry) => entry.name),
    }),
  };
}
