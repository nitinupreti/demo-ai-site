#!/usr/bin/env node
/**
 * Frozen deterministic source capture for the AEM migration pipeline.
 * Replaces the Stage 1 prose tables with a machine-readable, sliceable artifact.
 *
 *   node design/site-url/tools/discover.mjs --url <live-url> --out <dir> [--breakpoints 375,768,1440]
 *
 * No agent may hand-write, edit or estimate the output of this tool.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  BAND_STEP_PX,
  CLASS_FAMILY_SOURCE,
  DEFAULT_BREAKPOINTS,
  EMBED_HOSTS,
  MAX_UNCLAIMED_GAP_PX,
  MIN_BLOCK_HEIGHT_PX,
  MIN_BLOCK_WIDTH_PX,
  MISSABLE_SOURCE,
  SCORE_DENOMINATORS,
  STYLE_PROPERTIES,
  TOOL_VERSION,
} from './lib/contracts.mjs';
import { createPage, launchBrowser, navigate, prepareForCapture } from './lib/browser.mjs';
import { scanPage } from './lib/page-scan.mjs';
import {
  ensureDir, parseArgs, parseBreakpoints, relativePath, sha256, toolDependencies, writeJson,
} from './lib/util.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`
discover.mjs - deterministic source discovery

  --url <url>              Live source URL (required)
  --out <dir>              Output directory (required)
  --breakpoints <list>     Comma-separated widths (default: ${DEFAULT_BREAKPOINTS.join(',')})
  --dpr <number>           Device pixel ratio (default: 1)
  --run-id <id>            Run identifier recorded in the artifact
  --settle-ms <number>     Dynamic-injection settle time (default: 3000); a breakpoint whose
                           geometry is still moving is recaptured once at 3x this value
  --headed                 Run Chromium headed
  --help
`);
}

function identityKey(block) {
  const signature = block.signature;
  const text = (signature.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  // Responsive srcset changes the media URL per breakpoint, so media only identifies text-free blocks.
  const media = text.length >= 12
    ? ''
    : String(signature.media || '').split(/[/?#]/).filter(Boolean).pop() || '';
  return [signature.tag, text.slice(0, 40), media, signature.aria_label || ''].join('|');
}

function normalizeProbe(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function captureBreakpoint(browser, { url, width, dpr, settleMs }) {
  const page = await createPage(browser, { width, dpr });
  try {
    const navigation = await navigate(page, url);
    const readinessFirst = await prepareForCapture(page, { width, dynamicSettleMs: settleMs });

    const scan = await page.evaluate(scanPage, {
      classFamilySource: CLASS_FAMILY_SOURCE,
      missableSource: MISSABLE_SOURCE,
      embedHosts: EMBED_HOSTS,
      styleProperties: STYLE_PROPERTIES,
      minWidth: MIN_BLOCK_WIDTH_PX,
      minHeight: MIN_BLOCK_HEIGHT_PX,
      bandStep: BAND_STEP_PX,
    });

    // 01-source-discovery.md requires re-checking stability once the candidate union is known.
    const stableSelectors = scan.blocks.map((block, index) => ({
      key: `block-${index}`,
      css: block.selector.css,
      matchIndex: block.selector.match_index,
    }));
    const readiness = await prepareForCapture(page, { width, dynamicSettleMs: 0, stableSelectors });
    readiness.fonts_checked = readinessFirst.fonts_checked;

    return { page, navigation, readiness, scan };
  } catch (error) {
    await page.context().close();
    throw error;
  }
}

/**
 * Geometry that is still moving means a script reflowed the page after the settle expired. The
 * scan taken alongside it is just as invalid as the readiness reading: block boundaries measured
 * mid-reflow collapse into whichever ancestor still spans them, so the breakpoint is recaptured
 * rather than reported as unstable.
 */
const RESCAN_SETTLE_MULTIPLIER = 3;

function geometryStillMoving(readiness) {
  return (readiness.failures || []).some((failure) => failure.startsWith('unstable geometry'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2), {
    values: ['url', 'out', 'breakpoints', 'dpr', 'run-id', 'settle-ms'],
    flags: ['headed', 'help'],
    defaults: { breakpoints: DEFAULT_BREAKPOINTS.join(','), dpr: '1', 'settle-ms': '3000' },
  });
  if (options.help || !options.url || !options.out) {
    usage();
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  const breakpoints = parseBreakpoints(options.breakpoints);
  const dpr = Number.parseFloat(options.dpr);
  const settleMs = Number.parseInt(options['settle-ms'], 10);
  const outDir = ensureDir(path.resolve(options.out));
  const startedAt = Date.now();

  const browser = await launchBrowser({ headless: !options.headed });
  const perBreakpoint = {};
  const failures = [];
  let sourceMeta = null;

  try {
    for (const width of breakpoints) {
      process.stdout.write(`  capturing ${width}px ... `);
      let capture = await captureBreakpoint(browser, {
        url: options.url, width, dpr, settleMs,
      });
      if (geometryStillMoving(capture.readiness)) {
        await capture.page.context().close();
        const retrySettleMs = settleMs * RESCAN_SETTLE_MULTIPLIER;
        process.stdout.write(`still moving, recapturing at ${retrySettleMs}ms ... `);
        capture = await captureBreakpoint(browser, {
          url: options.url, width, dpr, settleMs: retrySettleMs,
        });
        capture.readiness.recaptured_with_settle_ms = retrySettleMs;
      }
      const { page, navigation, readiness, scan } = capture;
      const screenshotName = `full-${width}-source.png`;
      await page.screenshot({ path: path.join(outDir, screenshotName), fullPage: true });
      await page.context().close();

      sourceMeta = sourceMeta || { navigation, metadata: scan.metadata };
      perBreakpoint[width] = { navigation, readiness, scan, screenshot: screenshotName };

      if (readiness.status !== 'PASS') failures.push(`readiness ${width}px: ${readiness.failures.join('; ')}`);
      if (scan.coverage.max_unclaimed_gap >= MAX_UNCLAIMED_GAP_PX) {
        failures.push(`coverage ${width}px: unclaimed gap of ${scan.coverage.max_unclaimed_gap}px`);
      }
      console.log(`${scan.blocks.length} blocks, gap ${scan.coverage.max_unclaimed_gap}px, readiness ${readiness.status}`);
    }
  } finally {
    await browser.close();
  }

  // Merge blocks across breakpoints into one instance set.
  const merged = new Map();
  for (const width of breakpoints) {
    const seen = new Map();
    for (const block of perBreakpoint[width].scan.blocks) {
      const base = identityKey(block);
      const occurrence = (seen.get(base) || 0);
      seen.set(base, occurrence + 1);
      const key = occurrence ? `${base}#${occurrence}` : base;
      if (!merged.has(key)) merged.set(key, { key, byBreakpoint: {} });
      merged.get(key).byBreakpoint[width] = block;
    }
  }

  // The descendant carrying a section's signal can change with the viewport, so one section can
  // arrive under a different key at each width. A slot that section occupied alone does not change,
  // so entries that never coexist at a breakpoint but held the same sole slot are one section.
  const slotKey = (block) => (block.section_slot
    ? `${block.section_slot.css}#${block.section_slot.match_index}`
    : null);
  const entries = Array.from(merged.values());
  for (const entry of entries) {
    if (entry.absorbed) continue;
    const slots = new Set(Object.values(entry.byBreakpoint).map(slotKey).filter(Boolean));
    if (!slots.size) continue;
    for (const other of entries) {
      if (other === entry || other.absorbed) continue;
      if (Object.keys(other.byBreakpoint).some((width) => entry.byBreakpoint[width])) continue;
      if (!Object.values(other.byBreakpoint).some((block) => slots.has(slotKey(block)))) continue;
      Object.assign(entry.byBreakpoint, other.byBreakpoint);
      for (const block of Object.values(other.byBreakpoint)) {
        if (slotKey(block)) slots.add(slotKey(block));
      }
      other.absorbed = true;
    }
  }

  const pageHeights = Object.fromEntries(breakpoints.map((width) => [width, perBreakpoint[width].scan.page.height]));
  // `identityKey` keys on tag and text, both of which legitimately change shape across breakpoints,
  // so a missing key means "not separately identified" — never "not on the page". Asserting absence
  // from a failed match is what teaches a component to hide itself at a breakpoint it belongs on.
  const textByBreakpoint = Object.fromEntries(breakpoints.map((width) => [
    width,
    perBreakpoint[width].scan.blocks
      .map((block) => normalizeProbe(block.signature?.text))
      .join('\u0001'),
  ]));
  const ordered = entries
    .filter((entry) => !entry.absorbed)
    .map((entry) => {
      const positions = Object.entries(entry.byBreakpoint)
        .map(([width, block]) => block.rect.top / Math.max(pageHeights[width], 1));
      return { ...entry, position: positions.reduce((sum, value) => sum + value, 0) / positions.length };
    })
    .sort((a, b) => a.position - b.position);

  const instances = ordered.map((entry, index) => {
    const id = `inst-${String(index + 1).padStart(3, '0')}`;
    const instance = {
      id,
      order: index + 1,
      label: null,
      signals: [],
      selector: {},
      rect: {},
      visibility_by_bp: {},
      signature: null,
      styles: {},
      media: {},
      repeated_children: {},
      class_chain: [],
    };
    for (const width of breakpoints) {
      const block = entry.byBreakpoint[width];
      instance.visibility_by_bp[width] = Boolean(block);
      if (!block) continue;
      instance.selector[width] = block.selector;
      instance.rect[width] = block.rect;
      instance.styles[width] = block.styles;
      instance.media[width] = block.media;
      instance.repeated_children[width] = block.repeated_children;
      instance.signals = Array.from(new Set([...instance.signals, ...block.signals])).sort((a, b) => a - b);
      instance.signature = instance.signature || block.signature;
      instance.class_chain = instance.class_chain.length ? instance.class_chain : block.class_chain;
      instance.label = instance.label || block.signature.text.slice(0, 40) || block.tag;
    }
    // Where no key matched, the section is often still on the page under a different shape. Only
    // its own text can settle that, and a section wrongly marked absent gets hidden in CSS later.
    const probe = normalizeProbe(instance.signature?.text).slice(0, 40);
    for (const width of breakpoints) {
      if (instance.visibility_by_bp[width]) continue;
      instance.visibility_by_bp[width] = probe.length >= 12 && textByBreakpoint[width].includes(probe);
    }
    return instance;
  });

  const fingerprintInput = instances.map((instance) => breakpoints
    .map((width) => {
      const rect = instance.rect[width];
      const selector = instance.selector[width];
      return rect
        ? `${instance.id}@${width}:${selector.css}#${selector.match_index}:${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`
        : `${instance.id}@${width}:absent`;
    })
    .join('|')).join('\n');

  const artifact = {
    schema_version: 1,
    run_id: options['run-id'] || null,
    generated_at: new Date().toISOString(),
    tool: {
      name: 'discover.mjs',
      version: TOOL_VERSION,
      dependencies: toolDependencies(toolRoot),
      browser: 'chromium',
      source_sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    },
    source: {
      requested_url: options.url,
      final_url: sourceMeta?.navigation.final_url || options.url,
      http_status: sourceMeta?.navigation.http_status ?? null,
      metadata: sourceMeta?.metadata || {},
    },
    breakpoints,
    dpr,
    source_fingerprint: sha256(fingerprintInput),
    readiness: breakpoints.map((width) => perBreakpoint[width].readiness),
    instances,
    coverage: Object.fromEntries(breakpoints.map((width) => [width, {
      page_height: perBreakpoint[width].scan.page.height,
      page_width: perBreakpoint[width].scan.page.width,
      bands: perBreakpoint[width].scan.coverage.bands,
      max_unclaimed_gap: perBreakpoint[width].scan.coverage.max_unclaimed_gap,
      status: perBreakpoint[width].scan.coverage.max_unclaimed_gap < MAX_UNCLAIMED_GAP_PX ? 'PASS' : 'FAIL',
    }])),
    screenshots: Object.fromEntries(breakpoints.map((width) => [width, perBreakpoint[width].screenshot])),
    denominators: SCORE_DENOMINATORS,
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    duration_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
  };

  const artifactPath = writeJson(path.join(outDir, 'discovery.json'), artifact);

  console.log(`\nInstances: ${instances.length}`);
  console.log(`Fingerprint: ${artifact.source_fingerprint}`);
  console.log(`Status: ${artifact.status}`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`Artifact: ${relativePath(process.cwd(), artifactPath)}`);
  process.exitCode = artifact.status === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  console.error(`discover.mjs failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
