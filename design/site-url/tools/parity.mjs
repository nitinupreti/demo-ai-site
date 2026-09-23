#!/usr/bin/env node
/**
 * Frozen deterministic visual parity gate for the AEM migration pipeline.
 * Scores live source crops against deployed AEM crops. No agent may author,
 * edit, estimate or round these numbers.
 *
 *   node design/site-url/tools/parity.mjs --config <parity-config.json> [--out <dir>]
 *
 * Config (credentials are read from environment variables, never from the file):
 * {
 *   "run_id": "...",
 *   "source_url": "https://live/page",
 *   "targets": [{ "mode": "disabled", "url": "http://localhost:4502/content/site/page.html?wcmmode=disabled" }],
 *   "breakpoints": [375, 768, 1440],
 *   "threshold": 0.9,
 *   "auth": { "username": "admin", "password_env": "AEM_PASSWORD" },
 *   "components": [{
 *     "id": "hero",
 *     "source": { "css": "section.hero", "match_index": 0 },
 *     "target": { "css": ".cmp-hero", "match_index": 0 },
 *     "signature_text": "How the world's",
 *     "visibility_by_bp": { "375": true, "768": true, "1440": true }
 *   }]
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import {
  DEFAULT_VISUAL_PASS_RATIO, GEOMETRY_TOLERANCE, STYLE_PROPERTIES, TOOL_VERSION,
} from './lib/contracts.mjs';
import {
  createPage, launchBrowser, navigate, prepareForCapture, renderedFonts,
} from './lib/browser.mjs';
import {
  BOX_PROPERTIES, COLOR_PROPERTIES, ICON_GLYPHS, TYPOGRAPHY_PROPERTIES,
  compareInventories, extractInventory,
} from './lib/inventory.mjs';
import {
  ensureDir, parseArgs, readJson, relativePath, round, sha256, toolDependencies, writeJson,
} from './lib/util.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`
parity.mjs - deterministic visual parity scoring

  --config <file>   Parity run config (required)
  --out <dir>       Output directory (default: <config dir>/parity)
  --only <ids>      Comma-separated component ids to score
  --cycle <n>       Remediation cycle number recorded in the artifact
  --headed          Run Chromium headed
  --help
`);
}

function runnerRevision(configPath) {
  const inputs = [
    fs.readFileSync(fileURLToPath(import.meta.url)),
    fs.readFileSync(path.join(toolRoot, 'lib', 'browser.mjs')),
    fs.readFileSync(path.join(toolRoot, 'lib', 'contracts.mjs')),
    fs.readFileSync(path.join(toolRoot, 'lib', 'inventory.mjs')),
    fs.readFileSync(path.join(toolRoot, 'package.json')),
    fs.readFileSync(configPath),
  ];
  return sha256(Buffer.concat(inputs));
}

async function readInventory(page, selector) {
  return page.evaluate(extractInventory, {
    css: selector.css,
    matchIndex: selector.match_index || 0,
    typographyProperties: TYPOGRAPHY_PROPERTIES,
    colorProperties: COLOR_PROPERTIES,
    boxProperties: BOX_PROPERTIES,
    iconGlyphs: ICON_GLYPHS,
    maxNodes: 600,
  });
}

const GATE_LAYERS = {
  typography: 'typography-tokens',
  color: 'color-tokens',
  spacing: 'spacing',
  images: 'media-assets',
  svg: 'media-assets',
  glyph_substitutions: 'icon-assets',
  structure: 'component-structure',
};

// Long enough for a playing video to advance measurably, short enough to run per component.
const PLAYBACK_SETTLE_MS = 1200;

// `preload` and `ready_state` are captured for diagnosis but not gated: neither changes what a visitor sees.
const PLAYBACK_PROPERTIES = ['autoplay', 'loop', 'muted', 'controls', 'playsinline', 'has_poster', 'paused', 'advanced'];

function validateConfig(config) {
  const problems = [];
  if (!config.source_url) problems.push('source_url is required');
  if (!Array.isArray(config.targets) || !config.targets.length) problems.push('targets[] is required');
  if (!Array.isArray(config.breakpoints) || !config.breakpoints.length) problems.push('breakpoints[] is required');
  if (!Array.isArray(config.components) || !config.components.length) problems.push('components[] is required');
  for (const component of config.components || []) {
    if (!component.id) problems.push('every component needs an id');
    if (!component.source?.css) problems.push(`component ${component.id}: source.css is required`);
    if (!component.target?.css) problems.push(`component ${component.id}: target.css is required`);
  }
  if (problems.length) throw new Error(`Invalid parity config:\n  - ${problems.join('\n  - ')}`);
}

function credentials(config) {
  const auth = config.auth;
  if (!auth?.username) return undefined;
  const variable = auth.password_env || 'AEM_PASSWORD';
  const password = process.env[variable];
  if (!password) throw new Error(`Environment variable ${variable} must hold the AEM password.`);
  return { username: auth.username, password };
}

function analysePng(buffer) {
  const png = PNG.sync.read(buffer);
  const counts = new Map();
  let sampled = 0;
  for (let index = 0; index < png.data.length; index += 4 * 7) {
    const key = `${png.data[index]},${png.data[index + 1]},${png.data[index + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    sampled += 1;
  }
  const modal = Math.max(...counts.values(), 0);
  return {
    png,
    width: png.width,
    height: png.height,
    distinct_colors: counts.size,
    uniform_ratio: sampled ? modal / sampled : 1,
  };
}

function validateCrop(analysis, label) {
  if (analysis.width < 2 || analysis.height < 2) return `${label} crop is ${analysis.width}x${analysis.height}`;
  if (analysis.distinct_colors <= 1) return `${label} crop is a single flat colour`;
  if (analysis.uniform_ratio > 0.995) return `${label} crop is ${(analysis.uniform_ratio * 100).toFixed(2)}% one colour`;
  return null;
}

function cropTo(analysis, width, height) {
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const start = y * analysis.width * 4;
    analysis.png.data.copy(output.data, y * width * 4, start, start + width * 4);
  }
  return output;
}

/** Diagnostic only: unequal crops are never awarded an authoritative score. */
function overlapDiagnostic(sourceAnalysis, targetAnalysis) {
  const width = Math.min(sourceAnalysis.width, targetAnalysis.width);
  const height = Math.min(sourceAnalysis.height, targetAnalysis.height);
  if (width < 2 || height < 2) return null;
  const left = cropTo(sourceAnalysis, width, height);
  const right = cropTo(targetAnalysis, width, height);
  const diff = new PNG({ width, height });
  const differing = pixelmatch(left.data, right.data, diff.data, width, height, { threshold: 0.1, includeAA: false });
  const total = width * height;
  return {
    region: { w: width, h: height },
    differing_pixels: differing,
    total_pixels: total,
    ratio: round((total - differing) / total, 6),
    diff,
  };
}

// Only ever drawn into the union mask; the score itself is counted arithmetically.
const UNION_PAD_SOURCE = [255, 0, 255, 255];
const UNION_PAD_TARGET = [0, 255, 0, 255];

function padTo(analysis, width, height, fill) {
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (x < analysis.width && y < analysis.height) {
        const start = (y * analysis.width + x) * 4;
        analysis.png.data.copy(output.data, offset, start, start + 4);
      } else {
        output.data.set(fill, offset);
      }
    }
  }
  return output;
}

/**
 * Scores a pair of crops over their union: only the overlapping region can earn matched pixels,
 * so a size difference costs exactly the area it adds or removes. Equal crops take the same path
 * with union === overlap, so every comparable instance gets one authoritative ratio on one scale.
 */
function unionCompare(sourceAnalysis, targetAnalysis) {
  const overlapWidth = Math.min(sourceAnalysis.width, targetAnalysis.width);
  const overlapHeight = Math.min(sourceAnalysis.height, targetAnalysis.height);
  if (overlapWidth < 2 || overlapHeight < 2) return null;
  const width = Math.max(sourceAnalysis.width, targetAnalysis.width);
  const height = Math.max(sourceAnalysis.height, targetAnalysis.height);

  const left = cropTo(sourceAnalysis, overlapWidth, overlapHeight);
  const right = cropTo(targetAnalysis, overlapWidth, overlapHeight);
  const overlapDiffering = pixelmatch(left.data, right.data, null, overlapWidth, overlapHeight,
    { threshold: 0.1, includeAA: false });
  const overlapStrict = pixelmatch(left.data, right.data, null, overlapWidth, overlapHeight,
    { threshold: 0, includeAA: true });

  const diff = new PNG({ width, height });
  pixelmatch(
    padTo(sourceAnalysis, width, height, UNION_PAD_SOURCE).data,
    padTo(targetAnalysis, width, height, UNION_PAD_TARGET).data,
    diff.data, width, height, { threshold: 0.1, includeAA: false },
  );

  const overlapTotal = overlapWidth * overlapHeight;
  const total = width * height;
  // Every pixel outside the overlap exists on one side only, so it can never be a match.
  const unmatchedArea = total - overlapTotal;
  return {
    width,
    height,
    total,
    differing: overlapDiffering + unmatchedArea,
    strict_differing: overlapStrict + unmatchedArea,
    diff,
    overlap: {
      region: { w: overlapWidth, h: overlapHeight },
      differing_pixels: overlapDiffering,
      total_pixels: overlapTotal,
      ratio: round((overlapTotal - overlapDiffering) / overlapTotal, 6),
    },
  };
}

/** Comparable form for text captured by different APIs (innerText vs textContent). */
function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function textSimilarity(left, right) {
  const leftTokens = normalizeText(left).split(' ').filter(Boolean);
  const rightTokens = new Set(normalizeText(right).split(' ').filter(Boolean));
  if (!leftTokens.length && !rightTokens.size) return 1;
  if (!leftTokens.length || !rightTokens.size) return 0;
  const shared = leftTokens.filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.length, rightTokens.size);
}

/** Locates the differing pixels so remediation edits the region that actually differs. */
function diffHotCells(diff, { width, height, cellSize }) {
  const columns = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const counts = new Array(columns * rows).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isDiff = diff.data[offset] > 200 && diff.data[offset + 1] < 60
        && diff.data[offset + 2] < 60 && diff.data[offset + 3] > 200;
      if (isDiff) counts[Math.floor(y / cellSize) * columns + Math.floor(x / cellSize)] += 1;
    }
  }
  return counts
    .map((count, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellWidth = Math.min(cellSize, width - column * cellSize);
      const cellHeight = Math.min(cellSize, height - row * cellSize);
      return {
        x: column * cellSize,
        y: row * cellSize,
        w: cellWidth,
        h: cellHeight,
        differing_pixels: count,
        density: cellWidth * cellHeight ? count / (cellWidth * cellHeight) : 0,
      };
    })
    .filter((cell) => cell.density > 0.02)
    .sort((a, b) => b.differing_pixels - a.differing_pixels)
    .slice(0, 6);
}

async function elementsAtPoints(page, origin, cells) {
  return page.evaluate(({ originRect, points }) => {
    const describe = (element) => {
      const classes = typeof element.className === 'string'
        ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
        : [];
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes.length ? `.${classes.join('.')}` : ''}`;
    };
    const output = [];
    for (const point of points) {
      const absoluteX = originRect.x + point.x + point.w / 2;
      const absoluteY = originRect.y + point.y + point.h / 2;
      window.scrollTo(0, Math.max(0, absoluteY - window.innerHeight / 2));
      const clientX = absoluteX - window.scrollX;
      const clientY = absoluteY - window.scrollY;
      const stack = document.elementsFromPoint(clientX, clientY).slice(0, 3).map(describe);
      output.push({ cell: point, elements: stack });
    }
    window.scrollTo(0, 0);
    return output;
  }, { originRect: origin, points: cells });
}

async function resolveInstance(page, selector) {
  return page.evaluate(({ css, matchIndex }) => {
    let matches;
    try {
      matches = Array.from(document.querySelectorAll(css));
    } catch (error) {
      return { error: `invalid selector: ${error.message}` };
    }
    const element = matches[matchIndex || 0];
    if (!element) return { matches: matches.length, found: false };
    const rect = element.getBoundingClientRect();
    return {
      matches: matches.length,
      found: true,
      inner_text: (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      text_content: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      rect: {
        x: rect.x + window.scrollX, y: rect.y + window.scrollY, w: rect.width, h: rect.height,
      },
    };
  }, { css: selector.css, matchIndex: selector.match_index || 0 });
}

async function captureStyles(page, selector) {
  return page.evaluate(({ css, matchIndex, properties }) => {
    const element = document.querySelectorAll(css)[matchIndex || 0];
    if (!element) return null;
    const snapshot = (node) => {
      const style = getComputedStyle(node);
      const values = {};
      for (const property of properties) values[property] = style[property];
      return values;
    };
    const roles = {};
    const mapping = {
      heading: 'h1,h2,h3,h4,h5,h6',
      body: 'p',
      link: 'a[href]',
      button: 'button,[role=button],a[class*=btn],a[class*=button]',
      image: 'img',
      video: 'video',
      icon: 'svg',
    };
    for (const [role, roleSelector] of Object.entries(mapping)) {
      const node = element.querySelector(roleSelector);
      if (node) roles[role] = snapshot(node);
    }
    return { root: snapshot(element), roles };
  }, { css: selector.css, matchIndex: selector.match_index || 0, properties: STYLE_PROPERTIES });
}

function styleDeltas(source, target) {
  const deltas = [];
  if (!source || !target) return deltas;
  const compare = (scope, left, right) => {
    if (!left || !right) {
      deltas.push({ scope, property: '*', source: left ? 'present' : 'absent', target: right ? 'present' : 'absent' });
      return;
    }
    for (const property of STYLE_PROPERTIES) {
      if (left[property] !== right[property]) {
        deltas.push({ scope, property, source: left[property], target: right[property] });
      }
    }
  };
  compare('root', source.root, target.root);
  for (const role of new Set([...Object.keys(source.roles || {}), ...Object.keys(target.roles || {})])) {
    compare(role, source.roles?.[role], target.roles?.[role]);
  }
  return deltas;
}

/**
 * Samples every video in a component: the declared attributes plus whether it is actually
 * running. A poster frame that never advances is otherwise indistinguishable from an image.
 */
async function capturePlayback(page, selector) {
  return page.evaluate(async ({ css, matchIndex, settleMs }) => {
    const element = document.querySelectorAll(css)[matchIndex || 0];
    if (!element) return null;
    const nodes = element.matches('video') ? [element] : Array.from(element.querySelectorAll('video'));
    if (!nodes.length) return [];

    return Promise.all(nodes.map(async (video) => {
      video.scrollIntoView({ block: 'center', behavior: 'instant' });
      const before = video.currentTime;
      await new Promise((resolve) => { setTimeout(resolve, settleMs); });
      return {
        autoplay: video.autoplay,
        loop: video.loop,
        muted: video.muted,
        controls: video.controls,
        playsinline: video.hasAttribute('playsinline'),
        preload: video.preload,
        has_poster: Boolean(video.poster),
        paused: video.paused,
        ready_state: video.readyState,
        advanced: video.currentTime - before > 0.25,
      };
    }));
  }, { css: selector.css, matchIndex: selector.match_index || 0, settleMs: PLAYBACK_SETTLE_MS });
}

function playbackDeltas(source, target) {
  if (!source || !target) return [];
  if (source.length !== target.length) {
    return [{ property: 'video_count', source: source.length, target: target.length }];
  }
  const deltas = [];
  source.forEach((left, index) => {
    const right = target[index];
    for (const property of PLAYBACK_PROPERTIES) {
      if (left[property] !== right[property]) {
        deltas.push({ index, property, source: left[property], target: right[property] });
      }
    }
  });
  return deltas;
}

function owningLayerHint(result) {
  if (result.status === 'WITHHELD' && /selector|match|signature/i.test(result.withheld_reason || '')) return 'plan-or-selector';
  if (result.deltas?.text && result.deltas.text.similarity < 0.9) return 'authored-content';
  const geometry = result.deltas?.rect;
  if (geometry && (Math.abs(geometry.w) > GEOMETRY_TOLERANCE.width || Math.abs(geometry.h) > GEOMETRY_TOLERANCE.height
    || Math.abs(geometry.x) > GEOMETRY_TOLERANCE.x)) {
    return 'geometry-container';
  }
  if (result.deltas?.rendered_fonts?.length) return 'font-delivery';
  if (result.deltas?.playback?.length) return 'media-playback';
  // The structured gates name their own layer before falling back to raw pixels.
  for (const [category, layer] of Object.entries(GATE_LAYERS)) {
    if (result.deltas?.inventory?.[category]?.length) return layer;
  }
  const properties = (result.deltas?.styles || []).map((delta) => delta.property);
  if (properties.some((property) => /^font|lineHeight|letterSpacing/.test(property))) return 'typography-tokens';
  if (properties.some((property) => /color|background|fill|stroke|boxShadow/i.test(property))) return 'color-tokens';
  if (properties.some((property) => /^padding|^margin|Gap$|^gap/.test(property))) return 'spacing';
  if (properties.some((property) => /object(Fit|Position)|aspectRatio/.test(property))) return 'media-assets';
  return 'component-css';
}

/**
 * Measures the vertical gap between consecutive instances on both sides. Every crop can score
 * green while the rhythm between them is wrong, and no per-component crop can see it: a component
 * is cropped to its own box, so the space before and after it falls outside every crop taken.
 * Nesting cancels because both sides are measured the same way; only the delta is gated.
 */
function interComponentGaps(results, breakpoint, mode, tolerancePx) {
  const ordered = results
    .filter((row) => row.breakpoint === breakpoint && row.mode === mode
      && row.source?.rect && row.target?.rect)
    .sort((left, right) => left.source.rect.y - right.source.rect.y);

  const gaps = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const sourceGap = round(current.source.rect.y - (previous.source.rect.y + previous.source.rect.h), 2);
    const targetGap = round(current.target.rect.y - (previous.target.rect.y + previous.target.rect.h), 2);
    const delta = round(targetGap - sourceGap, 2);
    gaps.push({
      after: previous.component_id,
      before: current.component_id,
      source_gap: sourceGap,
      target_gap: targetGap,
      delta,
      status: Math.abs(delta) <= tolerancePx ? 'PASS' : 'FAIL',
    });
  }
  return gaps;
}

async function composeSideBySide(page, { sourcePath, targetPath, outPath, caption, maxWidth }) {
  const encode = (filePath) => `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
  await page.setContent(`<!doctype html><html><head><style>
    body { margin:0; background:#101114; font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif; color:#fff; }
    .wrap { display:flex; gap:12px; padding:12px; align-items:flex-start; }
    figure { margin:0; flex:0 0 auto; }
    figcaption { padding:6px 8px; font-weight:700; letter-spacing:.08em; }
    .live figcaption { background:#1f6feb; } .aem figcaption { background:#8957e5; }
    img { display:block; background:#fff;${maxWidth ? ` max-width:${maxWidth}px;` : ''} }
    .meta { padding:0 12px 12px; color:#9aa4b2; }
  </style></head><body>
    <div class="wrap">
      <figure class="live"><figcaption>LIVE SITE</figcaption><img src="${encode(sourcePath)}"></figure>
      <figure class="aem"><figcaption>AEM</figcaption><img src="${encode(targetPath)}"></figure>
    </div>
    <div class="meta">${caption}</div>
  </body></html>`);
  await page.screenshot({ path: outPath, fullPage: true });
}

async function openPrepared(browser, { url, width, dpr, httpCredentials, stableSelectors }) {
  // Credentials are scoped to the page under test, never to a third-party asset it pulls in.
  const scoped = httpCredentials
    ? { ...httpCredentials, origin: httpCredentials.origin ?? originOf(url) }
    : undefined;
  const page = await createPage(browser, { width, dpr, httpCredentials: scoped });
  const navigation = await navigate(page, url);
  const readiness = await prepareForCapture(page, { width, stableSelectors });
  return { page, navigation, readiness };
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Query strings differ legitimately (wcmmode); a different path means we scored the wrong page. */
function landedElsewhere(requestedUrl, finalUrl) {
  try {
    const requested = new URL(requestedUrl);
    const landed = new URL(finalUrl);
    if (requested.origin === landed.origin && requested.pathname === landed.pathname) return null;
    return landed.href;
  } catch {
    return null;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2), {
    values: ['config', 'out', 'only', 'cycle'],
    flags: ['headed', 'help'],
    defaults: {},
  });
  if (options.help || !options.config) {
    usage();
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  const configPath = path.resolve(options.config);
  const config = readJson(configPath);
  validateConfig(config);

  const threshold = typeof config.threshold === 'number' ? config.threshold : DEFAULT_VISUAL_PASS_RATIO;
  const pageHeightTolerance = typeof config.page_height_tolerance_px === 'number'
    ? config.page_height_tolerance_px
    : GEOMETRY_TOLERANCE.height;
  const pxTolerance = typeof config.px_tolerance === 'number' ? config.px_tolerance : GEOMETRY_TOLERANCE.x;
  const dpr = config.dpr || 1;
  const outDir = ensureDir(path.resolve(options.out || path.join(path.dirname(configPath), 'parity')));
  const shotDir = ensureDir(path.join(outDir, 'evidence'));
  const httpCredentials = credentials(config);
  const only = options.only ? new Set(options.only.split(',').map((value) => value.trim())) : null;
  const components = config.components.filter((component) => !only || only.has(component.id));
  const startedAt = Date.now();

  const browser = await launchBrowser({ headless: !options.headed });
  const results = [];
  const pageComposite = {};
  const preflight = { status: 'PASS', environment_blocked: false, checks: [] };
  const composePage = await createPage(browser, { width: 1200, height: 800, dpr: 1 });

  try {
    for (const width of config.breakpoints) {
      // A target may be pinned to one breakpoint (a responsive variant); it is not comparable elsewhere.
      const visible = components.filter((component) => {
        if (component.visibility_by_bp?.[width] === false) return false;
        const pinned = component.bp ?? component.source?.bp;
        return pinned === undefined || pinned === null || Number(pinned) === width;
      });
      const sourceSelectors = visible.map((component) => ({
        key: `src-${component.id}`, css: component.source.css, matchIndex: component.source.match_index || 0,
      }));

      const source = await openPrepared(browser, {
        url: config.source_url, width, dpr, stableSelectors: sourceSelectors,
      });
      const sourceFull = path.join(shotDir, `full-${width}-source.png`);
      await source.page.screenshot({ path: sourceFull, fullPage: true });

      for (const target of config.targets) {
        const targetSelectors = visible.map((component) => ({
          key: `tgt-${component.id}`, css: component.target.css, matchIndex: component.target.match_index || 0,
        }));
        const deployed = await openPrepared(browser, {
          url: target.url, width, dpr, httpCredentials, stableSelectors: targetSelectors,
        });
        const targetFull = path.join(shotDir, `full-${width}-${target.mode}-target.png`);
        await deployed.page.screenshot({ path: targetFull, fullPage: true });

        const scrollbarDelta = deployed.readiness.scrollbar_width - source.readiness.scrollbar_width;
        const readinessBlocked = source.readiness.status !== 'PASS' || deployed.readiness.status !== 'PASS';
        // Landing on another path means an AEM login bounce or a sling:redirect, not a bad component.
        const redirectedTo = landedElsewhere(target.url, deployed.navigation.final_url);
        preflight.checks.push({
          breakpoint: width,
          mode: target.mode,
          source_url: source.navigation.final_url,
          target_url: deployed.navigation.final_url,
          target_redirected_to: redirectedTo,
          source_readiness: source.readiness.status,
          target_readiness: deployed.readiness.status,
          source_failures: source.readiness.failures,
          target_failures: redirectedTo
            ? [`target navigated away from ${target.url} to ${redirectedTo}`, ...deployed.readiness.failures]
            : deployed.readiness.failures,
          source_warnings: source.readiness.warnings,
          target_warnings: deployed.readiness.warnings,
          scrollbar_width_delta: scrollbarDelta,
          viewport: { requested: width, source: source.readiness.inner_width, target: deployed.readiness.inner_width },
          dpr: { source: source.readiness.dpr, target: deployed.readiness.dpr },
        });
        if (readinessBlocked || redirectedTo) preflight.status = 'FAIL';
        if (redirectedTo) preflight.environment_blocked = true;

        for (const component of visible) {
          process.stdout.write(`  ${width}px ${target.mode} ${component.id} ... `);
          const result = {
            component_id: component.id,
            breakpoint: width,
            mode: target.mode,
            status: 'WITHHELD',
            withheld_reason: null,
            exact_match: null,
            matched_pixels: null,
            differing_pixels: null,
            strict_differing_pixels: null,
            total_pixels: null,
            visual_match_ratio: null,
            visual_match_percent: null,
            scored_over: null,
            // Movement for remediation to steer by when no score may be issued. Never a score.
            progress_ratio: null,
            progress_percent: null,
            source: { url: source.navigation.final_url, selector: component.source.css, match_index: component.source.match_index || 0 },
            target: { url: deployed.navigation.final_url, selector: component.target.css, match_index: component.target.match_index || 0 },
            viewport: { requested: width, dpr, scrollbar_width_delta: scrollbarDelta },
            side_by_side: null,
            diff_mask: null,
            deltas: {},
          };

          if (readinessBlocked) {
            result.withheld_reason = 'capture readiness failed: '
              + [...source.readiness.failures.map((entry) => `source ${entry}`),
                ...deployed.readiness.failures.map((entry) => `target ${entry}`)].join('; ');
            result.owning_layer_hint = 'capture-readiness';
            results.push(result);
            console.log('WITHHELD (readiness)');
            continue;
          }

          const sourceInstance = await resolveInstance(source.page, component.source);
          const targetInstance = await resolveInstance(deployed.page, component.target);
          result.source.matches = sourceInstance.matches ?? 0;
          result.target.matches = targetInstance.matches ?? 0;
          result.source.rect = sourceInstance.rect || null;
          result.target.rect = targetInstance.rect || null;

          if (!sourceInstance.found || !targetInstance.found) {
            result.withheld_reason = !sourceInstance.found
              ? `source selector matched ${sourceInstance.matches ?? 0} elements`
              : `target selector matched ${targetInstance.matches ?? 0} elements`;
            result.owning_layer_hint = 'plan-or-selector';
            results.push(result);
            console.log(`WITHHELD (${result.withheld_reason})`);
            continue;
          }

          const sourceText = sourceInstance.inner_text || sourceInstance.text_content;
          const targetText = targetInstance.inner_text || targetInstance.text_content;
          result.deltas.text = {
            similarity: round(textSimilarity(sourceText, targetText), 4),
            source: sourceText.slice(0, 160),
            target: targetText.slice(0, 160),
          };

          // A stale config signature must not fail the run; only one that still matches the source can.
          if (component.signature_text) {
            const expected = normalizeText(component.signature_text).slice(0, 24);
            const matchesSource = expected
              && (normalizeText(sourceInstance.inner_text).includes(expected)
                || normalizeText(sourceInstance.text_content).includes(expected));
            const matchesTarget = expected
              && (normalizeText(targetInstance.inner_text).includes(expected)
                || normalizeText(targetInstance.text_content).includes(expected));
            result.deltas.signature = { expected, matches_source: Boolean(matchesSource), matches_target: Boolean(matchesTarget) };
            if (matchesSource && !matchesTarget) {
              result.withheld_reason = `target instance signature mismatch (expected "${expected}")`;
              result.owning_layer_hint = 'plan-or-selector';
              results.push(result);
              console.log('WITHHELD (signature mismatch)');
              continue;
            }
          }

          const base = `${component.id}-${width}-${target.mode}`;
          const sourceShot = path.join(shotDir, `${base}-source.png`);
          const targetShot = path.join(shotDir, `${base}-target.png`);
          await source.page.locator(component.source.css).nth(component.source.match_index || 0)
            .screenshot({ path: sourceShot });
          await deployed.page.locator(component.target.css).nth(component.target.match_index || 0)
            .screenshot({ path: targetShot });

          const sourceAnalysis = analysePng(fs.readFileSync(sourceShot));
          const targetAnalysis = analysePng(fs.readFileSync(targetShot));
          result.source.screenshot = relativePath(outDir, sourceShot);
          result.target.screenshot = relativePath(outDir, targetShot);
          result.source.dimensions = { w: sourceAnalysis.width, h: sourceAnalysis.height };
          result.target.dimensions = { w: targetAnalysis.width, h: targetAnalysis.height };
          result.source.bytes = fs.statSync(sourceShot).size;
          result.target.bytes = fs.statSync(targetShot).size;

          result.deltas.rect = {
            x: round((targetInstance.rect.x - sourceInstance.rect.x), 2),
            y: round((targetInstance.rect.y - sourceInstance.rect.y), 2),
            w: round((targetInstance.rect.w - sourceInstance.rect.w), 2),
            h: round((targetInstance.rect.h - sourceInstance.rect.h), 2),
          };
          result.deltas.styles = styleDeltas(
            await captureStyles(source.page, component.source),
            await captureStyles(deployed.page, component.target),
          ).slice(0, 40);

          const sourceFonts = await renderedFonts(source.page, component.source.css, component.source.match_index || 0);
          const targetFonts = await renderedFonts(deployed.page, component.target.css, component.target.match_index || 0);
          const sourceFamilies = (sourceFonts || []).map((font) => font.family);
          const targetFamilies = (targetFonts || []).map((font) => font.family);
          result.deltas.rendered_fonts = sourceFamilies.join('|') === targetFamilies.join('|')
            ? []
            : [{ source: sourceFamilies, target: targetFamilies }];

          result.deltas.playback = playbackDeltas(
            await capturePlayback(source.page, component.source),
            await capturePlayback(deployed.page, component.target),
          );

          const inventory = compareInventories(
            await readInventory(source.page, component.source),
            await readInventory(deployed.page, component.target),
            { pxTolerance },
          );
          result.deltas.inventory = inventory;
          result.gates = Object.fromEntries(Object.keys(GATE_LAYERS)
            .map((category) => [category, (inventory[category] || []).length ? 'FAIL' : 'PASS']));
          result.gates.rendered_fonts = result.deltas.rendered_fonts.length ? 'FAIL' : 'PASS';
          result.gates.playback = result.deltas.playback.length ? 'FAIL' : 'PASS';
          const failedGates = Object.entries(result.gates)
            .filter(([, value]) => value === 'FAIL')
            .map(([category]) => category);

          const cropProblem = validateCrop(sourceAnalysis, 'source') || validateCrop(targetAnalysis, 'target');
          if (cropProblem) {
            result.withheld_reason = cropProblem;
            result.owning_layer_hint = owningLayerHint(result);
            results.push(result);
            console.log(`WITHHELD (${cropProblem})`);
            continue;
          }
          const comparison = unionCompare(sourceAnalysis, targetAnalysis);
          if (!comparison) {
            result.withheld_reason = `crops share no comparable region: source ${sourceAnalysis.width}x${sourceAnalysis.height}, `
              + `target ${targetAnalysis.width}x${targetAnalysis.height}`;
            result.owning_layer_hint = 'geometry-container';
            results.push(result);
            console.log(`WITHHELD (${result.withheld_reason})`);
            continue;
          }

          const sameSize = comparison.total === comparison.overlap.total_pixels;
          const { width: cropWidth, height: cropHeight, diff } = comparison;
          const maskPath = path.join(shotDir, `${base}-mask.png`);
          fs.writeFileSync(maskPath, PNG.sync.write(diff));
          result.diff_mask = relativePath(outDir, maskPath);

          const differing = comparison.differing;
          const totalPixels = comparison.total;
          const ratio = (totalPixels - differing) / totalPixels;

          if (differing > 0) {
            const cells = diffHotCells(diff, {
              width: cropWidth,
              height: cropHeight,
              cellSize: Math.max(24, Math.round(Math.min(cropWidth, cropHeight) / 12)),
            });
            result.deltas.hot_regions = cells.length
              ? await elementsAtPoints(deployed.page, targetInstance.rect, cells)
              : [];
          } else {
            result.deltas.hot_regions = [];
          }

          // Unequal crops are never resized, stretched or padded into a passing score. The union
          // ratio is still recorded, but as progress only: it can move remediation, never the gate.
          if (!sameSize) {
            result.status = 'FAIL';
            result.geometry_status = 'FAIL';
            result.visual_status = 'WITHHELD';
            result.withheld_reason = `crop dimensions differ: source ${sourceAnalysis.width}x${sourceAnalysis.height}, `
              + `target ${targetAnalysis.width}x${targetAnalysis.height}`;
            result.deltas.dimension_mismatch = {
              source: { w: sourceAnalysis.width, h: sourceAnalysis.height },
              target: { w: targetAnalysis.width, h: targetAnalysis.height },
            };
            // Separates "the box is the wrong size" from "the content inside the box is wrong".
            result.deltas.overlap_diagnostic = {
              region: comparison.overlap.region,
              ratio: comparison.overlap.ratio,
              percent: round(comparison.overlap.ratio * 100, 2),
              differing_pixels: comparison.overlap.differing_pixels,
              total_pixels: comparison.overlap.total_pixels,
              note: 'common region only; never an authoritative score',
            };
            result.progress_ratio = ratio;
            result.progress_percent = round(ratio * 100, 2);
            const withheldPair = path.join(shotDir, `${base}-side-by-side.png`);
            await composeSideBySide(composePage, {
              sourcePath: sourceShot,
              targetPath: targetShot,
              outPath: withheldPair,
              caption: `${component.id} @ ${width}px (${target.mode}) — SCORE WITHHELD, crop sizes differ — `
                + `source ${sourceAnalysis.width}x${sourceAnalysis.height} vs AEM ${targetAnalysis.width}x${targetAnalysis.height} — `
                + `union progress ${round(ratio * 100, 2)}%, overlap ${round(comparison.overlap.ratio * 100, 2)}% (neither is a score)`,
            });
            result.side_by_side = relativePath(outDir, withheldPair);
            result.owning_layer_hint = owningLayerHint(result);
            results.push(result);
            console.log(`FAIL (unequal crops, progress ${round(ratio * 100, 2)}%, overlap ${round(comparison.overlap.ratio * 100, 2)}%`
              + `${failedGates.length ? `, gates: ${failedGates.join('/')}` : ''})`);
            continue;
          }

          result.scored_over = 'exact-crop';
          result.total_pixels = totalPixels;
          result.differing_pixels = differing;
          result.strict_differing_pixels = comparison.strict_differing;
          result.matched_pixels = totalPixels - differing;
          result.visual_match_ratio = ratio;
          result.visual_match_percent = round(ratio * 100, 2);
          result.exact_match = differing === 0;

          const sideBySidePath = path.join(shotDir, `${base}-side-by-side.png`);
          await composeSideBySide(composePage, {
            sourcePath: sourceShot,
            targetPath: targetShot,
            outPath: sideBySidePath,
            caption: `${component.id} @ ${width}px (${target.mode}) — ratio ${ratio.toFixed(4)} — `
              + `${totalPixels - differing}/${totalPixels} pixels matched — threshold &gt; ${threshold}`,
          });
          result.side_by_side = relativePath(outDir, sideBySidePath);

          const geometryPass = Math.abs(result.deltas.rect.x) <= GEOMETRY_TOLERANCE.x
            && Math.abs(result.deltas.rect.w) <= GEOMETRY_TOLERANCE.width
            && Math.abs(result.deltas.rect.h) <= GEOMETRY_TOLERANCE.height;
          result.geometry_status = geometryPass ? 'PASS' : 'FAIL';
          result.visual_status = ratio > threshold ? 'PASS' : 'FAIL';
          result.status = geometryPass && ratio > threshold && !failedGates.length ? 'PASS' : 'FAIL';
          result.owning_layer_hint = result.status === 'PASS' ? null : owningLayerHint(result);
          results.push(result);
          console.log(`${result.status} ${(ratio * 100).toFixed(2)}%${result.exact_match ? ' exact' : ''}`
            + `${failedGates.length ? ` [${failedGates.join('/')}]` : ''}`);
        }

        // Page composite for this breakpoint and mode.
        const sourceFullAnalysis = analysePng(fs.readFileSync(sourceFull));
        const targetFullAnalysis = analysePng(fs.readFileSync(targetFull));
        const compositeKey = `${width}-${target.mode}`;
        const heightDelta = targetFullAnalysis.height - sourceFullAnalysis.height;
        const widthDelta = targetFullAnalysis.width - sourceFullAnalysis.width;
        const overlap = overlapDiagnostic(sourceFullAnalysis, targetFullAnalysis);
        const gaps = interComponentGaps(results, width, target.mode, pxTolerance);
        const failedGaps = gaps.filter((gap) => gap.status === 'FAIL');
        const composite = {
          source_dimensions: { w: sourceFullAnalysis.width, h: sourceFullAnalysis.height },
          target_dimensions: { w: targetFullAnalysis.width, h: targetFullAnalysis.height },
          width_delta: widthDelta,
          height_delta: heightDelta,
          height_tolerance_px: pageHeightTolerance,
          inter_component_gaps: gaps,
          gap_tolerance_px: pxTolerance,
          source: relativePath(outDir, sourceFull),
          target: relativePath(outDir, targetFull),
        };
        if (overlap) {
          const maskPath = path.join(shotDir, `full-${compositeKey}-mask.png`);
          fs.writeFileSync(maskPath, PNG.sync.write(overlap.diff));
          composite.mask = relativePath(outDir, maskPath);
          composite.compared_region = overlap.region;
          composite.ratio = overlap.ratio;
          composite.percent = round(overlap.ratio * 100, 2);
          composite.differing_pixels = overlap.differing_pixels;
          composite.total_pixels = overlap.total_pixels;
          composite.exact_match = overlap.differing_pixels === 0 && heightDelta === 0 && widthDelta === 0;
          const withinTolerance = widthDelta === 0 && Math.abs(heightDelta) <= pageHeightTolerance;
          composite.status = overlap.ratio > threshold && withinTolerance && !failedGaps.length ? 'PASS' : 'FAIL';
          if (!withinTolerance) {
            composite.failure_reason = `page dimensions differ by ${widthDelta}x${heightDelta}px `
              + `(height tolerance ${pageHeightTolerance}px)`;
          }
          if (failedGaps.length) {
            composite.gap_failure_reason = failedGaps
              .map((gap) => `${gap.after}->${gap.before} ${gap.source_gap}px vs ${gap.target_gap}px (${gap.delta > 0 ? '+' : ''}${gap.delta})`)
              .join('; ');
          }
        } else {
          composite.ratio = null;
          composite.status = 'WITHHELD';
          composite.withheld_reason = `page screenshots are not comparable: source ${sourceFullAnalysis.width}x${sourceFullAnalysis.height}, `
            + `target ${targetFullAnalysis.width}x${targetFullAnalysis.height}`;
        }

        // A diagnostic aid must never be able to fail a measurement run.
        try {
          const compositePair = path.join(shotDir, `full-${compositeKey}-side-by-side.png`);
          await composeSideBySide(composePage, {
            sourcePath: sourceFull,
            targetPath: targetFull,
            outPath: compositePair,
            maxWidth: 520,
            caption: `whole page @ ${width}px (${target.mode}) \u2014 source ${sourceFullAnalysis.width}x${sourceFullAnalysis.height} `
              + `vs AEM ${targetFullAnalysis.width}x${targetFullAnalysis.height} \u2014 height delta ${heightDelta}px`,
          });
          composite.side_by_side = relativePath(outDir, compositePair);
        } catch (error) {
          composite.side_by_side = null;
          composite.side_by_side_error = error.message;
        }
        pageComposite[compositeKey] = composite;

        await deployed.page.context().close();
      }
      await source.page.context().close();
    }
  } finally {
    await composePage.context().close().catch(() => {});
    await browser.close();
  }

  // One component can own several parity targets across breakpoints. It is still one component
  // with one attempt budget, so it must appear once or remediation spends its budget twice over.
  const scoredIds = [...new Set(components.map((component) => component.id))];
  const perComponent = scoredIds.map((componentId) => {
    const rows = results.filter((result) => result.component_id === componentId);
    const ratios = rows.map((row) => row.visual_match_ratio).filter((value) => typeof value === 'number');
    // Withheld rows issue no score, so progress is the only thing remediation can steer by.
    const progress = rows
      .map((row) => (typeof row.visual_match_ratio === 'number' ? row.visual_match_ratio : row.progress_ratio))
      .filter((value) => typeof value === 'number');
    const failing = rows.filter((row) => row.status !== 'PASS');
    const failedGates = new Set();
    for (const row of rows) {
      for (const [category, value] of Object.entries(row.gates || {})) {
        if (value === 'FAIL') failedGates.add(category);
      }
    }
    return {
      component_id: componentId,
      status: rows.length === 0 ? 'SKIPPED' : failing.length ? (failing.every((row) => row.status === 'WITHHELD') ? 'WITHHELD' : 'FAIL') : 'PASS',
      min_ratio: ratios.length ? Math.min(...ratios) : null,
      min_progress_ratio: progress.length ? Math.min(...progress) : null,
      owning_layer_hint: failing.find((row) => row.owning_layer_hint)?.owning_layer_hint || null,
      failed_gates: Array.from(failedGates),
      breakpoints: Object.fromEntries(rows.map((row) => [`${row.breakpoint}-${row.mode}`, {
        status: row.status,
        ratio: row.visual_match_ratio,
        reason: row.withheld_reason,
        gates: row.gates || null,
      }])),
    };
  });

  const passed = perComponent.filter((entry) => entry.status === 'PASS');
  const withheld = perComponent.filter((entry) => entry.status === 'WITHHELD');
  const failed = perComponent.filter((entry) => entry.status === 'FAIL');
  const allRatios = results.map((row) => row.visual_match_ratio).filter((value) => typeof value === 'number');
  const compositeEntries = Object.values(pageComposite);
  const compositePass = compositeEntries.length > 0 && compositeEntries.every((entry) => entry.status === 'PASS');
  const scored = results.filter((row) => row.status === 'PASS' || row.status === 'FAIL');

  const artifact = {
    schema_version: 1,
    run_id: config.run_id || null,
    generated_at: new Date().toISOString(),
    cycle: options.cycle ? Number.parseInt(options.cycle, 10) : null,
    tool: {
      name: 'parity.mjs',
      version: TOOL_VERSION,
      dependencies: toolDependencies(toolRoot),
      browser: 'chromium',
    },
    threshold,
    runner_revision: runnerRevision(configPath),
    source_url: config.source_url,
    target_urls: Object.fromEntries(config.targets.map((target) => [target.mode, target.url])),
    breakpoints: config.breakpoints,
    preflight,
    results,
    components: perComponent,
    page_composite: pageComposite,
    summary: {
      components_total: perComponent.length,
      components_passed: passed.length,
      components_failed: failed.length,
      components_withheld: withheld.length,
      instances_scored: scored.length,
      instances_exact_match: scored.filter((row) => row.exact_match).length,
      min_ratio: allRatios.length ? Math.min(...allRatios) : null,
      page_composite_pass: compositePass,
      duration_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    },
    status: preflight.status === 'PASS' && !failed.length && !withheld.length && compositePass ? 'PASS' : 'FAIL',
  };

  const artifactPath = writeJson(path.join(outDir, 'parity.json'), artifact);

  console.log('\nComponent                         min ratio   status');
  for (const entry of perComponent) {
    const ratio = entry.min_ratio === null ? '  withheld' : `${(entry.min_ratio * 100).toFixed(2)}%`.padStart(9);
    const gates = entry.failed_gates.length ? ` gates:${entry.failed_gates.join(',')}` : '';
    console.log(`${entry.component_id.padEnd(32)} ${ratio}   ${entry.status}${entry.owning_layer_hint ? ` (${entry.owning_layer_hint})` : ''}${gates}`);
  }
  for (const [key, entry] of Object.entries(pageComposite)) {
    const value = entry.ratio === null ? `withheld (${entry.withheld_reason})` : `${entry.percent}%`;
    const size = entry.height_delta === undefined ? '' : ` [Δh ${entry.height_delta}px]`;
    const gaps = (entry.inter_component_gaps || []).filter((gap) => gap.status === 'FAIL').length;
    console.log(`page composite ${key.padEnd(17)} ${value}${size}${gaps ? ` [${gaps} gap(s)]` : ''}   ${entry.status}`);
  }
  console.log(`\nThreshold: > ${threshold} | components ${passed.length}/${perComponent.length} | `
    + `exact crops ${artifact.summary.instances_exact_match}/${artifact.summary.instances_scored} | status ${artifact.status}`);
  console.log(`Artifact: ${relativePath(process.cwd(), artifactPath)}`);
  process.exitCode = artifact.status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`parity.mjs failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
