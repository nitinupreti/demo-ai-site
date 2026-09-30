/**
 * @font-face capture. The page reports the rules it can read and the faces it actually loaded;
 * stylesheets the page cannot read (cross-origin) are fetched and parsed here instead.
 */

/** Evaluated inside the page. Must stay self-contained: no imports, no closures. */
export function collectFontFaces() {
  const rules = [];
  const inaccessible = [];
  const visit = (container, base, depth) => {
    let list;
    try {
      list = container.cssRules;
    } catch {
      if (container.href) inaccessible.push(container.href);
      return;
    }
    for (const rule of Array.from(list || [])) {
      if (rule instanceof CSSFontFaceRule) {
        const style = rule.style;
        rules.push({
          family: style.getPropertyValue('font-family'),
          weight: style.getPropertyValue('font-weight') || 'normal',
          style: style.getPropertyValue('font-style') || 'normal',
          stretch: style.getPropertyValue('font-stretch') || null,
          unicode_range: style.getPropertyValue('unicode-range') || null,
          display: style.getPropertyValue('font-display') || null,
          src: style.getPropertyValue('src'),
          base,
        });
      } else if (rule instanceof CSSImportRule) {
        if (rule.styleSheet && depth < 4) visit(rule.styleSheet, rule.styleSheet.href || base, depth + 1);
      } else if (rule.cssRules && depth < 8) {
        visit(rule, base, depth + 1);
      }
    }
  };
  const sheets = [...Array.from(document.styleSheets), ...Array.from(document.adoptedStyleSheets || [])];
  for (const sheet of sheets) visit(sheet, sheet.href || document.baseURI, 0);

  const loaded = [];
  for (const face of document.fonts) {
    if (face.status !== 'loaded') continue;
    loaded.push({
      family: face.family, weight: face.weight, style: face.style, unicode_range: face.unicodeRange,
    });
  }
  return { rules, inaccessible: Array.from(new Set(inaccessible)), loaded };
}

const WEIGHT_WORDS = { normal: '400', bold: '700' };

export function normalizeFamily(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '').trim();
}

function normalizeWeight(value) {
  const text = String(value || 'normal').trim().toLowerCase();
  return text.split(/\s+/).map((part) => WEIGHT_WORDS[part] || part).join(' ');
}

/** Canonical ranges: a stylesheet writes U+0000-00FF where the browser's FontFace reports U+0-FF. */
function normalizeRange(value) {
  const canonical = String(value || '').toUpperCase().split(',').map((part) => part.trim()).filter(Boolean)
    .map((part) => {
      const match = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/.exec(part);
      if (!match) return part.toLowerCase();
      const start = Number.parseInt(match[1].replace(/\?/g, '0'), 16);
      const end = match[1].includes('?')
        ? Number.parseInt(match[1].replace(/\?/g, 'F'), 16)
        : Number.parseInt(match[2] || match[1], 16);
      return start === end ? start.toString(16) : `${start.toString(16)}-${end.toString(16)}`;
    })
    .join(',');
  return canonical === '0-10ffff' ? '' : canonical;
}

/** Identity of a face across the CSS rule and the FontFace object the browser built from it. */
export function faceKey(face) {
  return [
    normalizeFamily(face.family).toLowerCase(),
    normalizeWeight(face.weight),
    String(face.style || 'normal').trim().toLowerCase(),
    normalizeRange(face.unicode_range),
  ].join('|');
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const char of String(text)) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === separator && !depth) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** `src` entries that point at a file, resolved against the stylesheet; `local()` names are skipped. */
export function parseSrc(src, base) {
  const entries = [];
  for (const part of splitTopLevel(src, ',')) {
    const url = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i.exec(part);
    if (!url) continue;
    const raw = url[1] ?? url[2] ?? url[3] ?? '';
    let resolved = raw;
    try {
      resolved = new URL(raw, base).href;
    } catch { /* keep what the stylesheet said */ }
    const format = /format\(\s*["']?([^"')]+)["']?\s*\)/i.exec(part)?.[1]?.toLowerCase() || null;
    entries.push({ url: resolved, format });
  }
  return entries;
}

/** Rules from stylesheet text the page could not read itself. */
export function parseFontFaces(cssText, base) {
  const faces = [];
  const text = String(cssText).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const descriptors = {};
    for (const declaration of splitTopLevel(match[1], ';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      descriptors[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim();
    }
    faces.push({
      family: descriptors['font-family'] || '',
      weight: descriptors['font-weight'] || 'normal',
      style: descriptors['font-style'] || 'normal',
      stretch: descriptors['font-stretch'] || null,
      unicode_range: descriptors['unicode-range'] || null,
      display: descriptors['font-display'] || null,
      src: descriptors.src || '',
      base,
    });
  }
  return faces;
}

export function importsOf(cssText, base) {
  const urls = [];
  for (const match of String(cssText).matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/gi)) {
    try {
      urls.push(new URL(match[1], base).href);
    } catch { /* not a resolvable import */ }
  }
  return urls;
}

/** One record per distinct face, each marked with whether any breakpoint actually rendered it. */
export function mergeFontCaptures(captures) {
  const faces = new Map();
  const loaded = new Map();
  const inaccessible = new Set();
  for (const capture of captures) {
    for (const href of capture.inaccessible || []) inaccessible.add(href);
    for (const face of capture.loaded || []) loaded.set(faceKey(face), face);
    for (const rule of capture.rules || []) {
      const src = parseSrc(rule.src, rule.base);
      const key = `${faceKey(rule)}|${src.map((entry) => entry.url).join(',')}`;
      if (!faces.has(key)) {
        faces.set(key, {
          family: normalizeFamily(rule.family),
          weight: normalizeWeight(rule.weight),
          style: String(rule.style || 'normal').trim().toLowerCase(),
          stretch: rule.stretch || null,
          unicode_range: rule.unicode_range || null,
          display: rule.display || null,
          src,
        });
      }
    }
  }
  const records = [...faces.values()].map((face) => ({ ...face, loaded: loaded.has(faceKey(face)) }));
  return {
    faces: records,
    loaded: [...loaded.values()].map((face) => ({
      family: normalizeFamily(face.family), weight: normalizeWeight(face.weight), style: face.style,
    })),
    inaccessible_sheets: [...inaccessible],
  };
}
