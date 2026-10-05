/**
 * Site plan gate and expansion. The planner only names components and the catalog groups each one
 * renders. Everything that can be checked or derived is done here: every unit placed exactly once,
 * generic names, a buildable reuse tier, acyclic dependencies, and each component's owned paths,
 * resource type and placement, so no agent ever has to restate the project's layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitUnitId } from './catalog.mjs';
import { computeWaves, SHARED_PATH_PATTERNS } from './plan.mjs';
import { validate } from './schema.mjs';

const schemaDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'schemas');
const sitePlanSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'site-plan.schema.json'), 'utf8'));

export const APPS_ROOT = 'ui.apps/src/main/content/jcr_root/apps';
export const COMPONENT_CLIENTLIB = 'clientlib-components';
/** Core Component proxies whose content the orchestrator authors straight from the capture. */
export const MAPPED_KINDS = {
  text: new Set(['heading', 'list']),
  title: new Set(['heading']),
  image: new Set(['media']),
};

const HOST_NOISE = new Set(['www', 'com', 'net', 'org', 'info', 'biz', 'site', 'online', 'shop', 'store', 'web', 'app']);
const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'float', 'for', 'goto',
  'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'package',
  'private', 'protected', 'public', 'record', 'return', 'short', 'static', 'strictfp', 'super', 'switch',
  'synchronized', 'this', 'throw', 'throws', 'transient', 'true', 'try', 'var', 'void', 'volatile', 'while', 'yield',
]);

/** Words a component id may not contain: the site's own name, so components outlive the brand. */
export function brandTokens(siteUrl) {
  let host = '';
  try {
    host = new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return [];
  }
  return host.split('.').slice(0, -1).filter((label) => label.length >= 4 && !HOST_NOISE.has(label))
    .map((label) => label.replace(/-/g, ''));
}

export function javaPackageName(id) {
  const name = id.replace(/-/g, '');
  return JAVA_KEYWORDS.has(name) ? `${name}component` : name;
}

export const pascalName = (id) => id.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join('');

/** Every file a component's worker may write, derived rather than planned so scopes cannot overlap. */
export function ownedPathsFor(component, { app, javaRoot }) {
  if (component.authoring === 'mapped') return [];
  const clientlib = `${APPS_ROOT}/${app}/clientlibs/${COMPONENT_CLIENTLIB}`;
  const owned = [];
  if (component.tier >= 2) owned.push(`${APPS_ROOT}/${app}/components/${component.id}`);
  owned.push(`${clientlib}/css/${component.id}.css`, `${clientlib}/js/${component.id}.js`);
  if (component.tier >= 2 && component.java !== false) {
    const pkg = javaPackageName(component.id);
    owned.push(`core/src/main/java/${javaRoot}/${pkg}`, `core/src/test/java/${javaRoot}/${pkg}`, `core/src/test/resources/${javaRoot}/${pkg}`);
  }
  return owned;
}

const componentDir = (repoRoot, app, name) => path.join(repoRoot, APPS_ROOT, app, 'components', ...name.split('/'));

export function validateSitePlan(sitePlan, {
  catalog, runId, app, repoRoot, siteUrl, builtByRun = new Set(),
}) {
  const schemaErrors = validate(sitePlan, sitePlanSchema);
  if (schemaErrors.length) return { valid: false, errors: schemaErrors.slice(0, 20), waves: [], assignment: new Map() };
  const errors = [];

  if (runId && sitePlan.run_id !== runId) errors.push(`run_id ${sitePlan.run_id} does not belong to run ${runId}`);
  if (sitePlan.catalog_fingerprint !== catalog.fingerprint) {
    errors.push('catalog_fingerprint does not match catalog.json; the plan was built from a stale catalog');
  }

  const ids = sitePlan.components.map((component) => component.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) errors.push(`duplicate component ids: ${duplicates.join(', ')}`);
  const brands = brandTokens(siteUrl);
  for (const id of ids) {
    const brand = brands.find((token) => id.replace(/-/g, '').includes(token));
    if (brand) errors.push(`${id} carries the site's name "${brand}"; component names must be generic`);
  }

  const groupIds = new Map(catalog.groups.map((group) => [group.id, group]));
  const chromeIds = new Map(catalog.chrome.map((entry) => [entry.id, entry]));
  const owner = new Map();
  for (const component of sitePlan.components) {
    const slots = new Set();
    for (const id of component.groups) {
      if (component.role === 'chrome' && !chromeIds.has(id)) {
        errors.push(`${component.id} is chrome, so it renders chrome entries (c-…), not ${id}`);
        continue;
      }
      if (component.role === 'content' && !groupIds.has(id)) {
        errors.push(chromeIds.has(id)
          ? `${id} is site chrome; give it to a component with role "chrome", not to ${component.id}`
          : `${component.id} names unknown group ${id}`);
        continue;
      }
      if (owner.has(id)) errors.push(`${id} is claimed by both ${owner.get(id)} and ${component.id}`);
      owner.set(id, component.id);
      if (chromeIds.has(id)) slots.add(chromeIds.get(id).slot);
    }
    if (slots.size > 1) errors.push(`${component.id} renders both header and footer chrome; one fragment slot per component`);
  }
  for (const group of catalog.groups) {
    if (!owner.has(group.id)) {
      errors.push(`group ${group.id} (${group.count} unit(s), e.g. "${catalog.units[group.members[0]]?.label}") is not assigned to any component`);
    }
  }
  for (const entry of catalog.chrome) {
    if (!owner.has(entry.id)) errors.push(`chrome ${entry.id} (${entry.slot}, "${entry.label}") is not assigned to any component`);
  }

  const moved = new Map();
  for (const component of sitePlan.components) {
    for (const id of component.units || []) {
      const unit = catalog.units[id];
      if (!unit) errors.push(`${component.id} names unknown unit ${id}`);
      else if (unit.chrome) errors.push(`${id} is chrome and travels with ${unit.chrome}; it cannot be moved on its own`);
      else if (component.role === 'chrome') errors.push(`${component.id} is chrome and cannot take content unit ${id}`);
      if (moved.has(id)) errors.push(`unit ${id} is moved into both ${moved.get(id)} and ${component.id}`);
      moved.set(id, component.id);
    }
  }
  const assignment = new Map();
  for (const unit of Object.values(catalog.units)) {
    const assigned = moved.get(unit.id) ?? owner.get(unit.chrome || unit.group);
    if (assigned) assignment.set(unit.id, assigned);
  }
  const byComponent = new Map(ids.map((id) => [id, []]));
  for (const [unit, id] of assignment) byComponent.get(id)?.push(unit);

  for (const component of sitePlan.components) {
    const units = byComponent.get(component.id) || [];
    if (!units.length) errors.push(`${component.id} renders no unit once moves are applied`);
    const authoring = component.authoring || 'worker';
    const target = component.reuse_target || null;
    const local = target?.startsWith(`${app}/components/`) ? target.slice(`${app}/components/`.length) : null;
    if (component.tier <= 2) {
      if (!local) errors.push(`${component.id} is tier ${component.tier}, so reuse_target must be a project component (${app}/components/<name>), not ${target}`);
      else if (!fs.existsSync(path.join(componentDir(repoRoot, app, local), '.content.xml'))) {
        errors.push(`${component.id} reuses ${target}, which does not exist in ui.apps`);
      }
    }
    if (component.tier === 3 && !/^core\/wcm\/components\/[a-z-]+(\/[a-z-]+)?\/v\d+\/[a-z-]+$/.test(target || '')) {
      errors.push(`${component.id} is tier 3, so reuse_target must be a Core Component such as core/wcm/components/teaser/v2/teaser, not ${target}`);
    }
    if (component.tier >= 2 && fs.existsSync(componentDir(repoRoot, app, component.id)) && !builtByRun.has(component.id)) {
      errors.push(`${component.id} would overwrite the existing component apps/${app}/components/${component.id}; `
        + 'pick another id, or reuse it at tier 1 or 2');
    }
    if (authoring === 'mapped') {
      const kind = local && Object.hasOwn(MAPPED_KINDS, local) ? MAPPED_KINDS[local] : null;
      if (component.tier !== 1 || component.role !== 'content' || !kind) {
        errors.push(`${component.id} is mapped, which only a tier 1 content component reusing ${app}/components/{${Object.keys(MAPPED_KINDS).join(',')}} can be`);
      } else {
        for (const unit of units) {
          const extra = catalog.units[unit].features.filter((feature) => !kind.has(feature));
          if (extra.length) {
            errors.push(`${component.id} maps units onto ${local}, but ${unit} also holds ${extra.join(', ')}; give it a worker or another component`);
            break;
          }
        }
      }
    }
  }

  const known = new Set(ids);
  for (const component of sitePlan.components) {
    for (const dependency of component.depends_on || []) {
      if (!known.has(dependency)) errors.push(`${component.id} depends on unknown component ${dependency}`);
      if (dependency === component.id) errors.push(`${component.id} depends on itself`);
    }
  }
  const workers = sitePlan.components.filter((component) => (component.authoring || 'worker') === 'worker');
  const workerIds = new Set(workers.map((component) => component.id));
  const { waves, unresolved } = computeWaves(workers.map((component) => ({
    ...component, depends_on: (component.depends_on || []).filter((dependency) => workerIds.has(dependency)),
  })));
  if (unresolved.length) errors.push(`dependency cycle between: ${unresolved.join(', ')}`);

  for (const component of workers) {
    for (const owned of ownedPathsFor(component, { app, javaRoot: 'x' })) {
      if (SHARED_PATH_PATTERNS.some((pattern) => pattern.test(owned))) errors.push(`${component.id} would own shared path ${owned}`);
    }
  }

  return { valid: errors.length === 0, errors, waves, assignment };
}

/** Units in page order, pages in tree order: the order every list in the expanded plan follows. */
function orderedUnits(catalog) {
  return catalog.pages.flatMap((page) => page.units);
}

/** The plan every later phase works from, in the shape the fan-out already understands. */
export function expandSitePlan(sitePlan, {
  catalog, gate, app, javaRoot, siteRoot, xfRoot, container, breakpoints, componentGroup,
}) {
  const order = orderedUnits(catalog);
  const position = new Map(order.map((id, index) => [id, index]));
  const chromeIds = new Map(catalog.chrome.map((entry) => [entry.id, entry]));
  const groupIds = new Map(catalog.groups.map((group) => [group.id, group]));
  const javaPackage = javaRoot.replaceAll('/', '.');

  const components = sitePlan.components.map((component) => {
    const authoring = component.authoring || 'worker';
    const instances = [...gate.assignment].filter(([, id]) => id === component.id).map(([unit]) => unit)
      .sort((a, b) => position.get(a) - position.get(b));
    const chromeEntries = component.groups.filter((id) => chromeIds.has(id)).map((id) => chromeIds.get(id));
    const examples = [];
    const seenPages = new Set();
    const candidates = [
      ...component.groups.flatMap((id) => groupIds.get(id)?.examples || chromeIds.get(id)?.representative || []),
      ...(component.units || []),
    ].filter((id) => instances.includes(id));
    for (const id of candidates) {
      if (examples.length >= 4 || seenPages.has(splitUnitId(id).page)) continue;
      seenPages.add(splitUnitId(id).page);
      examples.push(id);
    }
    for (const id of instances) {
      if (examples.length >= Math.min(3, instances.length)) break;
      if (!examples.includes(id)) examples.push(id);
    }
    const slot = chromeEntries[0]?.slot || null;
    return {
      id: component.id,
      title: component.title,
      tier: component.tier,
      role: component.role,
      authoring,
      reuse_target: component.reuse_target || null,
      resource_type: component.tier >= 2 ? `${app}/components/${component.id}` : component.reuse_target,
      ...(slot ? { chrome_slot: slot, chrome_entries: chromeEntries.map((entry) => ({ id: entry.id, representative: entry.representative })) } : {}),
      groups: component.groups,
      instances,
      examples,
      owned_paths: ownedPathsFor({ ...component, authoring }, { app, javaRoot }),
      java_package: component.tier >= 2 && component.java !== false ? `${javaPackage}.${javaPackageName(component.id)}` : null,
      contribution: slot
        ? { kind: 'experience-fragment', path: `${xfRoot}/${slot}/master/jcr:content/root` }
        : { kind: 'page-fragment', path: `${siteRoot}/*/jcr:content/${container}` },
      depends_on: component.depends_on || [],
      notes: component.notes || '',
    };
  });

  return {
    mode: 'site',
    run_id: sitePlan.run_id,
    source_fingerprint: catalog.fingerprint,
    breakpoints,
    shared: {
      app,
      site_root: siteRoot,
      xf_root: xfRoot,
      container,
      component_group: componentGroup,
      clientlib_root: `${APPS_ROOT}/${app}/clientlibs/${COMPONENT_CLIENTLIB}`,
      clientlib_index: `${APPS_ROOT}/${app}/clientlibs/${COMPONENT_CLIENTLIB}/css.txt`,
      clientlib_js_index: `${APPS_ROOT}/${app}/clientlibs/${COMPONENT_CLIENTLIB}/js.txt`,
    },
    components,
    waves: gate.waves,
  };
}

const dataUrl = /^data:/i;

/** DAM paths a node tree authors, at any depth, so a made-up asset is caught before it ships. */
export function damReferences(node, found = []) {
  for (const value of Object.values(node?.properties || {})) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry === 'string' && entry.startsWith('/content/dam/')) found.push(entry);
    }
  }
  for (const child of node?.children || []) damReferences(child, found);
  return found;
}

/**
 * Site-mode checks on one worker's contributions, on top of the page-mode ones: every unit it
 * claims gets exactly one node, chrome is authored once per fragment, and every DAM path exists.
 */
export function checkSiteContribution(component, result, { damPaths }) {
  const contributions = result?.contributions || {};
  const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const pageNodes = asList(contributions.page_node);
  const fragmentNodes = asList(contributions.experience_fragment_node);
  const problems = [];

  if (component.role === 'chrome') {
    if (pageNodes.length) problems.push('You are chrome: declare `experience_fragment_node`, never `page_node`.');
    const wanted = (component.chrome_entries || []).map((entry) => entry.representative);
    const declared = fragmentNodes.map((node) => node?.instance);
    for (const instance of wanted) {
      const count = declared.filter((entry) => entry === instance).length;
      if (count !== 1) problems.push(`Declare exactly one experience_fragment_node with instance "${instance}"; found ${count}.`);
    }
    const extra = declared.filter((instance) => !wanted.includes(instance));
    if (extra.length) problems.push(`Only ${wanted.join(', ')} are authored into the fragment; drop ${extra.join(', ')}.`);
  } else {
    if (fragmentNodes.length) problems.push('You are page content: declare `page_node`, never `experience_fragment_node`.');
    const declared = pageNodes.map((node) => node?.instance);
    const missing = component.instances.filter((instance) => !declared.includes(instance));
    const repeated = [...new Set(declared.filter((instance, index) => instance && declared.indexOf(instance) !== index))];
    const untagged = pageNodes.filter((node) => !node?.instance).length;
    if (missing.length) {
      problems.push(`${missing.length} of your ${component.instances.length} units have no page_node, so those pages would lose `
        + `the block: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}.`);
    }
    if (repeated.length) problems.push(`More than one page_node renders ${repeated.join(', ')}; one node per unit.`);
    if (untagged) problems.push(`${untagged} page_node(s) carry no "instance"; tag every node with the unit it renders.`);
  }

  const known = new Set(damPaths);
  const invented = [...new Set([...pageNodes, ...fragmentNodes].flatMap((node) => damReferences(node)))]
    .filter((entry) => !known.has(entry) && !dataUrl.test(entry));
  if (invented.length) {
    problems.push(`These DAM paths are not in your assets list, so they do not exist: ${invented.slice(0, 8).join(', ')}.`);
  }
  return problems;
}
