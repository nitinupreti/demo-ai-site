#!/usr/bin/env node
/**
 * Frozen deterministic content capture for one page: the full text, links, media and forms of
 * every block discover.mjs found. Discovery keeps only enough text to recognise a block; this keeps
 * enough to author it.
 *
 *   node design/site-url/tools/extract.mjs --discovery <dir>/discovery.json --out <dir>
 *
 * No agent may hand-write, edit or estimate the output of this tool.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createPage, launchBrowser, navigate, triggerLazyLoad } from './lib/browser.mjs';
import { scanContent } from './lib/content-scan.mjs';
import { TOOL_VERSION } from './lib/contracts.mjs';
import {
  ensureDir, parseArgs, readJson, relativePath, sha256, toolDependencies, writeJson,
} from './lib/util.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const MAX_HTML_CHARS = 60000;

function usage() {
  console.log(`
extract.mjs - deterministic block content capture

  --discovery <file>   discovery.json written by discover.mjs for the page (required)
  --out <dir>          Output directory for content.json (required)
  --run-id <id>        Run identifier recorded in the artifact
  --settle-ms <n>      Pause after scrolling, so scroll-revealed content is in place (default 3000)
  --headed             Run Chromium headed
  --help
`);
}

/** Each block is read at the widest width discovery saw it at, so a mobile-only block is read where it exists. */
function widestBreakpoint(instance, breakpoints) {
  return [...breakpoints].sort((left, right) => right - left).find((width) => instance.selector?.[width]?.css) ?? null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2), {
    values: ['discovery', 'out', 'run-id', 'settle-ms'],
    flags: ['headed', 'help'],
    defaults: { 'settle-ms': '3000' },
  });
  if (options.help || !options.discovery || !options.out) {
    usage();
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  const startedAt = Date.now();
  const settleMs = Number.parseInt(options['settle-ms'], 10);
  const discoveryPath = path.resolve(options.discovery);
  const discovery = readJson(discoveryPath);
  const url = discovery.source?.final_url || discovery.source?.requested_url;
  const outDir = ensureDir(path.resolve(options.out));
  const failures = [];

  const groups = new Map();
  for (const instance of discovery.instances || []) {
    const width = widestBreakpoint(instance, discovery.breakpoints || []);
    if (width === null) continue;
    if (!groups.has(width)) groups.set(width, []);
    const selector = instance.selector[width];
    groups.get(width).push({ id: instance.id, css: selector.css, match_index: selector.match_index || 0 });
  }

  const read = new Map();
  const browser = await launchBrowser({ headless: !options.headed });
  try {
    for (const [width, targets] of [...groups].sort(([left], [right]) => right - left)) {
      process.stdout.write(`  reading ${targets.length} block(s) at ${width}px ... `);
      const page = await createPage(browser, { width });
      try {
        await navigate(page, url);
        await triggerLazyLoad(page);
        await page.waitForTimeout(settleMs);
        const scanned = await page.evaluate(scanContent, { targets, maxHtmlChars: MAX_HTML_CHARS });
        for (const entry of scanned) read.set(entry.id, { ...entry, breakpoint: width });
        const missing = scanned.filter((entry) => !entry.found).length;
        console.log(`${scanned.length - missing} read${missing ? `, ${missing} no longer on the page` : ''}`);
      } catch (error) {
        failures.push(`${width}px: ${String(error?.message || error).split('\n')[0]}`);
        console.log('failed');
      } finally {
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
  }

  const instances = (discovery.instances || []).map((instance) => ({
    label: instance.label,
    ...(read.get(instance.id) || { id: instance.id, found: false }),
  }));
  const unread = instances.filter((instance) => !instance.found).map((instance) => instance.id);
  if (unread.length) failures.push(`blocks not read: ${unread.join(', ')}`);

  const artifact = {
    schema_version: 1,
    run_id: options['run-id'] || null,
    generated_at: new Date().toISOString(),
    tool: {
      name: 'extract.mjs',
      version: TOOL_VERSION,
      dependencies: toolDependencies(toolRoot),
      browser: 'chromium',
      source_sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    },
    source: {
      url,
      discovery: relativePath(outDir, discoveryPath),
      source_fingerprint: discovery.source_fingerprint || null,
    },
    instances,
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    duration_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
  };
  const artifactPath = writeJson(path.join(outDir, 'content.json'), artifact);

  const items = instances.reduce((sum, instance) => sum + (instance.items?.length || 0), 0);
  console.log(`\nBlocks: ${instances.length - unread.length}/${instances.length}  items: ${items}`);
  console.log(`Status: ${artifact.status}`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`Artifact: ${relativePath(process.cwd(), artifactPath)}`);
  process.exitCode = artifact.status === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  console.error(`extract.mjs failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
