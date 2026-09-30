#!/usr/bin/env node
/**
 * Regression capture for pages this run did not migrate but may have changed: a component extended
 * for a new source still renders on every page that used it before. Captures each page before the
 * run first installs anything and again at the end, then compares the pairs pixel for pixel.
 *
 *   node design/site-url/tools/regression.mjs --config <file> --out <dir> --label before|after
 *   node design/site-url/tools/regression.mjs --compare --out <dir>
 *
 * Config: { "pages": [{ "id": "...", "url": "..." }], "breakpoints": [375, 1440],
 *           "auth": { "username": "admin", "password_env": "AEM_PASSWORD" } }
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import {
  createPage, launchBrowser, navigate, prepareForCapture,
} from './lib/browser.mjs';
import {
  ensureDir, parseArgs, readJson, writeJson,
} from './lib/util.mjs';

// Same size and at least this share of identical pixels: anything else is a visible change.
const UNCHANGED_RATIO = 0.999;

async function capture(config, outDir, label) {
  const password = process.env[config.auth?.password_env || 'AEM_PASSWORD'];
  const dir = ensureDir(path.join(outDir, label));
  const browser = await launchBrowser();
  const captures = [];
  try {
    for (const page of config.pages) {
      for (const width of config.breakpoints) {
        const origin = new URL(page.url).origin;
        const tab = await createPage(browser, {
          width,
          dpr: config.dpr || 1,
          httpCredentials: config.auth?.username ? { username: config.auth.username, password, origin } : undefined,
        });
        const file = `${page.id}-${width}.png`;
        try {
          const navigation = await navigate(tab, page.url);
          const readiness = await prepareForCapture(tab, { width });
          await tab.screenshot({ path: path.join(dir, file), fullPage: true });
          captures.push({
            page: page.id, url: page.url, width, file, http_status: navigation.http_status, readiness: readiness.status,
          });
        } catch (error) {
          captures.push({ page: page.id, url: page.url, width, file: null, error: error.message.split('\n')[0] });
        } finally {
          await tab.context().close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  writeJson(path.join(dir, 'capture.json'), { label, captured_at: new Date().toISOString(), captures });
  console.log(`${label}: ${captures.filter((entry) => entry.file).length}/${captures.length} captures in ${dir}`);
}

export function comparePair(beforePath, afterPath) {
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  const after = PNG.sync.read(fs.readFileSync(afterPath));
  if (before.width !== after.width || before.height !== after.height) {
    return {
      status: 'CHANGED', ratio: null, reason: `size ${before.width}x${before.height} -> ${after.width}x${after.height}`,
    };
  }
  const diff = new PNG({ width: before.width, height: before.height });
  const differing = pixelmatch(before.data, after.data, diff.data, before.width, before.height, { threshold: 0.1 });
  const ratio = 1 - differing / (before.width * before.height);
  return {
    status: ratio >= UNCHANGED_RATIO ? 'UNCHANGED' : 'CHANGED', ratio, differing, diff,
  };
}

function compare(outDir) {
  const before = readJson(path.join(outDir, 'before', 'capture.json'));
  const after = readJson(path.join(outDir, 'after', 'capture.json'));
  const pages = [];
  for (const entry of after.captures) {
    const baseline = before.captures.find((candidate) => candidate.page === entry.page && candidate.width === entry.width);
    if (!baseline?.file || !entry.file) {
      pages.push({
        page: entry.page, url: entry.url, width: entry.width, status: 'UNMEASURED', reason: entry.error || baseline?.error || 'no baseline',
      });
      continue;
    }
    const result = comparePair(path.join(outDir, 'before', baseline.file), path.join(outDir, 'after', entry.file));
    let mask = null;
    if (result.diff && result.status === 'CHANGED') {
      mask = `${entry.page}-${entry.width}-mask.png`;
      fs.writeFileSync(path.join(outDir, mask), PNG.sync.write(result.diff));
    }
    pages.push({
      page: entry.page,
      url: entry.url,
      width: entry.width,
      status: result.status,
      ratio: result.ratio,
      reason: result.reason || null,
      before: path.join('before', baseline.file),
      after: path.join('after', entry.file),
      mask,
    });
  }
  const changed = pages.filter((page) => page.status === 'CHANGED');
  writeJson(path.join(outDir, 'regression.json'), {
    status: changed.length ? 'CHANGED' : 'PASS', compared_at: new Date().toISOString(), pages,
  });
  for (const page of pages) {
    console.log(`${page.status.padEnd(10)} ${page.page} @${page.width}${page.ratio === null || page.ratio === undefined ? '' : ` ${(page.ratio * 100).toFixed(2)}%`}`
      + `${page.reason ? ` (${page.reason})` : ''}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { values: ['config', 'out', 'label'], flags: ['compare', 'help'] });
  if (options.help || !options.out || (!options.compare && (!options.config || !options.label))) {
    console.log('regression.mjs --config <file> --out <dir> --label before|after  |  --compare --out <dir>');
    process.exitCode = options.help ? 0 : 2;
    return;
  }
  const outDir = ensureDir(path.resolve(options.out));
  if (options.compare) compare(outDir);
  else await capture(readJson(path.resolve(options.config)), outDir, options.label);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`regression.mjs failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
