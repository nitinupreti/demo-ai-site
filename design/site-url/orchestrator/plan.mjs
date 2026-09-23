/**
 * Plan gate. A plan that reaches fan-out must prove: every discovered instance is claimed
 * exactly once, no two components can write the same file, chrome is delivered through
 * Experience Fragments, and the dependency graph is acyclic. Waves are computed here,
 * never taken on trust from the planner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from './schema.mjs';

const schemaDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'schemas');
const planSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'plan.schema.json'), 'utf8'));

/**
 * Files no component worker may ever own; they belong to the serialized shared phase.
 * Written against the AEM Maven archetype layout. A project with different module or
 * clientlib names can pass its own list as `sharedPatterns` to validatePlan, or extend
 * these through `plan.shared.protected_paths`.
 */
export const SHARED_PATH_PATTERNS = [
  /^[^/]*ui\.content\/src\/main\/content\/jcr_root\/conf\//,
  /^[^/]*ui\.content\/src\/main\/content\/jcr_root\/content\/(?!experience-fragments)/,
  /^[^/]*ui\.content\/src\/main\/content\/META-INF\//,
  /^[^/]*ui\.frontend\/src\/main\/webpack\/site\//,
  /^[^/]*ui\.frontend\/src\/main\/webpack\/resources\//,
  /^[^/]*ui\.apps\/src\/main\/content\/jcr_root\/apps\/[^/]+\/clientlibs\/clientlib-(base|site)\//,
  // A clientlib's index and folder definition are composed; only the files inside css/ and js/ are ownable.
  /\/clientlibs\/[^/]+\/(css|js)\.txt$/,
  /\/clientlibs\/[^/]+\/\.content\.xml$/,
  /^[^/]*ui\.apps\/src\/main\/content\/jcr_root\/apps\/[^/]+\/components\/page\//,
  /(^|\/)pom\.xml$/,
  /(^|\/)filter\.xml$/,
];

/** Converts a glob-ish or regex-source string from configuration into a matcher. */
function toPattern(entry) {
  if (entry instanceof RegExp) return entry;
  const text = String(entry);
  if (text.startsWith('/') && text.lastIndexOf('/') > 0) {
    const end = text.lastIndexOf('/');
    return new RegExp(text.slice(1, end), text.slice(end + 1));
  }
  const escaped = text.replaceAll('\\', '/').replace(/[.+^${}()|[\]]/g, '\\$&')
    .replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}`);
}

function normalize(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function overlaps(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function computeWaves(components) {
  const byId = new Map(components.map((component) => [component.id, component]));
  const pending = new Set(byId.keys());
  const done = new Set();
  const waves = [];

  while (pending.size) {
    const ready = [...pending].filter((id) => (byId.get(id).depends_on || [])
      .every((dependency) => done.has(dependency)));
    if (!ready.length) return { waves, unresolved: [...pending] };
    ready.sort();
    waves.push(ready);
    for (const id of ready) {
      pending.delete(id);
      done.add(id);
    }
  }
  return { waves, unresolved: [] };
}

export function validatePlan(plan, { discovery, runId, sharedPatterns, pagePath } = {}) {
  const errors = [];
  const schemaErrors = validate(plan, planSchema);
  if (schemaErrors.length) {
    return { valid: false, errors: schemaErrors.slice(0, 20), waves: [] };
  }

  const protectedPatterns = [
    ...(sharedPatterns || SHARED_PATH_PATTERNS),
    ...(plan.shared?.protected_paths || []).map(toPattern),
  ];

  if (runId && plan.run_id !== runId) {
    errors.push(`plan.run_id ${plan.run_id} does not belong to run ${runId}`);
  }
  if (discovery?.source_fingerprint && plan.source_fingerprint !== discovery.source_fingerprint) {
    errors.push('plan.source_fingerprint does not match discovery.json; the plan was built from stale evidence');
  }
  // The run is scored against --target-path, so a plan that authors anywhere else is unscoreable.
  if (pagePath && plan.shared?.page_path !== pagePath) {
    errors.push(`plan.shared.page_path must be exactly ${pagePath}, the --target-path parity compares against, not ${plan.shared?.page_path ?? 'null'}`);
  }

  const ids = plan.components.map((component) => component.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) errors.push(`duplicate component ids: ${[...new Set(duplicateIds)].join(', ')}`);

  if (typeof plan.component_count === 'number' && plan.component_count !== plan.components.length) {
    errors.push(`component_count ${plan.component_count} does not match ${plan.components.length} components`);
  }

  // Every discovered instance is claimed exactly once.
  const claims = new Map();
  for (const component of plan.components) {
    for (const instance of component.instances) {
      if (!claims.has(instance)) claims.set(instance, []);
      claims.get(instance).push(component.id);
    }
  }
  for (const [instance, owners] of claims) {
    if (owners.length > 1) errors.push(`instance ${instance} is claimed by ${owners.join(' and ')}`);
  }
  if (discovery?.instances) {
    for (const instance of discovery.instances) {
      if (!claims.has(instance.id)) errors.push(`instance ${instance.id} (${instance.label || ''}) is not claimed by any component`);
    }
    const known = new Set(discovery.instances.map((instance) => instance.id));
    for (const instance of claims.keys()) {
      if (!known.has(instance)) errors.push(`instance ${instance} is not present in discovery.json`);
    }
  }

  // Ownership must be disjoint, and never shared infrastructure.
  const owned = [];
  for (const component of plan.components) {
    for (const rawPath of component.owned_paths) {
      const candidate = normalize(rawPath);
      if (candidate.includes('..')) {
        errors.push(`${component.id} owns an unsafe path: ${rawPath}`);
        continue;
      }
      const shared = protectedPatterns.find((pattern) => pattern.test(candidate));
      if (shared) errors.push(`${component.id} may not own shared path ${candidate}`);
      const clash = owned.find((entry) => overlaps(entry.path, candidate));
      if (clash) errors.push(`${component.id} and ${clash.id} both own ${candidate}`);
      owned.push({ id: component.id, path: candidate });
    }
  }

  // Global chrome must be delivered as an Experience Fragment.
  for (const component of plan.components) {
    if (component.role !== 'chrome') continue;
    if (component.contribution.kind !== 'experience-fragment') {
      errors.push(`${component.id} is chrome and must contribute an experience-fragment, not ${component.contribution.kind}`);
    }
    if (!/\/content\/experience-fragments\//.test(component.contribution.path)) {
      errors.push(`${component.id} contribution path must live under /content/experience-fragments/`);
    }
  }

  // A component that owns Java sources must own somewhere to put its unit test.
  for (const component of plan.components) {
    const owns = component.owned_paths.map(normalize);
    const ownsMain = owns.some((candidate) => /\/src\/main\/java\//.test(candidate));
    const ownsTest = owns.some((candidate) => /\/src\/test\/java\//.test(candidate));
    if (ownsMain && !ownsTest) {
      errors.push(`${component.id} owns Java sources but no src/test/java path, so it has nowhere to write the unit test its role requires`);
    }
  }

  // The composer derives the file to write from the contribution path, so it must name a node in one.
  for (const component of plan.components) {
    const target = component.contribution.path;
    if ((plan.shared?.compose_targets || {})[target]?.file) continue;
    if (!target.includes('/jcr:content')) {
      errors.push(`${component.id} contribution path ${target} has no /jcr:content segment, so no file can be derived to compose it into`);
    }
  }

  // Parity targets must cover every claimed instance at every breakpoint.
  for (const component of plan.components) {
    const covered = new Set(component.parity_targets.map((target) => target.instance));
    for (const instance of component.instances) {
      if (!covered.has(instance)) errors.push(`${component.id} has no parity target for ${instance}`);
    }
  }

  // Dependencies must resolve and must not cycle.
  const known = new Set(ids);
  for (const component of plan.components) {
    for (const dependency of component.depends_on || []) {
      if (!known.has(dependency)) errors.push(`${component.id} depends on unknown component ${dependency}`);
      if (dependency === component.id) errors.push(`${component.id} depends on itself`);
    }
  }
  const { waves, unresolved } = computeWaves(plan.components);
  if (unresolved.length) errors.push(`dependency cycle between: ${unresolved.join(', ')}`);

  return { valid: errors.length === 0, errors, waves };
}

export function planSummary(plan, waves) {
  const byTier = plan.components.reduce((accumulator, component) => {
    accumulator[component.tier] = (accumulator[component.tier] || 0) + 1;
    return accumulator;
  }, {});
  return {
    components: plan.components.length,
    instances: plan.components.reduce((total, component) => total + component.instances.length, 0),
    chrome: plan.components.filter((component) => component.role === 'chrome').map((component) => component.id),
    tiers: byTier,
    waves: waves.map((wave) => wave.length),
    wave_ids: waves,
  };
}
