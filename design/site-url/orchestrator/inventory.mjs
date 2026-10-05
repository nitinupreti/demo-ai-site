/**
 * Maps a crawled site onto the AEM page tree. Pure, so every later phase and every rerun derives the
 * same AEM path for the same source page.
 */
const MAX_NAME_LENGTH = 60;
const PAGE_EXTENSION = /\.(html?|php|aspx?|jsp)$/i;

export function validateSiteRoot(siteRoot) {
  if (!/^\/content(\/[a-z0-9][a-z0-9_-]*)+$/i.test(String(siteRoot || ''))) {
    throw new Error(`--target-path must be a page path under /content, such as /content/site/root, not "${siteRoot}".`);
  }
  return siteRoot;
}

/** A source path segment as an AEM page name: lowercase `a-z0-9_-`, never empty. */
export function jcrName(segment) {
  let text = String(segment);
  try {
    text = decodeURIComponent(text);
  } catch { /* keep the encoded segment */ }
  const name = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(PAGE_EXTENSION, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[-_]+$/, '');
  return name || 'page';
}

const pathOf = (url) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

function sourceSegments(page, prefix) {
  const url = new URL(page.url);
  const segments = url.pathname.slice(prefix.length).split('/').filter(Boolean);
  // Under --keep-query the query is what tells two pages apart, so it becomes part of the name.
  if (url.search) {
    const query = url.search.slice(1);
    if (segments.length) segments[segments.length - 1] = `${segments.at(-1)}-${query}`;
    else segments.push(query);
  }
  return segments;
}

function compareRank(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/**
 * One AEM page per crawled page, mirroring the source paths below `siteRoot`. A missing parent
 * becomes a placeholder that redirects to its first child. Siblings follow the order the start page
 * links to them, then sitemap order, then crawl order.
 */
export function buildSiteTree(inventory, { siteRoot }) {
  validateSiteRoot(siteRoot);
  const prefix = inventory.scope?.seed_path_prefix || '';
  const linkRank = new Map((inventory.link_order || []).map((key, index) => [key, index]));
  const makeNode = (parent, name) => ({
    name, path: parent ? `${parent.path}/${name}` : siteRoot, children: new Map(), page: null, rank: null,
  });
  const root = makeNode(null, siteRoot.split('/').pop());
  const renamed = [];

  inventory.pages.forEach((page, index) => {
    const segments = sourceSegments(page, prefix);
    let node = root;
    segments.forEach((segment, depth) => {
      const wanted = jcrName(segment);
      let child = node.children.get(wanted);
      // Two source pages can clean up to one name; the later one takes the next free suffix.
      if (depth === segments.length - 1 && child?.page) {
        let suffix = 2;
        while (node.children.has(`${wanted}-${suffix}`)) suffix += 1;
        child = makeNode(node, `${wanted}-${suffix}`);
        node.children.set(child.name, child);
        renamed.push({
          id: page.id, url: page.url, wanted: `${node.path}/${wanted}`, aem_path: child.path,
        });
      } else if (!child) {
        child = makeNode(node, wanted);
        node.children.set(wanted, child);
      }
      node = child;
    });
    if (node.page) throw new Error(`${page.url} and ${node.page.url} both map to ${node.path}`);
    node.page = page;
    node.rank = [linkRank.get(page.key) ?? Infinity, page.sitemap_index ?? Infinity, index];
  });

  const rankOf = (node) => {
    if (!node.rank) node.rank = [...node.children.values()].map(rankOf).sort(compareRank)[0];
    return node.rank;
  };
  const nodes = [];
  const walk = (node, depth, last) => {
    const children = [...node.children.values()]
      .sort((left, right) => compareRank(rankOf(left), rankOf(right)) || left.name.localeCompare(right.name));
    nodes.push({
      aem_path: node.path,
      name: node.name,
      depth,
      last,
      page_id: node.page?.id ?? null,
      url: node.page?.url ?? null,
      ...(node.page ? {} : { placeholder: true, redirect_to: children[0]?.path ?? null }),
    });
    children.forEach((child, index) => walk(child, depth + 1, index === children.length - 1));
  };
  walk(root, 0, true);

  return {
    site_root: siteRoot,
    inventory_fingerprint: inventory.fingerprint,
    pages: nodes.filter((node) => node.page_id).length,
    placeholders: nodes.filter((node) => node.placeholder).length,
    nodes,
    renamed,
  };
}

export function formatTree(tree, { unicode = false } = {}) {
  const glyph = unicode
    ? {
      tee: '\u251C\u2500 ', elbow: '\u2514\u2500 ', pipe: '\u2502  ', gap: '   ', arrow: '\u2190',
    }
    : {
      tee: '|- ', elbow: '`- ', pipe: '|  ', gap: '   ', arrow: '<-',
    };
  const open = [];
  return tree.nodes.map((node) => {
    const source = node.url
      ? `${glyph.arrow} ${pathOf(node.url)}`
      : `(placeholder, redirects to ${String(node.redirect_to).split('/').pop()})`;
    if (node.depth === 0) return `${node.aem_path}  ${source}`;
    open.length = node.depth - 1;
    const indent = open.map((last) => (last ? glyph.gap : glyph.pipe)).join('');
    open.push(node.last);
    return `${indent}${node.last ? glyph.elbow : glyph.tee}${node.name}  ${source}`;
  });
}

function countBy(entries, field) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry[field], (counts.get(entry[field]) || 0) + 1);
  return [...counts]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
}

function listed(items, limit) {
  return `${items.slice(0, limit).join(', ')}${items.length > limit ? `, and ${items.length - limit} more` : ''}`;
}

export function summarizeInventory(inventory) {
  const coverage = inventory.coverage || {};
  const lines = [`pages      ${inventory.pages.length}  (${coverage.pages_from_sitemap ?? 0} in the sitemap,`
    + ` ${coverage.pages_from_links ?? 0} reached by links)`];
  if (coverage.links_only?.length) lines.push(`           only reached by links: ${listed(coverage.links_only.map(pathOf), 8)}`);
  if (coverage.sitemap_only?.length) lines.push(`           only in the sitemap: ${listed(coverage.sitemap_only.map(pathOf), 8)}`);
  if (inventory.aliases.length) lines.push(`aliases    ${inventory.aliases.length}  (${countBy(inventory.aliases, 'reason')})`);
  const excludedTotal = inventory.excluded_total ?? inventory.excluded.length;
  if (excludedTotal) lines.push(`excluded   ${excludedTotal}  (${countBy(inventory.excluded, 'reason')})`);
  if (inventory.external_links.length) {
    const hosts = inventory.external_links.map((entry) => `${entry.host} (${entry.pages} page${entry.pages === 1 ? '' : 's'})`);
    lines.push(`external   ${inventory.external_links.length} host(s), linked but never requested: ${listed(hosts, 6)}`);
  }
  if (inventory.documents.length) {
    lines.push(`documents  ${inventory.documents.length} same-site file(s), kept as links: `
      + `${listed(inventory.documents.map((entry) => pathOf(entry.url)), 4)}`);
  }
  if (inventory.requests) {
    const hosts = Object.entries(inventory.requests.by_host).map(([host, count]) => `${host} ${count}`);
    lines.push(`requests   ${inventory.requests.total}  (${hosts.join(', ')})`);
  }
  return lines;
}
