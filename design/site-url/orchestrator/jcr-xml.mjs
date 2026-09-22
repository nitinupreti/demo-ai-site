/**
 * Minimal reader/writer for JCR `.content.xml` files. The dialect is a strict subset:
 * elements carry attributes only, never text, so attribute values are kept in their raw
 * escaped form and round-trip unchanged.
 */

export function parseJcrXml(text) {
  let index = 0;
  let declaration = '<?xml version="1.0" encoding="UTF-8"?>';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const stack = [];
  let root = null;

  const isSpace = (character) => character === ' ' || character === '\t' || character === '\n' || character === '\r';

  while (index < text.length) {
    const next = text.indexOf('<', index);
    if (next === -1) break;
    index = next;

    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index);
      declaration = text.slice(index, end + 2);
      index = end + 2;
      continue;
    }
    if (text.startsWith('<!--', index)) {
      index = text.indexOf('-->', index) + 3;
      continue;
    }
    if (text.startsWith('</', index)) {
      index = text.indexOf('>', index) + 1;
      stack.pop();
      continue;
    }

    index += 1;
    let nameEnd = index;
    while (nameEnd < text.length && !isSpace(text[nameEnd]) && text[nameEnd] !== '>' && text[nameEnd] !== '/') {
      nameEnd += 1;
    }
    const node = { name: text.slice(index, nameEnd), attributes: [], children: [] };
    index = nameEnd;

    let selfClosing = false;
    while (index < text.length) {
      while (index < text.length && isSpace(text[index])) index += 1;
      if (text[index] === '/') {
        selfClosing = true;
        index = text.indexOf('>', index) + 1;
        break;
      }
      if (text[index] === '>') {
        index += 1;
        break;
      }
      let attributeEnd = index;
      while (attributeEnd < text.length && text[attributeEnd] !== '=') attributeEnd += 1;
      const attributeName = text.slice(index, attributeEnd).trim();
      const quote = text[attributeEnd + 1];
      const valueStart = attributeEnd + 2;
      const valueEnd = text.indexOf(quote, valueStart);
      node.attributes.push([attributeName, text.slice(valueStart, valueEnd)]);
      index = valueEnd + 1;
    }

    if (stack.length) stack[stack.length - 1].children.push(node);
    else root = node;
    node.selfClosing = selfClosing;
    if (!selfClosing) stack.push(node);
  }

  return { declaration, root, eol };
}

export function escapeJcrValue(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\r\n', '&#xa;')
    .replaceAll('\n', '&#xa;');
}

/** Converts a JavaScript value to its JCR typed-string form. */
export function toJcrValue(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => String(entry).replaceAll(',', '\\,')).join(',')}]`;
  if (typeof value === 'boolean') return `{Boolean}${value}`;
  if (typeof value === 'number') return Number.isInteger(value) ? `{Long}${value}` : `{Double}${value}`;
  return escapeJcrValue(value);
}

export function createNode(name, properties = {}, children = []) {
  const attributes = [];
  const ordered = Object.entries(properties);
  const primary = ordered.find(([key]) => key === 'jcr:primaryType');
  const resource = ordered.find(([key]) => key === 'sling:resourceType');
  if (primary) attributes.push([primary[0], toJcrValue(primary[1])]);
  if (resource) attributes.push([resource[0], toJcrValue(resource[1])]);
  for (const [key, value] of ordered) {
    if (key === 'jcr:primaryType' || key === 'sling:resourceType') continue;
    if (value === undefined || value === null) continue;
    attributes.push([key, toJcrValue(value)]);
  }
  return { name, attributes, children };
}

function serializeNode(node, depth, lines) {
  const pad = '    '.repeat(depth);
  const isRoot = depth === 0;
  const namespaces = node.attributes.filter(([name]) => name.startsWith('xmlns:'));
  const rest = node.attributes.filter(([name]) => !name.startsWith('xmlns:'));
  const inlineAttributes = isRoot ? namespaces : [];
  const blockAttributes = isRoot ? rest : node.attributes;
  // An element parsed as `<a></a>` is written back that way; new nodes collapse to `<a/>`.
  const closesInline = node.children.length === 0 && node.selfClosing !== false;
  const tail = closesInline ? '/>' : '>';

  const opening = `${pad}<${node.name}${inlineAttributes.map(([name, value]) => ` ${name}="${value}"`).join('')}`;

  if (!blockAttributes.length) {
    lines.push(`${opening}${tail}`);
  } else if (blockAttributes.length === 1 && !isRoot) {
    const [name, value] = blockAttributes[0];
    lines.push(`${opening} ${name}="${value}"${tail}`);
  } else {
    lines.push(opening);
    blockAttributes.forEach(([name, value], position) => {
      const last = position === blockAttributes.length - 1;
      lines.push(`${pad}    ${name}="${value}"${last ? tail : ''}`);
    });
  }

  if (closesInline) return;
  for (const child of node.children) serializeNode(child, depth + 1, lines);
  lines.push(`${pad}</${node.name}>`);
}

export function serializeJcrXml(document) {
  const lines = [document.declaration];
  serializeNode(document.root, 0, lines);
  const eol = document.eol || '\n';
  return `${lines.join(eol)}${eol}`;
}

export function findChild(node, name) {
  return node?.children.find((child) => child.name === name) || null;
}

export function findPath(node, segments) {
  let current = node;
  for (const segment of segments) {
    current = findChild(current, segment);
    if (!current) return null;
  }
  return current;
}

export function ensurePath(node, segments, primaryType = 'nt:unstructured') {
  let current = node;
  for (const segment of segments) {
    let child = findChild(current, segment);
    if (!child) {
      child = createNode(segment, { 'jcr:primaryType': primaryType });
      current.children.push(child);
    }
    current = child;
  }
  return current;
}

export function getAttribute(node, name) {
  return node?.attributes.find(([attribute]) => attribute === name)?.[1] ?? null;
}

export function setAttribute(node, name, rawValue) {
  const existing = node.attributes.find(([attribute]) => attribute === name);
  if (existing) existing[1] = rawValue;
  else node.attributes.push([name, rawValue]);
}

/** Parses a JCR multi-value string such as `[a,b,c]` back into an array. */
export function parseJcrList(rawValue) {
  if (!rawValue) return [];
  const trimmed = rawValue.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [trimmed];
  const body = trimmed.slice(1, -1);
  if (!body) return [];
  return body.split(/(?<!\\),/).map((entry) => entry.replaceAll('\\,', ',').trim()).filter(Boolean);
}
