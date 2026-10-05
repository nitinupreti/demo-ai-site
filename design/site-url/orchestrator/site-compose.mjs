/**
 * Site compose: turns every worker's declared nodes, plus the nodes code authors itself for mapped
 * components, into finished pages and fragments. Each page's container gets its units' nodes in
 * source reading order; each fragment gets its chrome; links to migrated pages are rewritten to
 * their AEM pages, everywhere, including inside rich text. Deterministic: the same results always
 * write the same files.
 */
import fs from 'node:fs';
import path from 'node:path';

import { unwrapProxy } from './assets.mjs';
import { splitUnitId } from './catalog.mjs';
import { collectContributions, mergePolicies } from './contributions.mjs';
import { createNode, parseJcrXml, serializeJcrXml } from './jcr-xml.mjs';
import { CONTENT_ROOT, writeSitePages } from './pages.mjs';
import { CHROME_SLOTS, fragmentMasterXml } from './site-scaffold.mjs';

const relative = (repoRoot, file) => path.relative(repoRoot, file).replaceAll('\\', '/');
const escapeText = (text) => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = (text) => escapeText(text).replaceAll('"', '&quot;');
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const safeHref = (value) => {
  // Browsers ignore whitespace and control characters inside a scheme, so the check must too.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(String(value).replace(/[\u0000-\u0020]/g, ''))?.[1]?.toLowerCase();
  return !scheme || SAFE_SCHEMES.has(scheme);
};

/**
 * Rewrites source addresses. A link to a migrated page becomes its AEM page: the bare path in a
 * plain link property (components render it with `.html`), `<path>.html` inside rich text. A
 * same-site link to a page that was not migrated becomes absolute, so it still reaches the source.
 */
export function createLinkRewriter({ linkEntries, hosts, canonicalOrigin, keepQuery = false }) {
  const siteHosts = new Set((hosts || []).map((host) => host.toLowerCase()));
  const pages = new Map();
  const keyOf = (url) => `${canonicalOrigin}${url.pathname.replace(/\/+$/, '') || '/'}${keepQuery ? url.search : ''}`;
  for (const entry of linkEntries) {
    try {
      pages.set(keyOf(new URL(entry.source_url)), entry.aem_path);
    } catch { /* not an address */ }
  }
  const stats = { pages: 0, unmigrated: new Set(), external: new Set(), unsafe: 0 };

  const resolve = (raw) => {
    const text = String(raw).trim();
    if (!text || text.startsWith('#') || /^(mailto|tel):/i.test(text)) return null;
    let url;
    try {
      url = new URL(text, `${canonicalOrigin}/`);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!siteHosts.has(url.hostname.toLowerCase())) {
      if (/^https?:\/\//i.test(text)) stats.external.add(url.hostname);
      return null;
    }
    const target = pages.get(keyOf(url));
    const fragment = url.hash && url.hash !== '#' ? url.hash : '';
    if (target) {
      stats.pages += 1;
      return { kind: 'page', path: target, fragment };
    }
    stats.unmigrated.add(`${url.origin}${url.pathname}`);
    return { kind: 'unmigrated', absolute: `${canonicalOrigin}${url.pathname}${url.search}${fragment}` };
  };

  const value = (raw) => {
    const text = String(raw).trim();
    // Only a value that is wholly an address is one; DAM and AEM paths are already where they belong.
    if (text.startsWith('/content/') || !(/^https?:\/\//i.test(text) || text.startsWith('/'))) return raw;
    if (text.startsWith('/') && !text.startsWith('//')) {
      const resolved = resolve(text);
      return resolved?.kind === 'page' ? `${resolved.path}${resolved.fragment}` : raw;
    }
    const resolved = resolve(text);
    if (!resolved) return raw;
    return resolved.kind === 'page' ? `${resolved.path}${resolved.fragment}` : resolved.absolute;
  };

  const html = (raw) => String(raw).replace(/\bhref\s*=\s*(["'])(.*?)\1/gi, (match, quote, href) => {
    const decoded = href.replaceAll('&amp;', '&');
    if (!safeHref(decoded)) {
      stats.unsafe += 1;
      return '';
    }
    const resolved = resolve(decoded);
    if (!resolved) return match;
    const next = resolved.kind === 'page' ? `${resolved.path}.html${resolved.fragment}` : resolved.absolute;
    return `href=${quote}${escapeAttribute(next)}${quote}`;
  });

  const rewrite = (input) => {
    if (typeof input !== 'string') return input;
    return /\bhref\s*=/i.test(input) ? html(input) : value(input);
  };

  return {
    rewrite,
    rewriteDeclaration(declaration) {
      const walk = (node) => ({
        ...node,
        properties: Object.fromEntries(Object.entries(node.properties || {}).map(([key, entry]) => [
          key, Array.isArray(entry) ? entry.map(rewrite) : rewrite(entry),
        ])),
        children: (node.children || []).map(walk),
      });
      return walk(declaration);
    },
    summary: () => ({
      rewritten_to_pages: stats.pages,
      unmigrated_same_site: [...stats.unmigrated].sort(),
      external_hosts: [...stats.external].sort(),
      unsafe_links_dropped: stats.unsafe,
    }),
  };
}

/** Rich text from the capture's own items: headings, paragraphs, lists and plain links. */
export function itemsToHtml(items = []) {
  const parts = [];
  for (const item of items) {
    if (item.type === 'heading') parts.push(`<h${item.level || 2}>${item.html || escapeText(item.text)}</h${item.level || 2}>`);
    else if (item.type === 'text') parts.push(`<p>${item.html || escapeText(item.text)}</p>`);
    else if (item.type === 'list') {
      const tag = item.ordered ? 'ol' : 'ul';
      parts.push(`<${tag}>${(item.items || []).map((entry) => `<li>${entry.html || escapeText(entry.text)}</li>`).join('')}</${tag}>`);
    } else if (item.type === 'link' && !item.image && item.text) {
      parts.push(`<p><a href="${escapeAttribute(item.href)}">${escapeText(item.text)}</a></p>`);
    }
  }
  return parts.join('\n');
}

/** Source image address to DAM path, under the address it was captured at and its unwrapped form. */
export function assetLookup(manifest = []) {
  const byUrl = new Map();
  for (const entry of manifest) byUrl.set(entry.source_url, entry);
  return (url) => {
    if (!url) return null;
    return byUrl.get(url) || byUrl.get(unwrapProxy(url) || '') || null;
  };
}

/** The node code authors for a unit of a mapped component: text, title or image, from the capture. */
export function mappedDeclaration(component, unit, content, findAsset) {
  const kind = String(component.reuse_target).split('/').pop();
  const items = content?.items || [];
  const base = { name: component.id, instance: unit, resource_type: component.resource_type };
  if (kind === 'title') {
    const heading = items.find((item) => item.type === 'heading');
    return { ...base, properties: { 'jcr:title': heading?.text || content?.text || '', type: `h${heading?.level || 2}` } };
  }
  if (kind === 'image') {
    const image = items.find((item) => item.type === 'image')
      || items.find((item) => item.type === 'link' && item.image)?.image
      || items.find((item) => item.type === 'background');
    const asset = findAsset(image?.src) || findAsset(image?.lazy_src);
    return {
      ...base,
      properties: asset
        ? { fileReference: asset.dam_path, alt: image?.alt || '', isDecorative: !image?.alt }
        : { isDecorative: true },
    };
  }
  return { ...base, properties: { text: itemsToHtml(items), textIsRich: true } };
}

function buildNode(declaration, fallbackType) {
  const properties = { 'jcr:primaryType': 'nt:unstructured', ...(declaration.properties || {}) };
  const type = declaration.resource_type || fallbackType;
  if (type) properties['sling:resourceType'] = type;
  return createNode(declaration.name, properties, (declaration.children || []).map((child) => buildNode(child)));
}

const XML_NAME = /^[A-Za-z_][\w.-]*$/;

function uniqueName(taken, preferred, fallback) {
  const base = XML_NAME.test(preferred || '') ? preferred : fallback;
  let name = base;
  for (let suffix = 2; taken.has(name); suffix += 1) name = `${base}-${suffix}`;
  taken.add(name);
  return name;
}

/**
 * Writes every page and both fragments. `contentByUnit` maps a unit id to its content.json record,
 * `workerResults` are the fan-out's results. Returns what it wrote, per-page coverage and the links.
 */
export function composeSite({
  repoRoot, plan, catalog, tree, inventory, template, names, workerResults, contentByUnit, assets, linkEntries, policiesFile,
}) {
  const conflicts = [];
  const rewriter = createLinkRewriter({
    linkEntries,
    hosts: inventory.scope?.hosts,
    canonicalOrigin: inventory.scope?.canonical_origin || new URL(inventory.seed.final_url).origin,
    keepQuery: Boolean(inventory.scope?.keep_query),
  });
  const findAsset = assetLookup(assets?.manifest);
  const componentOf = new Map(plan.components.flatMap((component) => component.instances.map((unit) => [unit, component])));
  const resultOf = new Map(workerResults.filter((entry) => entry.status === 'PASS').map((entry) => [entry.component_id, entry.result]));

  const declarations = new Map();
  for (const component of plan.components) {
    if (component.authoring === 'mapped') {
      for (const unit of component.instances) {
        declarations.set(unit, mappedDeclaration(component, unit, contentByUnit.get(unit), findAsset));
      }
      continue;
    }
    const contributions = resultOf.get(component.id)?.contributions || {};
    const declared = [contributions.page_node, contributions.experience_fragment_node]
      .flatMap((entry) => (Array.isArray(entry) ? entry : entry ? [entry] : []));
    for (const declaration of declared) {
      if (declaration?.instance && component.instances.includes(declaration.instance)) declarations.set(declaration.instance, declaration);
    }
  }

  const coverage = [];
  const contentFor = (node) => {
    if (!node.page_id) return [];
    const page = catalog.pages.find((entry) => entry.id === node.page_id);
    if (!page) return [];
    const taken = new Set();
    const nodes = [];
    const missing = [];
    let authored = 0;
    for (const unit of page.units) {
      if (catalog.units[unit]?.chrome) continue;
      const component = componentOf.get(unit);
      const declaration = declarations.get(unit);
      if (!component || !declaration) {
        missing.push({ unit, component: component?.id || null });
        continue;
      }
      const rewritten = rewriter.rewriteDeclaration(declaration);
      nodes.push(buildNode({ ...rewritten, name: uniqueName(taken, rewritten.name, component.id) }, component.resource_type));
      authored += 1;
    }
    coverage.push({ page: node.page_id, aem_path: node.aem_path, authored, missing });
    return nodes;
  };

  const pages = writeSitePages({
    repoRoot, tree, inventory, template, contentFor,
  });
  const written = [...pages.written];

  // Fragments: each chrome entry's representative, in the order the chrome sits on the page.
  const chromeOrder = catalog.chrome.map((entry) => entry.representative);
  for (const slot of CHROME_SLOTS) {
    const taken = new Set();
    const nodes = catalog.chrome
      .filter((entry) => entry.slot === slot)
      .map((entry) => {
        const component = componentOf.get(entry.representative);
        const declaration = declarations.get(entry.representative);
        if (!component || !declaration) return null;
        const rewritten = rewriter.rewriteDeclaration(declaration);
        return buildNode({ ...rewritten, name: uniqueName(taken, rewritten.name, component.id) }, component.resource_type);
      })
      .filter(Boolean);
    const shell = parseJcrXml(fragmentMasterXml({ conf: names.conf, app: names.app, title: `${slot[0].toUpperCase()}${slot.slice(1)}` }));
    const root = shell.root.children[0].children.find((child) => child.name === 'root');
    root.children = nodes;
    const file = path.join(repoRoot, CONTENT_ROOT, ...`${names.xfRoot}/${slot}/master`.split('/').filter(Boolean), '.content.xml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serializeJcrXml(shell), 'utf8');
    written.push(relative(repoRoot, file));
  }
  const missingChrome = chromeOrder.filter((unit) => !declarations.has(unit));

  // Clientlib indexes and declared policies, from the shared composer, in plan order. The clientlib
  // is shared with every other migrated site, so entries whose file still exists are kept first.
  const results = workerResults.filter((entry) => entry.status === 'PASS').map((entry) => entry.result);
  const collected = collectContributions({ components: plan.components }, results, {});
  conflicts.push(...collected.conflicts.filter((entry) => entry.kind === 'policy-conflict'));
  for (const [indexPath, base, entries] of [
    [plan.shared.clientlib_index, 'css', collected.clientlibEntries],
    [plan.shared.clientlib_js_index, 'js', collected.jsEntries],
  ]) {
    const file = path.join(repoRoot, indexPath);
    const kept = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && fs.existsSync(path.join(path.dirname(file), base, line)))
      : [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${[`#base=${base}`, ...kept, ...entries.filter((entry) => !kept.includes(entry))].join('\n')}\n`, 'utf8');
    written.push(indexPath);
  }
  if (policiesFile && (collected.policies.size || collected.additions.size) && !conflicts.length) {
    const file = path.join(repoRoot, policiesFile);
    if (fs.existsSync(file)) {
      const document = parseJcrXml(fs.readFileSync(file, 'utf8'));
      mergePolicies(document, collected.policies, collected.additions);
      fs.writeFileSync(file, serializeJcrXml(document), 'utf8');
      written.push(policiesFile);
    }
  }

  return {
    written,
    removed: pages.removed,
    conflicts,
    coverage,
    missing_units: coverage.flatMap((entry) => entry.missing),
    missing_chrome: missingChrome,
    links: rewriter.summary(),
  };
}

/** The content.json record of every unit, keyed by unit id. */
export function contentIndex(pages) {
  const index = new Map();
  for (const page of pages) {
    for (const entry of page.content?.instances || []) {
      if (entry.found) index.set(`${page.id}/${entry.id}`, entry);
    }
  }
  return index;
}

export { splitUnitId };
