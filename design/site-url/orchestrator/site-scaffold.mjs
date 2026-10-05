/**
 * Site scaffold: everything a migrated site needs around its pages that code can write without
 * judgement. A template of its own (the project's, minus the page-title component every source page
 * replaces with its own heading, pointing at the site's header and footer fragments), the fragment
 * skeletons, the clientlib components declare their CSS into, the page includes that load it, and a
 * replace-mode filter root for each. Rewritten identically on every run.
 */
import fs from 'node:fs';
import path from 'node:path';

import { ensureFilterRoot } from './assets.mjs';
import {
  createNode, findPath, getAttribute, parseJcrXml, serializeJcrXml, setAttribute, toJcrValue,
} from './jcr-xml.mjs';
import { CONTENT_FILTER, CONTENT_ROOT, resolveTemplate } from './pages.mjs';
import { APPS_ROOT, COMPONENT_CLIENTLIB } from './site-plan.mjs';

const NAMESPACES = 'xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" '
  + 'xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"';
export const CHROME_SLOTS = ['header', 'footer'];

const relative = (repoRoot, file) => path.relative(repoRoot, file).replaceAll('\\', '/');
const contentFile = (repoRoot, jcrPath, name = '.content.xml') => path.join(repoRoot, CONTENT_ROOT, ...jcrPath.split('/').filter(Boolean), name);

function findJavaRoot(repoRoot) {
  const base = path.join(repoRoot, 'core', 'src', 'main', 'java');
  const walk = (dir, depth) => {
    if (depth > 6 || !fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (path.basename(dir) === 'models' && entries.some((entry) => entry.name === 'package-info.java')) return dir;
    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const found = walk(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
    return null;
  };
  const found = walk(base, 0);
  return found ? path.relative(base, found).replaceAll('\\', '/') : null;
}

/** Names every later phase shares, all derived from --target-path and the project's own layout. */
export function siteNames({ repoRoot, targetPath, template }) {
  const segments = targetPath.split('/').filter(Boolean);
  const appsDir = path.join(repoRoot, APPS_ROOT);
  const apps = fs.existsSync(appsDir)
    ? fs.readdirSync(appsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  const app = apps.length === 1 ? apps[0] : apps.find((name) => name === segments[1]);
  if (!app) throw new Error(`cannot tell which ui.apps application the site belongs to (found: ${apps.join(', ') || 'none'})`);

  const source = resolveTemplate({ repoRoot, siteRoot: targetPath, template });
  const conf = /^\/conf\/([^/]+)\//.exec(source.path)?.[1];
  if (!conf) throw new Error(`template ${source.path} is not under /conf/<name>/`);
  const siteName = segments.at(-1);
  const javaRoot = findJavaRoot(repoRoot);
  if (!javaRoot) throw new Error('no core/src/main/java/**/models/package-info.java to place Sling Models next to');
  const textComponent = path.join(appsDir, app, 'components', 'text', '.content.xml');
  const componentGroup = fs.existsSync(textComponent)
    ? getAttribute(parseJcrXml(fs.readFileSync(textComponent, 'utf8')).root, 'componentGroup')
    : null;

  return {
    app,
    conf,
    siteName,
    siteRoot: targetPath,
    sourceTemplate: source.path,
    templatePath: `/conf/${conf}/settings/wcm/templates/${siteName}-page`,
    xfRoot: `/content/experience-fragments/${segments[1]}/${siteName}`,
    damPath: targetPath.replace(/^\/content\//, '/content/dam/'),
    javaRoot,
    componentGroup: componentGroup || `${app} - Content`,
    clientlibCategory: `${app}.components`,
  };
}

function copyTree(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
}

const resourceTypeOf = (node) => getAttribute(node, 'sling:resourceType') || '';

/** Drops the page-title component; every source page carries its own heading in its content. */
function removeTitles(node) {
  node.children = node.children.filter((child) => !/\/components\/title$/.test(resourceTypeOf(child)));
  node.children.forEach(removeTitles);
}

function fragmentSlots(node, found = new Map()) {
  for (const child of node.children) {
    if (/\/experiencefragment$/.test(resourceTypeOf(child))) {
      const slot = CHROME_SLOTS.find((name) => child.name.includes(name));
      if (slot && !found.has(slot)) found.set(slot, child);
    }
    fragmentSlots(child, found);
  }
  return found;
}

function rewriteTemplateDocument(file, { templatePath, xfRoot, app, withFragments }) {
  const document = parseJcrXml(fs.readFileSync(file, 'utf8'));
  const content = findPath(document.root, ['jcr:content']);
  if (!content) return;
  if (getAttribute(content, 'cq:template')) setAttribute(content, 'cq:template', toJcrValue(templatePath));
  removeTitles(content);
  if (withFragments) {
    const root = content.children.find((child) => getAttribute(child, 'layout')) || content.children[0];
    const slots = fragmentSlots(content);
    for (const slot of CHROME_SLOTS) {
      let node = slots.get(slot);
      if (!node && root) {
        node = createNode(`experiencefragment-${slot}`, {
          'jcr:primaryType': 'nt:unstructured',
          'sling:resourceType': `${app}/components/experiencefragment`,
        });
        if (slot === 'header') root.children.unshift(node);
        else root.children.push(node);
      }
      if (node) setAttribute(node, 'fragmentVariationPath', toJcrValue(`${xfRoot}/${slot}/master`));
    }
  }
  fs.writeFileSync(file, serializeJcrXml(document), 'utf8');
}

function writeText(repoRoot, file, text, written) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current !== text) fs.writeFileSync(file, text, 'utf8');
  written.push(relative(repoRoot, file));
}

/** An empty fragment variation; compose fills its root with the chrome components' nodes. */
export function fragmentMasterXml({ conf, app, title, nodes = '' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NAMESPACES}
    jcr:primaryType="cq:Page">
    <jcr:content
        cq:template="/conf/${conf}/settings/wcm/templates/xf-web-variation"
        cq:xfMasterVariation="{Boolean}true"
        cq:xfVariantType="web"
        jcr:primaryType="cq:PageContent"
        jcr:title="${title}"
        sling:resourceType="${app}/components/xfpage">
        <root
            jcr:primaryType="nt:unstructured"
            sling:resourceType="${app}/components/container"
            layout="responsiveGrid"${nodes ? `>\n${nodes}\n        </root>` : '/>'}
    </jcr:content>
</jcr:root>
`;
}

const xmlAttribute = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

function addInclude(file, { app, kind, category }) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(`'${category}'`)) return false;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const call = kind === 'css'
    ? `<sly data-sly-call="\${clientlib.css @ categories='${category}'}"/>`
    : `<sly data-sly-call="\${clientlib.js @ categories='${category}', defer=true}"/>`;
  const lines = text.split(/\r?\n/);
  const anchor = lines.findIndex((line) => line.includes(`categories='${app}.base'`));
  if (anchor >= 0) {
    lines.splice(anchor + 1, 0, `${/^\s*/.exec(lines[anchor])[0]}${call}`);
  } else {
    lines.push('<sly data-sly-use.clientlib="core/wcm/components/commons/v1/templates/clientlib.html">', `    ${call}`, '</sly>', '');
  }
  fs.writeFileSync(file, lines.join(eol), 'utf8');
  return true;
}

/**
 * Writes the scaffold and returns every file it wrote, plus the filter roots it added. Pages and
 * fragment contents are composed later; this only guarantees they have somewhere to go.
 */
export function writeScaffold({ repoRoot, names, siteTitle }) {
  const written = [];
  const {
    app, conf, sourceTemplate, templatePath, xfRoot, damPath, siteRoot, clientlibCategory,
  } = names;

  // Template: a fresh copy of the project's, so a rerun never builds on its own earlier output.
  const from = path.dirname(contentFile(repoRoot, sourceTemplate));
  const to = path.dirname(contentFile(repoRoot, templatePath));
  // Named explicitly with --template, the site's own template is rewritten in place, never deleted.
  if (path.resolve(from) !== path.resolve(to)) copyTree(from, to);
  const templateNode = contentFile(repoRoot, templatePath);
  const template = parseJcrXml(fs.readFileSync(templateNode, 'utf8'));
  const templateContent = findPath(template.root, ['jcr:content']);
  setAttribute(templateContent, 'jcr:title', toJcrValue(`${siteTitle} Page`));
  setAttribute(templateContent, 'jcr:description', toJcrValue(`Pages migrated from ${siteTitle}`));
  fs.writeFileSync(templateNode, serializeJcrXml(template), 'utf8');
  rewriteTemplateDocument(contentFile(repoRoot, `${templatePath}/structure`), { templatePath, xfRoot, app, withFragments: true });
  rewriteTemplateDocument(contentFile(repoRoot, `${templatePath}/initial`), { templatePath, xfRoot, app, withFragments: false });
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else written.push(relative(repoRoot, file));
    }
  };
  walk(to);

  // Fragments: the folder, one fragment per slot, and an empty master variation in each.
  writeText(repoRoot, contentFile(repoRoot, xfRoot), `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NAMESPACES}
    cq:adobeTargetExportFormat="html"
    jcr:primaryType="sling:OrderedFolder"
    jcr:title="${xmlAttribute(siteTitle)}">
${CHROME_SLOTS.map((slot) => `    <${slot}/>`).join('\n')}
</jcr:root>
`, written);
  for (const slot of CHROME_SLOTS) {
    const title = `${slot[0].toUpperCase()}${slot.slice(1)}`;
    writeText(repoRoot, contentFile(repoRoot, `${xfRoot}/${slot}`), `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NAMESPACES}
    jcr:primaryType="cq:Page">
    <jcr:content
        cq:template="/libs/cq/experience-fragments/components/experiencefragment/template"
        jcr:primaryType="cq:PageContent"
        jcr:title="${xmlAttribute(`${siteTitle} ${title}`)}"
        sling:resourceType="cq/experience-fragments/components/experiencefragment"/>
    <master/>
</jcr:root>
`, written);
    // FileVault refuses an ordering-only <master/> with no folder behind it; compose fills it later.
    const master = contentFile(repoRoot, `${xfRoot}/${slot}/master`);
    if (!fs.existsSync(master)) writeText(repoRoot, master, fragmentMasterXml({ conf, app, title }), written);
    else written.push(relative(repoRoot, master));
  }

  // The clientlib every component declares its CSS and JS into, loaded on every page.
  const clientlib = path.join(repoRoot, APPS_ROOT, app, 'clientlibs', COMPONENT_CLIENTLIB);
  writeText(repoRoot, path.join(clientlib, '.content.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:ClientLibraryFolder"
    allowProxy="{Boolean}true"
    categories="[${clientlibCategory}]"/>
`, written);
  const page = path.join(repoRoot, APPS_ROOT, app, 'components', 'page');
  for (const [file, kind] of [['customheaderlibs.html', 'css'], ['customfooterlibs.html', 'js']]) {
    if (addInclude(path.join(page, file), { app, kind, category: clientlibCategory })) {
      written.push(relative(repoRoot, path.join(page, file)));
    }
  }

  const filters = [siteRoot, templatePath, xfRoot, damPath]
    .filter((jcrPath) => ensureFilterRoot({ repoRoot, filterPath: CONTENT_FILTER, jcrPath }));
  if (filters.length) written.push(CONTENT_FILTER);
  return { written: [...new Set(written)], filters };
}
