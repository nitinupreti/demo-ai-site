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

/**
 * Collects every worker's declarations, keyed by target, and reports genuine disagreements.
 * Additive list properties merge as an ordered union; conflicting scalars are never resolved.
 */
export function collectContributions(plan, results) {
  const order = new Map(plan.components.map((component, index) => [component.id, index]));
  const sorted = [...results].sort((left, right) => (order.get(left.component_id) ?? 0) - (order.get(right.component_id) ?? 0));

  const nodesByTarget = new Map();
  const policies = new Map();
  const additions = new Map();
  const clientlibEntries = [];
  const scssImports = [];
  const conflicts = [];

  for (const result of sorted) {
    const component = plan.components.find((entry) => entry.id === result.component_id);
    if (!component) {
      conflicts.push({ kind: 'unknown-component', component: result.component_id });
      continue;
    }
    const contributions = result.contributions || {};

    for (const declaration of [contributions.page_node, contributions.experience_fragment_node].filter(Boolean)) {
      const target = component.contribution.path;
      if (!nodesByTarget.has(target)) nodesByTarget.set(target, []);
      const orderIndex = declaration.order_index ?? component.contribution.order_index ?? order.get(component.id);
      const bucket = nodesByTarget.get(target);
      const clash = bucket.find((entry) => entry.order_index === orderIndex || entry.node.name === declaration.name);
      if (clash) {
        conflicts.push({
          kind: 'node-collision',
          target,
          component: component.id,
          other: clash.component,
          detail: clash.node.name === declaration.name ? `both declare node "${declaration.name}"` : `both claim order_index ${orderIndex}`,
        });
        continue;
      }
      bucket.push({ component: component.id, order_index: orderIndex, node: buildNode(declaration) });
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
    for (const entry of contributions.scss_imports || []) {
      if (!scssImports.includes(entry)) scssImports.push(entry);
    }
  }

  for (const bucket of nodesByTarget.values()) {
    bucket.sort((left, right) => left.order_index - right.order_index
      || left.node.name.localeCompare(right.node.name));
  }

  return {
    nodesByTarget, policies, additions, clientlibEntries, scssImports, conflicts,
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

/**
 * Writes every shared artifact from the collected declarations.
 * Returns the files written plus any conflict that stopped a write.
 */
export function applyContributions({ repoRoot, plan, results }) {
  const collected = collectContributions(plan, results);
  const shared = plan.shared || {};
  const written = [];

  if (collected.conflicts.length) {
    return { written, conflicts: collected.conflicts, collected };
  }

  for (const [targetPath, nodes] of collected.nodesByTarget) {
    const target = (shared.compose_targets || {})[targetPath];
    if (!target?.file) {
      collected.conflicts.push({ kind: 'missing-compose-target', target: targetPath });
      continue;
    }
    const absolute = path.join(repoRoot, target.file);
    const eol = target.eol || existingEol(absolute) || shared.eol || '\n';
    const document = composeDocument({ ...target, eol }, nodes);
    written.push(writeFile(absolute, serializeJcrXml(document)));
  }

  if (shared.policies_file && (collected.policies.size || collected.additions.size)) {
    const policiesPath = path.join(repoRoot, shared.policies_file);
    const document = parseJcrXml(fs.readFileSync(policiesPath, 'utf8'));
    mergePolicies(document, collected.policies, collected.additions);
    written.push(writeFile(policiesPath, serializeJcrXml(document)));
  }

  if (shared.clientlib_index && collected.clientlibEntries.length) {
    const header = shared.clientlib_index_header || '#base=css';
    const contents = `${[header, ...collected.clientlibEntries].join('\n')}\n`;
    written.push(writeFile(path.join(repoRoot, shared.clientlib_index), contents));
  }

  if (shared.scss_index && collected.scssImports.length) {
    const contents = `${collected.scssImports.map((entry) => `@import "${entry}";`).join('\n')}\n`;
    written.push(writeFile(path.join(repoRoot, shared.scss_index), contents));
  }

  return { written, conflicts: collected.conflicts, collected };
}

export { escapeJcrValue };
