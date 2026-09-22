/**
 * Structural inventory of a component instance: text roles, box-model children,
 * inline images and inline SVG. Extracted identically from the live source and the
 * deployed AEM instance, then compared as hard gates so an approximated icon,
 * a substituted glyph, a fallback font or a spacing drift cannot pass.
 */

/** Icon-shaped characters that must never stand in for a real icon asset. */
export const ICON_GLYPHS = [
  '\u2304', '\u2303', '\u25BC', '\u25B2', '\u25BA', '\u25B6', '\u25C0', '\u25C4',
  '\u00D7', '\u2715', '\u2716', '\u2717', '\u2192', '\u2190', '\u2191', '\u2193',
  '\u21D2', '\u21D0', '\u2630', '\u2261', '\u2713', '\u2714', '\u22EE', '\u23F5', '\u23F4',
];

export const TYPOGRAPHY_PROPERTIES = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'wordSpacing', 'textTransform', 'textDecorationLine', 'textAlign', 'whiteSpace',
];

/** Font colour lives here, not in typography, so colour drift routes to the token layer. */
export const COLOR_PROPERTIES = [
  'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
  'backgroundRepeat', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'outlineColor', 'boxShadow', 'textShadow', 'opacity', 'textDecorationColor',
];

export const BOX_PROPERTIES = [
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'rowGap', 'columnGap', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'display', 'flexDirection', 'justifyContent', 'alignItems', 'gridTemplateColumns',
];

/** Evaluated inside the page. Must stay self-contained: no imports, no closures. */
export function extractInventory(options) {
  const {
    css, matchIndex, typographyProperties, colorProperties, boxProperties, iconGlyphs, maxNodes,
  } = options;

  const root = document.querySelectorAll(css)[matchIndex || 0];
  if (!root) return null;
  const rootRect = root.getBoundingClientRect();

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  }

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function relativeRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round((rect.x - rootRect.x) * 100) / 100,
      y: Math.round((rect.y - rootRect.y) * 100) / 100,
      w: Math.round(rect.width * 100) / 100,
      h: Math.round(rect.height * 100) / 100,
    };
  }

  function visible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none'
      && Number.parseFloat(style.opacity || '1') >= 0.02;
  }

  function snapshot(style, properties) {
    const values = {};
    for (const property of properties) values[property] = style[property];
    return values;
  }

  function directText(element) {
    let text = '';
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) text += node.textContent;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function describe(element) {
    const classes = typeof element.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      : [];
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes.length ? `.${classes.join('.')}` : ''}`;
  }

  const textRoles = [];
  const boxes = [];
  const images = [];
  const svgs = [];
  const glyphs = [];
  const tagCounters = new Map();

  const walker = [root, ...Array.from(root.querySelectorAll('*'))].slice(0, maxNodes);
  for (const element of walker) {
    if (element !== root && !visible(element)) continue;
    const tag = element.tagName.toLowerCase();
    const style = getComputedStyle(element);

    if (element.closest('svg') && element !== root) continue;

    const ordinal = (tagCounters.get(tag) || 0);
    tagCounters.set(tag, ordinal + 1);
    const key = `${tag}[${ordinal}]`;

    const text = directText(element);
    if (text) {
      if (textRoles.length < 140) {
        textRoles.push({
          key,
          selector: describe(element),
          tag,
          text: text.slice(0, 120),
          normalized: normalize(text).slice(0, 80),
          rect: relativeRect(element),
          styles: snapshot(style, typographyProperties),
          colors: snapshot(style, colorProperties),
        });
      }
      for (const glyph of iconGlyphs) {
        if (text.includes(glyph) && glyphs.length < 20) {
          glyphs.push({ key, selector: describe(element), glyph, text: text.slice(0, 60) });
        }
      }
    }

    const laysOut = style.display !== 'inline' || Number.parseFloat(style.borderTopWidth) > 0;
    if (laysOut && boxes.length < 220) {
      boxes.push({
        key,
        selector: describe(element),
        tag,
        rect: relativeRect(element),
        styles: snapshot(style, boxProperties),
        colors: snapshot(style, colorProperties),
      });
    }

    if (tag === 'img' && images.length < 60) {
      const source = element.currentSrc || element.src || '';
      images.push({
        key,
        selector: describe(element),
        src: source,
        basename: source.split(/[/?#]/).filter(Boolean).pop() || '',
        is_data_uri: source.startsWith('data:'),
        alt: element.getAttribute('alt'),
        loading: element.getAttribute('loading'),
        has_srcset: Boolean(element.getAttribute('srcset')),
        intrinsic: { w: element.naturalWidth, h: element.naturalHeight },
        rect: relativeRect(element),
        styles: {
          objectFit: style.objectFit,
          objectPosition: style.objectPosition,
          borderRadius: style.borderRadius,
          aspectRatio: style.aspectRatio,
        },
        loaded: element.complete && element.naturalWidth > 0,
      });
    }

    if (tag === 'svg' && svgs.length < 60) {
      const shapes = Array.from(element.querySelectorAll('path,circle,rect,ellipse,line,polyline,polygon,use'));
      const geometry = shapes.map((shape) => {
        const name = shape.tagName.toLowerCase();
        if (name === 'path') return `p:${shape.getAttribute('d') || ''}`;
        if (name === 'use') return `u:${shape.getAttribute('href') || shape.getAttribute('xlink:href') || ''}`;
        return `${name}:${Array.from(shape.attributes).filter((attribute) => attribute.name !== 'class')
          .map((attribute) => `${attribute.name}=${attribute.value}`).sort().join(',')}`;
      }).join('|');
      svgs.push({
        key,
        selector: describe(element),
        view_box: element.getAttribute('viewBox'),
        aria_label: element.getAttribute('aria-label') || element.querySelector('title')?.textContent || null,
        shape_count: shapes.length,
        geometry_hash: hash(geometry),
        geometry_length: geometry.length,
        rect: relativeRect(element),
        styles: { fill: style.fill, stroke: style.stroke, color: style.color, strokeWidth: style.strokeWidth },
      });
    }
  }

  return {
    root: {
      selector: describe(root),
      tag: root.tagName.toLowerCase(),
      rect: { w: Math.round(rootRect.width * 100) / 100, h: Math.round(rootRect.height * 100) / 100 },
      child_tags: Array.from(root.children).map((child) => child.tagName.toLowerCase()),
    },
    text_roles: textRoles,
    boxes,
    images,
    svgs,
    glyph_substitutions: glyphs,
  };
}

function numeric(value) {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function differs(left, right, tolerance) {
  if (left === right) return false;
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);
  if (leftNumber !== null && rightNumber !== null && /^[-\d.]+px$/.test(String(left).trim())
    && /^[-\d.]+px$/.test(String(right).trim())) {
    return Math.abs(leftNumber - rightNumber) > tolerance;
  }
  return true;
}

/** Normalised font stack so quoting and casing differences are not reported as defects. */
function fontStack(value) {
  return String(value || '').split(',').map((entry) => entry.trim().replace(/^["']|["']$/g, '').toLowerCase()).join(', ');
}

function matchByKey(sourceItems, targetItems, keyOf) {
  const pairs = [];
  const remaining = targetItems.slice();
  for (const sourceItem of sourceItems) {
    const key = keyOf(sourceItem);
    let index = remaining.findIndex((candidate) => keyOf(candidate) === key);
    if (index === -1) index = remaining.findIndex((candidate) => candidate.key === sourceItem.key);
    pairs.push({ source: sourceItem, target: index === -1 ? null : remaining[index] });
    if (index !== -1) remaining.splice(index, 1);
  }
  return { pairs, unmatchedTarget: remaining };
}

export function compareInventories(source, target, { pxTolerance = 1, maxPerCategory = 25 } = {}) {
  const deltas = {
    typography: [], color: [], spacing: [], images: [], svg: [], glyph_substitutions: [], structure: [],
  };
  if (!source || !target) {
    deltas.structure.push({ reason: !source ? 'source inventory unavailable' : 'target inventory unavailable' });
    return deltas;
  }

  if (source.root.child_tags.join(',') !== target.root.child_tags.join(',')) {
    deltas.structure.push({
      reason: 'direct child element sequence differs',
      source: source.root.child_tags.join(','),
      target: target.root.child_tags.join(','),
    });
  }

  const text = matchByKey(source.text_roles, target.text_roles, (item) => item.normalized);
  for (const { source: left, target: right } of text.pairs) {
    if (!right) {
      deltas.typography.push({ kind: 'missing-text', selector: left.selector, text: left.text });
      continue;
    }
    for (const property of TYPOGRAPHY_PROPERTIES) {
      const leftValue = property === 'fontFamily' ? fontStack(left.styles[property]) : left.styles[property];
      const rightValue = property === 'fontFamily' ? fontStack(right.styles[property]) : right.styles[property];
      if (differs(leftValue, rightValue, 0.5)) {
        deltas.typography.push({
          kind: 'typography', selector: left.selector, text: left.text.slice(0, 40),
          property, source: leftValue, target: rightValue,
        });
      }
    }
    for (const property of COLOR_PROPERTIES) {
      if (differs(left.colors?.[property], right.colors?.[property], 0.01)) {
        deltas.color.push({
          kind: 'text-color', selector: left.selector, text: left.text.slice(0, 40),
          property, source: left.colors?.[property], target: right.colors?.[property],
        });
      }
    }
    for (const axis of ['x', 'y', 'w', 'h']) {
      if (Math.abs(left.rect[axis] - right.rect[axis]) > pxTolerance) {
        deltas.spacing.push({
          kind: 'text-position', selector: left.selector, text: left.text.slice(0, 40),
          property: `rect.${axis}`, source: left.rect[axis], target: right.rect[axis],
        });
      }
    }
  }
  for (const extra of text.unmatchedTarget) {
    deltas.typography.push({ kind: 'unexpected-text', selector: extra.selector, text: extra.text });
  }

  const boxes = matchByKey(source.boxes, target.boxes, (item) => item.key);
  for (const { source: left, target: right } of boxes.pairs) {
    if (!right) {
      deltas.spacing.push({ kind: 'missing-box', selector: left.selector, key: left.key });
      continue;
    }
    for (const property of BOX_PROPERTIES) {
      if (differs(left.styles[property], right.styles[property], pxTolerance)) {
        deltas.spacing.push({
          kind: 'box-model', selector: left.selector, property,
          source: left.styles[property], target: right.styles[property],
        });
      }
    }
    for (const property of COLOR_PROPERTIES) {
      if (differs(left.colors?.[property], right.colors?.[property], 0.01)) {
        deltas.color.push({
          kind: 'box-color', selector: left.selector, property,
          source: left.colors?.[property], target: right.colors?.[property],
        });
      }
    }
    for (const axis of ['x', 'y', 'w', 'h']) {
      if (Math.abs(left.rect[axis] - right.rect[axis]) > pxTolerance) {
        deltas.spacing.push({
          kind: 'box-position', selector: left.selector, property: `rect.${axis}`,
          source: left.rect[axis], target: right.rect[axis],
        });
      }
    }
  }

  const images = matchByKey(source.images, target.images, (item) => item.basename);
  for (const { source: left, target: right } of images.pairs) {
    if (!right) {
      deltas.images.push({ kind: 'missing-image', selector: left.selector, source: left.src });
      continue;
    }
    if (!right.loaded) {
      deltas.images.push({ kind: 'image-not-loaded', selector: right.selector, target: right.src });
    }
    if (right.is_data_uri && !left.is_data_uri) {
      deltas.images.push({ kind: 'data-uri-substitution', selector: right.selector, target: 'data:' });
    }
    for (const axis of ['w', 'h']) {
      if (Math.abs(left.rect[axis] - right.rect[axis]) > pxTolerance) {
        deltas.images.push({
          kind: 'image-geometry', selector: left.selector, property: `rect.${axis}`,
          source: left.rect[axis], target: right.rect[axis],
        });
      }
      if (left.intrinsic[axis] !== right.intrinsic[axis]) {
        deltas.images.push({
          kind: 'image-intrinsic', selector: left.selector, property: axis,
          source: left.intrinsic[axis], target: right.intrinsic[axis],
        });
      }
    }
    for (const property of ['objectFit', 'objectPosition', 'borderRadius']) {
      if (differs(left.styles[property], right.styles[property], pxTolerance)) {
        deltas.images.push({
          kind: 'image-style', selector: left.selector, property,
          source: left.styles[property], target: right.styles[property],
        });
      }
    }
    if ((left.alt || '') !== (right.alt || '')) {
      deltas.images.push({ kind: 'image-alt', selector: left.selector, source: left.alt, target: right.alt });
    }
  }
  for (const extra of images.unmatchedTarget) {
    deltas.images.push({ kind: 'unexpected-image', selector: extra.selector, target: extra.src });
  }

  const svgs = matchByKey(source.svgs, target.svgs, (item) => `${item.view_box}|${item.geometry_hash}`);
  for (const { source: left, target: right } of svgs.pairs) {
    if (!right) {
      deltas.svg.push({
        kind: 'missing-or-redrawn-svg', selector: left.selector, view_box: left.view_box,
        source_geometry: left.geometry_hash,
        note: 'no target SVG has the same viewBox and path geometry',
      });
      continue;
    }
    if (left.view_box !== right.view_box) {
      deltas.svg.push({ kind: 'svg-viewbox', selector: left.selector, source: left.view_box, target: right.view_box });
    }
    if (left.geometry_hash !== right.geometry_hash) {
      deltas.svg.push({
        kind: 'svg-geometry', selector: left.selector,
        source: left.geometry_hash, target: right.geometry_hash,
        note: 'path data differs; reuse the source vector instead of redrawing it',
      });
    }
    if (left.shape_count !== right.shape_count) {
      deltas.svg.push({ kind: 'svg-shape-count', selector: left.selector, source: left.shape_count, target: right.shape_count });
    }
    for (const property of ['fill', 'stroke', 'color', 'strokeWidth']) {
      if (differs(left.styles[property], right.styles[property], 0.5)) {
        deltas.svg.push({
          kind: 'svg-paint', selector: left.selector, property,
          source: left.styles[property], target: right.styles[property],
        });
      }
    }
    for (const axis of ['w', 'h']) {
      if (Math.abs(left.rect[axis] - right.rect[axis]) > pxTolerance) {
        deltas.svg.push({
          kind: 'svg-geometry-box', selector: left.selector, property: `rect.${axis}`,
          source: left.rect[axis], target: right.rect[axis],
        });
      }
    }
  }
  for (const extra of svgs.unmatchedTarget) {
    deltas.svg.push({ kind: 'unexpected-svg', selector: extra.selector, view_box: extra.view_box });
  }

  const sourceGlyphs = new Set(source.glyph_substitutions.map((entry) => entry.glyph));
  for (const entry of target.glyph_substitutions) {
    if (!sourceGlyphs.has(entry.glyph)) {
      deltas.glyph_substitutions.push({
        kind: 'glyph-for-icon', selector: entry.selector, glyph: entry.glyph, text: entry.text,
        note: 'authored labels must not contain icon glyphs; render a real SVG or icon asset',
      });
    }
  }

  for (const category of Object.keys(deltas)) {
    if (deltas[category].length > maxPerCategory) {
      const overflow = deltas[category].length - maxPerCategory;
      deltas[category] = deltas[category].slice(0, maxPerCategory);
      deltas[category].push({ kind: 'truncated', omitted: overflow });
    }
  }
  return deltas;
}
