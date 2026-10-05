/**
 * Site catalog. Every captured block becomes a unit named `<page>/<instance>`; units that repeat
 * near-verbatim at the top or bottom of most pages are the site chrome, and every other unit joins a
 * group of structurally similar units. The planner decides components from groups, not from
 * hundreds of single blocks. Pure: the same captures always give the same catalog.
 */
import crypto from 'node:crypto';

export const unitId = (pageId, instanceId) => `${pageId}/${instanceId}`;

export function splitUnitId(id) {
  const [page, instance] = String(id).split('/');
  return { page, instance };
}

// A chrome block sits within this many blocks of the top or bottom of the page.
const CHROME_REACH = 2;
// On at least this share of pages, and never fewer than two.
const CHROME_SHARE = 0.6;
// Word overlap with the group's most typical member; a hero repeats its classes, not its words.
const CHROME_SIMILARITY = 0.8;
const MAX_EXAMPLES = 4;
const MAX_TEXT = 160;

const IGNORED_CLASS = [
  /^aem-/, /^cq-/, /^(js|is|has)-/, /\d{3,}/, /[:/[\]]/,
  /^(css|sc|jsx|svelte|emotion|ng)-/,
  /^(active|show|hidden|visible|clearfix|row|col|container|wrapper|inner|outer|section|block)$/,
];

const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const sha = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

/** The element's own tag and stable classes, read from the last compound of a discovery selector. */
export function selectorSignature(css) {
  const compound = String(css || '').trim().split(/\s*[\s>+~]\s*/).pop() || '';
  const tag = /^[a-z][a-z0-9-]*/i.exec(compound)?.[0]?.toLowerCase() || '';
  const classes = [...compound.matchAll(/\.([A-Za-z_][\w-]*)/g)]
    .map((match) => match[1])
    .filter((name) => !IGNORED_CLASS.some((pattern) => pattern.test(name)));
  return { tag, classes: [...new Set(classes)].sort().slice(0, 4) };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** What a block holds, coarse enough to survive copy changes and fine enough to tell kinds apart. */
export function featuresOf(items = [], instance = {}) {
  const features = new Set();
  const levels = new Set();
  const add = (item) => {
    switch (item.type) {
      case 'heading':
        features.add('heading');
        if (item.level) levels.add(item.level);
        break;
      case 'list': features.add('list'); break;
      case 'image': case 'background': features.add('media'); break;
      case 'video': features.add('video'); break;
      case 'embed': features.add(`embed:${hostOf(item.src) || item.tag || 'unknown'}`); break;
      case 'form': features.add('form'); break;
      case 'table': features.add('table'); break;
      case 'button': features.add('cta'); break;
      case 'link':
        if (item.button) features.add('cta');
        if (item.image) features.add('media');
        break;
      default: break;
    }
  };
  items.forEach(add);
  const widest = Object.keys(instance.media || {}).map(Number).sort((a, b) => b - a)[0];
  for (const entry of (widest === undefined ? [] : instance.media[widest]) || []) {
    if (entry.tag === 'img') features.add('media');
    else if (entry.tag === 'video') features.add('video');
    else if (entry.tag === 'iframe') features.add(`embed:${hostOf(entry.src) || 'unknown'}`);
  }
  const repeated = Math.max(0, ...Object.values(instance.repeated_children || {}).map(Number).filter(Number.isFinite));
  if (repeated >= 3) features.add('repeat');
  return { features: [...features].sort(), heading_levels: [...levels].sort() };
}

const words = (text) => new Set(clean(text).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1));

export function similarity(left, right) {
  const a = words(left);
  const b = words(right);
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function widestRect(instance) {
  const widest = Object.keys(instance.rect || {}).map(Number).sort((a, b) => b - a)[0];
  return widest === undefined ? null : instance.rect[widest];
}

function widestSelector(instance) {
  const entries = Object.entries(instance.selector || {}).sort((a, b) => Number(b[0]) - Number(a[0]));
  return entries[0]?.[1]?.css || '';
}

/** One unit per discovered block, in page order. */
export function unitsOf(page) {
  const contentById = new Map((page.content?.instances || []).map((entry) => [entry.id, entry]));
  const instances = [...(page.discovery?.instances || [])].sort((a, b) => a.order - b.order);
  return instances.map((instance, index) => {
    const content = contentById.get(instance.id);
    const text = clean(content?.found ? content.text : instance.signature?.text);
    const { tag, classes } = selectorSignature(widestSelector(instance));
    const own = selectorSignature(instance.class_chain?.[0] || '');
    const { features, heading_levels: headingLevels } = featuresOf(content?.found ? content.items : [], instance);
    const rect = widestRect(instance);
    return {
      id: unitId(page.id, instance.id),
      page: page.id,
      instance: instance.id,
      order: instance.order,
      index,
      from_end: instances.length - 1 - index,
      label: instance.label || '',
      tag: tag || instance.signature?.tag || '',
      classes: classes.length ? classes : own.classes,
      features,
      heading_levels: headingLevels,
      text: text.slice(0, MAX_TEXT),
      text_length: text.length,
      text_hash: sha(text.toLowerCase()),
      height: rect ? Math.round(rect.h) : null,
      found: Boolean(content?.found),
      words: text,
    };
  });
}

/** The member most like all the others: what the chrome looks like on a typical page. */
function medoid(members) {
  let best = members[0];
  let bestScore = -1;
  for (const candidate of members) {
    const score = members.reduce((total, other) => total + similarity(candidate.words, other.words), 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Chrome is what repeats near-verbatim at the same end of most pages. Grouped by words rather than
 * by classes, since one footer can resolve to different selectors on different pages; a block with
 * no words at all must match on structure instead.
 */
export function detectChrome(units, pageCount, { homePage } = {}) {
  const needed = Math.max(2, Math.ceil(pageCount * CHROME_SHARE));
  const alike = (left, right) => (left.words || right.words
    ? similarity(left.words, right.words) >= CHROME_SIMILARITY
    : left.tag === right.tag && left.classes.join('.') === right.classes.join('.'));
  const zoneOf = (unit) => {
    if (unit.index < CHROME_REACH && unit.index <= unit.from_end) return 'header';
    if (unit.from_end < CHROME_REACH && unit.from_end < unit.index) return 'footer';
    return null;
  };

  const chrome = [];
  for (const zone of ['header', 'footer']) {
    let candidates = units.filter((unit) => zoneOf(unit) === zone);
    for (;;) {
      let best = null;
      for (const candidate of candidates) {
        const perPage = new Map();
        for (const unit of candidates) if (!perPage.has(unit.page) && alike(candidate, unit)) perPage.set(unit.page, unit);
        perPage.set(candidate.page, candidate);
        if (!best || perPage.size > best.perPage.size) best = { candidate, perPage };
      }
      if (!best || best.perPage.size < needed) break;
      const chosen = [...best.perPage.values()];
      const chosenIds = new Set(chosen.map((unit) => unit.id));
      candidates = candidates.filter((unit) => !chosenIds.has(unit.id));
      const typical = medoid(chosen);
      const representative = chosen.find((unit) => unit.page === homePage) || typical;
      chrome.push({
        slot: zone,
        members: chosen.map((unit) => unit.id),
        pages: chosen.map((unit) => unit.page),
        representative: representative.id,
        position: chosen.reduce((total, unit) => total + (zone === 'header' ? unit.index : unit.from_end), 0) / chosen.length,
        label: typical.label,
      });
    }
  }
  // Top to bottom inside each slot, so composed fragments keep the source order.
  chrome.sort((a, b) => (a.slot === b.slot
    ? (a.slot === 'header' ? a.position - b.position : b.position - a.position)
    : (a.slot === 'header' ? -1 : 1)));
  chrome.forEach((entry, index) => {
    entry.id = `c-${String(index + 1).padStart(2, '0')}`;
    entry.position = Math.round(entry.position * 100) / 100;
  });
  return chrome;
}

function pickExamples(members) {
  const byPage = new Map();
  for (const unit of members) {
    if (!byPage.has(unit.page)) byPage.set(unit.page, []);
    byPage.get(unit.page).push(unit);
  }
  const chosen = [];
  // Distinct pages first, then the longest copy left, so the dialog sees real variation.
  for (const list of byPage.values()) {
    if (chosen.length >= MAX_EXAMPLES) break;
    chosen.push([...list].sort((a, b) => b.text_length - a.text_length)[0]);
  }
  const rest = members.filter((unit) => !chosen.includes(unit)).sort((a, b) => b.text_length - a.text_length);
  while (chosen.length < Math.min(MAX_EXAMPLES, members.length)) chosen.push(rest.shift());
  return chosen.map((unit) => unit.id);
}

export function groupUnits(units) {
  const groups = new Map();
  for (const unit of units) {
    const key = `${unit.tag}|${unit.classes.join('.')}|${unit.features.join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(unit);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({ key, members }))
    // Most-used first, then by where they first appear, so ids are stable for the same captures.
    .sort((a, b) => b.members.length - a.members.length || a.members[0].id.localeCompare(b.members[0].id))
    .map(({ key, members }, index) => {
      const [tag, classes] = key.split('|');
      const heights = members.map((unit) => unit.height).filter(Number.isFinite).sort((a, b) => a - b);
      return {
        id: `g-${String(index + 1).padStart(3, '0')}`,
        key,
        tag,
        classes: classes ? classes.split('.') : [],
        features: members[0].features,
        heading_levels: [...new Set(members.flatMap((unit) => unit.heading_levels))].sort(),
        count: members.length,
        pages: [...new Set(members.map((unit) => unit.page))],
        members: members.map((unit) => unit.id),
        examples: pickExamples(members),
        identical_content: members.length > 1 && new Set(members.map((unit) => unit.text_hash)).size === 1,
        typical_height: heights.length ? heights[Math.floor(heights.length / 2)] : null,
      };
    });
}

function tally(counter, value, weight = 1) {
  if (value === undefined || value === null || value === '') return;
  counter.set(value, (counter.get(value) || 0) + weight);
}

const top = (counter, limit) => [...counter.entries()]
  .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  .slice(0, limit)
  .map(([value, count]) => ({ value, count }));

const TRANSPARENT = /^(transparent|rgba\([^)]*,\s*0\))$/;

/** Site-wide type, colour and button styles, so tokens reflect every page and not just the first. */
export function styleStats(pages) {
  const families = new Map();
  const colors = new Map();
  const backgrounds = new Map();
  const headings = new Map();
  const body = new Map();
  const buttons = new Map();
  for (const page of pages) {
    for (const instance of page.discovery?.instances || []) {
      for (const [bp, snapshot] of Object.entries(instance.styles || {})) {
        const root = snapshot?.root || {};
        tally(families, String(root.fontFamily || '').split(',')[0].replace(/["']/g, '').trim());
        tally(colors, root.color);
        if (root.backgroundColor && !TRANSPARENT.test(root.backgroundColor)) tally(backgrounds, root.backgroundColor);
        for (const [role, entry] of Object.entries(snapshot?.roles || {})) {
          const styles = entry?.styles || {};
          tally(families, String(styles.fontFamily || '').split(',')[0].replace(/["']/g, '').trim());
          tally(colors, styles.color);
          if (role === 'heading') tally(headings, `${entry.tag}@${bp}|${styles.fontSize}|${styles.fontWeight}|${styles.lineHeight}`);
          if (role === 'body') tally(body, `${bp}|${styles.fontSize}|${styles.lineHeight}`);
          if (role === 'button') {
            tally(buttons, `${bp}|${styles.backgroundColor}|${styles.color}|${styles.borderRadius}|${styles.fontSize}`);
          }
        }
      }
    }
  }
  const split = (entries, fields) => entries.map(({ value, count }) => ({
    ...Object.fromEntries(value.split('|').map((part, index) => [fields[index], part])), count,
  }));
  return {
    font_families: top(families, 8),
    text_colors: top(colors, 12),
    background_colors: top(backgrounds, 12),
    headings: split(top(headings, 24), ['tag_at_bp', 'font_size', 'font_weight', 'line_height']),
    body: split(top(body, 9), ['bp', 'font_size', 'line_height']),
    buttons: split(top(buttons, 9), ['bp', 'background', 'color', 'radius', 'font_size']),
  };
}

/**
 * `pages`: every captured page as `{ id, url, aem_path, title, discovery, content }`, in tree order.
 * The first is taken as the home page for chrome examples.
 */
export function buildCatalog(pages) {
  const perPage = pages.map((page) => ({ page, units: unitsOf(page) }));
  const all = perPage.flatMap((entry) => entry.units);
  const chrome = detectChrome(all, pages.length, { homePage: pages[0]?.id });
  const chromeIds = new Set(chrome.flatMap((entry) => entry.members));
  const groups = groupUnits(all.filter((unit) => !chromeIds.has(unit.id)));
  const groupOf = new Map(groups.flatMap((group) => group.members.map((id) => [id, group.id])));
  const chromeOf = new Map(chrome.flatMap((entry) => entry.members.map((id) => [id, entry.id])));

  const units = Object.fromEntries(all.map(({ words: omitted, ...unit }) => [unit.id, {
    ...unit,
    group: groupOf.get(unit.id) || null,
    chrome: chromeOf.get(unit.id) || null,
  }]));

  const fingerprint = sha(JSON.stringify(pages.map((page) => [
    page.id, page.url, page.discovery?.source_fingerprint, page.content?.source?.source_fingerprint,
  ])));

  return {
    schema_version: 1,
    fingerprint,
    totals: {
      pages: pages.length,
      units: all.length,
      chrome_units: chromeIds.size,
      groups: groups.length,
    },
    pages: perPage.map(({ page, units: list }) => ({
      id: page.id,
      url: page.url,
      aem_path: page.aem_path,
      title: page.title || null,
      units: list.map((unit) => unit.id),
    })),
    chrome,
    groups,
    units,
    style_stats: styleStats(pages),
  };
}
