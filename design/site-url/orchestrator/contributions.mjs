/**
 * Shared-file composer. Component workers never edit the page, the experience fragments,
 * the policies or the clientlib indexes; they declare what they need and this module writes
 * those files deterministically from the plan.
 *
 * Ordering comes from the plan's `order_index`, never from the order workers finished in,
 * so a parallel run and a serial run produce byte-identical output.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  createNode, ensurePath, escapeJcrValue, getAttribute, parseJcrList, parseJcrXml,
  serializeJcrXml, setAttribute, toJcrValue,
} from './jcr-xml.mjs';

const JCR_ROOT_NAMESPACES = [
  ['xmlns:sling', 'http://sling.apache.org/jcr/sling/1.0'],
  ['xmlns:cq', 'http://www.day.com/jcr/cq/1.0'],
  ['xmlns:jcr', 'http://www.jcp.org/jcr/1.0'],
  ['xmlns:nt', 'http://www.jcp.org/jcr/nt/1.0'],
];

function buildNode(declaration) {
  const properties = { 'jcr:primaryType': 'nt:unstructured', ...(declaration.properties || {}) };
  if (declaration.resource_type) properties['sling:resourceType'] = declaration.resource_type;
  const children = (declaration.children || []).map(buildNode);
  return createNode(declaration.name, properties, children);
}

function uniqueNodeName(bucket, preferred, componentId) {
  const taken = new Set(bucket.map((entry) => entry.node.name));
  if (!taken.has(preferred)) return preferred;
  if (!taken.has(componentId)) return componentId;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${componentId}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Collects every worker's declarations, keyed by target, and reports genuine disagreements.
 * Additive list properties merge as an ordered union; conflicting scalars are never resolved.
 */
export function collectContributions(plan, results, { instanceOrder } = {}) {
  const order = new Map(plan.components.map((component, index) => [component.id, index]));
  const sorted = [...results].sort((left, right) => (order.get(left.component_id) ?? 0) - (order.get(right.component_id) ?? 0));

  const nodesByTarget = new Map();
  const policies = new Map();
  const additions = new Map();
  const clientlibEntries = [];
  const jsEntries = [];
  const renames = [];
  const conflicts = [];

  for (const result of sorted) {
    const component = plan.components.find((entry) => entry.id === result.component_id);
    if (!component) {
      conflicts.push({ kind: 'unknown-component', component: result.component_id });
      continue;
    }
    const contributions = result.contributions || {};

    // A component claiming several instances places several nodes, so a declaration may be a list.
    const declarations = [contributions.page_node, contributions.experience_fragment_node]
      .filter(Boolean)
      .flatMap((declaration) => (Array.isArray(declaration) ? declaration : [declaration]));

    for (const [position, declaration] of declarations.entries()) {
      const target = component.contribution.path;
      if (!declaration?.name) {
        conflicts.push({
          kind: 'unnamed-node',
          target,
          component: component.id,
          detail: `declaration ${position + 1} of ${declarations.length} has no "name"`,
        });
        continue;
      }
      if (!nodesByTarget.has(target)) nodesByTarget.set(target, []);
      if (declaration.instance && instanceOrder && !instanceOrder.has(declaration.instance)) {
        conflicts.push({
          kind: 'unknown-instance',
          target,
          component: component.id,
          detail: `node "${declaration.name}" renders instance ${declaration.instance}, which is not in the frozen evidence`,
        });
        continue;
      }
      // Page order belongs to the source, not to a number an agent picked.
      const orderIndex = (declaration.instance ? instanceOrder?.get(declaration.instance) : undefined)
        ?? declaration.order_index
        ?? (declarations.length > 1 ? undefined : component.contribution.order_index)
        ?? order.get(component.id);
      const bucket = nodesByTarget.get(target);
      // Two components can independently pick one node name; the JCR needs a single winner, so this
      // resolves rather than failing a run that is otherwise complete.
      const name = uniqueNodeName(bucket, declaration.name, component.id);
      if (name !== declaration.name) {
        renames.push({ component: component.id, from: declaration.name, to: name });
      }
      bucket.push({
        component: component.id,
        order_index: orderIndex,
        plan_index: order.get(component.id) ?? 0,
        sub_index: position,
        node: buildNode({ ...declaration, name }),
      });
    }

    for (const policy of contributions.policies || []) {
      const existing = policies.get(policy.path);
      if (!existing) {
        policies.set(policy.path, { component: component.id, properties: { ...policy.properties } });
        continue;
      }
      for (const [key, value] of Object.entries(policy.properties || {})) {
        if (!(key in existing.properties)) {
          existing.properties[key] = value;
        } else if (JSON.stringify(existing.properties[key]) !== JSON.stringify(value)) {
          conflicts.push({
            kind: 'policy-conflict',
            target: policy.path,
            property: key,
            component: component.id,
            other: existing.component,
            values: [existing.properties[key], value],
          });
        }
      }
    }

    for (const addition of contributions.policy_additions || []) {
      const key = `${addition.path}::${addition.property}`;
      if (!additions.has(key)) {
        additions.set(key, { path: addition.path, property: addition.property, values: [], components: [] });
      }
      const entry = additions.get(key);
      for (const value of addition.values || []) {
        if (!entry.values.includes(value)) entry.values.push(value);
      }
      entry.components.push(component.id);
    }

    for (const entry of contributions.clientlib_entries || []) {
      if (!clientlibEntries.includes(entry)) clientlibEntries.push(entry);
    }
    for (const entry of contributions.js_entries || []) {
      if (!jsEntries.includes(entry)) jsEntries.push(entry);
    }
  }

  for (const bucket of nodesByTarget.values()) {
    // A total order, so two components can never deadlock the page over one slot.
    bucket.sort((left, right) => left.order_index - right.order_index
      || left.plan_index - right.plan_index
      || left.sub_index - right.sub_index
      || left.node.name.localeCompare(right.node.name));
  }

  return {
    nodesByTarget, policies, additions, clientlibEntries, jsEntries, renames, conflicts,
  };
}

/** Builds a page or experience-fragment document from scratch so output cannot drift. */
export function composeDocument(target, nodes) {
  const rootAttributes = [...JCR_ROOT_NAMESPACES];  const container = createNode(
    target.container?.name || 'root',
    {
      'jcr:primaryType': 'nt:unstructured',
      'sling:resourceType': target.container?.resource_type,
      layout: target.container?.layout,
    },
    [],
  );

  let host = container;
  for (const segment of target.container?.nested || []) {
    const child = createNode(segment.name, {
      'jcr:primaryType': 'nt:unstructured',
      'sling:resourceType': segment.resource_type,
      layout: segment.layout,
    }, []);
    host.children.push(child);
    host = child;
  }
  host.children.push(...nodes.map((entry) => entry.node));

  const jcrContent = createNode('jcr:content', {
    'jcr:primaryType': target.primary_type === 'cq:Page' ? 'cq:PageContent' : 'nt:unstructured',
    'sling:resourceType': target.resource_type,
    ...target.properties,
  }, [container]);

  const root = createNode('jcr:root', { 'jcr:primaryType': target.primary_type || 'cq:Page' }, [jcrContent]);
  root.attributes = [...rootAttributes, ...root.attributes];
  return { declaration: '<?xml version="1.0" encoding="UTF-8"?>', root, eol: target.eol || '\n' };
}

/** Merges declared policy nodes into the existing policies document without reordering it. */
export function mergePolicies(document, policies, additions) {
  const written = [];
  for (const [policyPath, entry] of policies) {
    const segments = policyPath.split('/').filter(Boolean);
    const target = ensurePath(document.root, segments);
    for (const [key, value] of Object.entries(entry.properties || {})) {
      setAttribute(target, key, toJcrValue(value));
    }
    if (!target.children.some((child) => child.name === 'jcr:content')) {
      target.children.push(createNode('jcr:content', { 'jcr:primaryType': 'nt:unstructured' }));
    }
    written.push(policyPath);
  }

  for (const entry of additions.values()) {
    const segments = entry.path.split('/').filter(Boolean);
    const target = ensurePath(document.root, segments);
    const current = parseJcrList(getAttribute(target, entry.property));
    const merged = [...current];
    for (const value of entry.values) {
      if (!merged.includes(value)) merged.push(value);
    }
    setAttribute(target, entry.property, toJcrValue(merged));
    written.push(`${entry.path}#${entry.property}`);
  }
  return written;
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function existingEol(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8').includes('\r\n') ? '\r\n' : '\n';
}

const DEFAULT_CONTENT_ROOT = 'ui.content/src/main/content/jcr_root';

/**
 * `/content/site/page/jcr:content/root/container` names both the file foundations wrote and the
 * node inside it, so the planner never has to restate a structure the path already encodes.
 */
function deriveComposeTarget(targetPath, contentRoot = DEFAULT_CONTENT_ROOT) {
  const [documentPath, inner] = String(targetPath).split('/jcr:content');
  if (!documentPath || inner === undefined) return null;
  return {
    file: `${contentRoot}${documentPath}/.content.xml`,
    node_path: ['jcr:content', ...inner.split('/').filter(Boolean)],
  };
}

function findNodePath(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = current?.children.find((child) => child.name === segment);
    if (!current) return null;
  }
  return current;
}

/**
 * Everything compose needs that does not depend on worker output. Run straight after foundations
 * so a structural mistake costs seconds instead of a whole fan-out.
 */
export function verifyComposeTargets({ repoRoot, plan }) {
  const shared = plan.shared || {};
  const problems = [];
  const seen = new Set();

  for (const component of plan.components || []) {
    const targetPath = component.contribution?.path;
    if (!targetPath || seen.has(targetPath)) continue;
    seen.add(targetPath);
    if ((shared.compose_targets || {})[targetPath]?.file) continue;

    const derived = deriveComposeTarget(targetPath, shared.content_root);
    if (!derived) {
      problems.push(`${targetPath} has no /jcr:content segment, so no file can be derived for it`);
      continue;
    }
    const absolute = path.join(repoRoot, derived.file);
    if (!fs.existsSync(absolute)) {
      problems.push(`${derived.file} is missing, so ${targetPath} has nowhere to compose into`);
      continue;
    }
    let document;
    try {
      document = parseJcrXml(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
      problems.push(`${derived.file} could not be parsed: ${error.message}`);
      continue;
    }
    if (!findNodePath(document.root, derived.node_path)) {
      problems.push(`${derived.node_path.join('/')} is not present in ${derived.file}`);
    }
  }

  if (shared.policies_file && !fs.existsSync(path.join(repoRoot, shared.policies_file))) {
    problems.push(`${shared.policies_file} is missing, so declared policies cannot be merged`);
  }

  return problems;
}

/** Per-worker checks, run at attempt time so a rejection still has retries left. */
export function validateContribution(component, result, { instanceOrder, writtenFiles } = {}) {
  const contributions = result?.contributions || {};
  const declarations = [contributions.page_node, contributions.experience_fragment_node]
    .filter(Boolean)
    .flatMap((declaration) => (Array.isArray(declaration) ? declaration : [declaration]));
  const problems = [];

  if (!declarations.length) {
    problems.push('You declared no `page_node` or `experience_fragment_node`, so your component would '
      + 'never appear on the page.');
  }

  const claimed = new Set(component.instances || []);
  declarations.forEach((declaration, index) => {
    const label = declaration?.name ? `"${declaration.name}"` : `declaration ${index + 1}`;
    if (!declaration?.name) problems.push(`${label} has no "name".`);
    if (!declaration?.instance) return;
    if (instanceOrder && !instanceOrder.has(declaration.instance)) {
      problems.push(`${label} names instance ${declaration.instance}, which is not in the frozen evidence.`);
    } else if (claimed.size && !claimed.has(declaration.instance)) {
      problems.push(`${label} renders ${declaration.instance}, which belongs to another component. `
        + `You claim: ${[...claimed].join(', ')}.`);
    }
  });

  const names = declarations.map((declaration) => declaration?.name).filter(Boolean);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) problems.push(`Two of your nodes are both named "${duplicate}".`);

  // A node pointing at a resource type nobody built renders as an empty div, not as an error.
  for (const declaration of declarations) {
    if (!declaration?.resource_type || !component.resource_type) continue;
    if (declaration.resource_type !== component.resource_type) {
      problems.push(`"${declaration.name}" declares resource_type ${declaration.resource_type}, `
        + `but your component is ${component.resource_type}.`);
    }
  }

  // An index entry with no file behind it breaks the whole clientlib, not just this component.
  if (writtenFiles) {
    const written = writtenFiles.map((entry) => String(entry).replaceAll('\\', '/'));
    for (const entry of [...(contributions.clientlib_entries || []), ...(contributions.js_entries || [])]) {
      if (!written.some((candidate) => candidate.endsWith(`/${entry}`))) {
        problems.push(`You declared clientlib entry "${entry}", but wrote no file with that name.`);
      }
    }
  }

  return problems;
}

/**
 * Writes every shared artifact from the collected declarations.
 * Returns the files written plus any conflict that stopped a write.
 */
export function applyContributions({ repoRoot, plan, results, instanceOrder }) {
  const collected = collectContributions(plan, results, { instanceOrder });
  const shared = plan.shared || {};
  const written = [];

  if (collected.conflicts.length) {
    return { written, conflicts: collected.conflicts, collected };
  }

  for (const [targetPath, nodes] of collected.nodesByTarget) {
    const explicit = (shared.compose_targets || {})[targetPath];
    if (explicit?.file) {
      const absolute = path.join(repoRoot, explicit.file);
      const eol = explicit.eol || existingEol(absolute) || shared.eol || '\n';
      const document = composeDocument({ ...explicit, eol }, nodes);
      written.push(writeFile(absolute, serializeJcrXml(document)));
      continue;
    }

    const derived = deriveComposeTarget(targetPath, shared.content_root);
    if (!derived) {
      collected.conflicts.push({
        kind: 'missing-compose-target',
        target: targetPath,
        detail: 'no compose_targets entry, and the path has no /jcr:content segment to derive one from',
      });
      continue;
    }
    const absolute = path.join(repoRoot, derived.file);
    if (!fs.existsSync(absolute)) {
      collected.conflicts.push({
        kind: 'missing-compose-file',
        target: targetPath,
        detail: `${derived.file} does not exist; foundations must write the page or fragment skeleton first`,
      });
      continue;
    }
    const document = parseJcrXml(fs.readFileSync(absolute, 'utf8'));
    const container = findNodePath(document.root, derived.node_path);
    if (!container) {
      collected.conflicts.push({
        kind: 'missing-container',
        target: targetPath,
        detail: `${derived.node_path.join('/')} is not present in ${derived.file}`,
      });
      continue;
    }
    // The container is authored empty, so replacing its children keeps re-runs byte-identical.
    container.children = nodes.map((entry) => entry.node);
    written.push(writeFile(absolute, serializeJcrXml(document)));
  }

  if (shared.policies_file && (collected.policies.size || collected.additions.size)) {
    const policiesPath = path.join(repoRoot, shared.policies_file);
    if (!fs.existsSync(policiesPath)) {
      collected.conflicts.push({
        kind: 'missing-policies-file',
        target: shared.policies_file,
        detail: 'declared policies cannot be merged into a file that does not exist',
      });
    } else {
      const document = parseJcrXml(fs.readFileSync(policiesPath, 'utf8'));
      mergePolicies(document, collected.policies, collected.additions);
      written.push(writeFile(policiesPath, serializeJcrXml(document)));
    }
  }

  for (const [indexPath, header, entries] of [
    [shared.clientlib_index, shared.clientlib_index_header || '#base=css', collected.clientlibEntries],
    [shared.clientlib_js_index, shared.clientlib_js_index_header || '#base=js', collected.jsEntries],
  ]) {
    if (!indexPath || !entries.length) continue;
    const contents = `${[header, ...entries].join('\n')}\n`;
    written.push(writeFile(path.join(repoRoot, indexPath), contents));
  }

  return { written, conflicts: collected.conflicts, collected };
}

export { escapeJcrValue };
