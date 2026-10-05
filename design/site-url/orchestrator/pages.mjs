/**
 * Writes one empty AEM page per crawled page, built from the template's own initial content, and maps
 * every source address to the page it became. The same tree always writes the same files.
 */
import fs from 'node:fs';
import path from 'node:path';

import { decodeEntities } from '../tools/lib/crawl-parse.mjs';
import {
  createNode, findPath, getAttribute, parseJcrXml, serializeJcrXml, setAttribute, toJcrValue,
} from './jcr-xml.mjs';

export const CONTENT_ROOT = 'ui.content/src/main/content/jcr_root';
export const CONTENT_FILTER = 'ui.content/src/main/content/META-INF/vault/filter.xml';

const documentFile = (repoRoot, jcrPath) => path.join(repoRoot, CONTENT_ROOT, ...jcrPath.split('/').filter(Boolean), '.content.xml');
const relative = (repoRoot, file) => path.relative(repoRoot, file).replaceAll('\\', '/');

/** Document View element names are XML names, so a page name starting with a digit is ISO 9075 encoded. */
export function xmlName(name) {
  if (!/^[0-9]/.test(name)) return name;
  return `_x${name.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}_${name.slice(1)}`;
}

/** `en-US` as AEM stores it on a page: `en_US`. */
export function toJcrLanguage(lang) {
  const [language, ...rest] = String(lang || '').trim().split(/[-_]/);
  if (!/^[a-z]{2,3}$/i.test(language || '')) return null;
  const region = rest.find((part) => /^([a-z]{2}|\d{3})$/i.test(part));
  return region ? `${language.toLowerCase()}_${region.toUpperCase()}` : language.toLowerCase();
}

function titleFromName(name) {
  return name.split(/[-_]+/).filter(Boolean).map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' ');
}

/**
 * The template every page is created from: the one named, or else the one the nearest existing
 * ancestor page uses. Its initial content is the skeleton; the last editable layout container in its
 * structure is where later phases place components.
 */
export function resolveTemplate({ repoRoot, siteRoot, template }) {
  let templatePath = template || null;
  const segments = siteRoot.split('/').filter(Boolean);
  for (let length = segments.length - 1; length > 0 && !templatePath; length -= 1) {
    const file = documentFile(repoRoot, `/${segments.slice(0, length).join('/')}`);
    if (!fs.existsSync(file)) continue;
    templatePath = getAttribute(findPath(parseJcrXml(fs.readFileSync(file, 'utf8')).root, ['jcr:content']), 'cq:template');
  }
  if (!templatePath) {
    throw new Error(`no ancestor page of ${siteRoot} in ${CONTENT_ROOT} names a template; pass --template <path>`);
  }

  const read = (part) => {
    const file = documentFile(repoRoot, `${templatePath}/${part}`);
    if (!fs.existsSync(file)) throw new Error(`template ${templatePath} has no ${part} content at ${relative(repoRoot, file)}`);
    return parseJcrXml(fs.readFileSync(file, 'utf8'));
  };
  const initial = read('initial');
  const structure = read('structure');

  const editable = [];
  const walk = (node, trail) => {
    for (const child of node.children) {
      const childTrail = [...trail, child.name];
      if (getAttribute(child, 'editable') === '{Boolean}true' && getAttribute(child, 'layout')) editable.push(childTrail);
      walk(child, childTrail);
    }
  };
  walk(findPath(structure.root, ['jcr:content']) || structure.root, []);
  const container = [...editable].reverse().find((trail) => findPath(initial.root, ['jcr:content', ...trail]));
  if (!container) {
    throw new Error(`template ${templatePath} has no editable layout container in both its structure and its initial content`);
  }
  return { path: templatePath, initial, container: container.join('/') };
}

/** Removes page folders the tree no longer has. A folder starting with `_` is a page's own content. */
function pruneStale(siteDir, expected) {
  const removed = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const child = path.join(dir, entry.name);
      if (expected.has(child)) {
        walk(child);
      } else {
        fs.rmSync(child, { recursive: true, force: true });
        removed.push(child);
      }
    }
  };
  walk(siteDir);
  return removed;
}

/**
 * One `.content.xml` per tree node: a crawled page carries its source title, description, language and
 * robots setting; a placeholder parent is hidden from navigation and redirects to its first child.
 * Folders under the site root that the tree no longer has are removed, since the site root is
 * deployed in replace mode and anything left there would be deployed too. `contentFor(node)`, when
 * given, returns the component nodes that fill the template's content container on that page.
 */
export function writeSitePages({
  repoRoot, tree, inventory, template, contentFor,
}) {
  const pagesById = new Map(inventory.pages.map((page) => [page.id, page]));
  const rootLanguage = toJcrLanguage(pagesById.get(tree.nodes[0]?.page_id)?.lang);
  const written = [];
  const expected = new Set();

  tree.nodes.forEach((node, index) => {
    const children = [];
    for (let next = index + 1; next < tree.nodes.length && tree.nodes[next].depth > node.depth; next += 1) {
      if (tree.nodes[next].depth === node.depth + 1) children.push(tree.nodes[next].name);
    }
    const page = node.page_id ? pagesById.get(node.page_id) : null;
    const language = toJcrLanguage(page?.lang);
    const properties = page
      ? {
        'jcr:title': page.title || titleFromName(node.name),
        'jcr:description': page.description || null,
        // Set once on the root and inherited below it, unless a page says otherwise.
        'jcr:language': node.depth === 0 ? rootLanguage : (language && language !== rootLanguage ? language : null),
        'cq:robotsTags': page.noindex ? ['noindex'] : null,
      }
      : { 'jcr:title': titleFromName(node.name), hideInNav: true, 'cq:redirectTarget': node.redirect_to };

    const document = structuredClone(template.initial);
    const content = findPath(document.root, ['jcr:content']);
    for (const [key, value] of Object.entries(properties)) {
      if (value !== null && value !== undefined) setAttribute(content, key, toJcrValue(value));
    }
    const nodes = contentFor ? contentFor(node) : [];
    if (nodes.length) {
      const container = findPath(content, template.container.split('/'));
      if (!container) throw new Error(`template ${template.path} has no ${template.container} in its initial content`);
      container.children = nodes;
    }
    // Empty child elements fix sibling order; FileVault reads each child page from its own folder.
    document.root.children.push(...children.map((name) => createNode(xmlName(name))));

    const file = documentFile(repoRoot, node.aem_path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serializeJcrXml(document), 'utf8');
    written.push(relative(repoRoot, file));
    expected.add(path.dirname(file));
  });

  const removed = pruneStale(path.dirname(documentFile(repoRoot, tree.site_root)), expected);
  return { written, removed: removed.map((dir) => relative(repoRoot, dir)) };
}

/** Every source address, page or alias, with the AEM page it now lives at. */
export function linkMap(inventory, tree) {
  const pathOf = new Map(tree.nodes.filter((node) => node.page_id).map((node) => [node.page_id, node.aem_path]));
  const entries = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry.aem_path || seen.has(entry.key)) return;
    seen.add(entry.key);
    entries.push(entry);
  };
  for (const page of inventory.pages) {
    add({
      key: page.key, source_url: page.url, aem_path: pathOf.get(page.id), page_id: page.id, kind: 'page',
    });
  }
  for (const alias of inventory.aliases) {
    add({
      key: alias.key, source_url: alias.url, aem_path: pathOf.get(alias.alias_of), page_id: alias.alias_of, kind: alias.reason,
    });
  }
  return entries;
}

export function writeLinkMap(dir, entries) {
  const quote = (value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  fs.mkdirSync(dir, { recursive: true });
  const json = path.join(dir, 'link-map.json');
  const csv = path.join(dir, 'url-map.csv');
  fs.writeFileSync(json, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  fs.writeFileSync(csv, `${['source_url,aem_path', ...entries.map((entry) => `${quote(entry.source_url)},${quote(entry.aem_path)}`)].join('\n')}\n`, 'utf8');
  return { json, csv };
}

/**
 * Asks AEM for every page as a visitor would see it. A page passes when it answers 200 with its
 * source title; a placeholder passes when it answers at all, redirect included.
 */
export async function verifyPages({
  aemUrl, tree, inventory, username = 'admin', password, fetchFn = fetch, concurrency = 4,
}) {
  const titles = new Map(inventory.pages.map((page) => [page.id, page.title]));
  const headers = { authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}` };
  const normalized = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  const check = async (node) => {
    const base = { aem_path: node.aem_path, page_id: node.page_id };
    let response;
    try {
      response = await fetchFn(`${aemUrl}${node.aem_path}.html?wcmmode=disabled`, { headers, redirect: 'manual' });
    } catch (error) {
      return { ...base, ok: false, detail: `unreachable: ${error.message}` };
    }
    const { status } = response;
    if (!node.page_id) {
      const ok = status === 200 || (status >= 300 && status < 400);
      return { ...base, ok, status, ...(ok ? {} : { detail: `HTTP ${status}` }) };
    }
    if (status !== 200) return { ...base, ok: false, status, detail: `HTTP ${status}` };
    const title = normalized(decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(await response.text())?.[1] || ''));
    const expected = normalized(titles.get(node.page_id));
    const ok = !expected || title.includes(expected);
    return { ...base, ok, status, title, ...(ok ? {} : { detail: `title "${title}" is not "${expected}"` }) };
  };

  const results = new Array(tree.nodes.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tree.nodes.length) }, async () => {
    while (cursor < tree.nodes.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await check(tree.nodes[index]);
    }
  }));
  const failed = results.filter((entry) => !entry.ok).length;
  return {
    status: failed ? 'FAIL' : 'PASS', checked: results.length, failed, results,
  };
}
