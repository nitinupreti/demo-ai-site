#!/usr/bin/env node
// Stage 4 parity runner: one page load per (mode, breakpoint); every crop comes from that page state.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

const runnerPath = fileURLToPath(import.meta.url);
const toolsDir = path.dirname(runnerPath);
const routerPath = path.resolve(toolsDir, '..', 'prompt_new.md');
const lockfilePath = path.join(toolsDir, 'package-lock.json');

const GEOMETRY_SAMPLES = 3;
const SAMPLE_INTERVAL_MS = 600; // router requires >= 500 ms between samples
const NAV_TIMEOUT_MS = 90_000;
const MODES = ['disabled', 'author'];

const HELP = `parity-runner — Stage 4 screenshot scoring for design/site-url migrations

  node design/site-url/tools/parity-runner.mjs --config <parity-config.json> [options]

  --only <ids>        Comma-separated instance IDs to capture and score (remediation recapture).
  --mode <modes>      Comma-separated subset of: disabled, author. Default: both.
  --bp <widths>       Comma-separated subset of the contract breakpoints. Default: all.
  --concurrency <n>   Page states captured in parallel. Default: 3.
  --preflight         Capture and validate the first instance only, then exit.
  --force-source      Recapture source evidence even when the fingerprint re-verifies.
  --help

  Credentials come from AEM_USER and AEM_PASSWORD. Thresholds come from the router contract
  and cannot be overridden here. Full records land under <evidenceDir>/parity/; stdout carries
  counts, artifact paths, and failing rows only.
`;

function parseArgs(argv) {
  const args = { concurrency: 3 };
  const list = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') args.help = true;
    else if (token === '--preflight') args.preflight = true;
    else if (token === '--force-source') args.forceSource = true;
    else if (token === '--config') args.config = argv[++index];
    else if (token === '--only') args.only = list(argv[++index]);
    else if (token === '--mode') args.modes = list(argv[++index]);
    else if (token === '--bp') args.breakpoints = list(argv[++index]).map(Number);
    else if (token === '--concurrency') args.concurrency = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

// The router owns every threshold, so the runner reads them instead of restating them.
function readContract() {
  const text = fs.readFileSync(routerPath, 'utf8');
  const breakpoints = text.match(/^required_breakpoints: \[([^\]]+)\]/m);
  const ratio = text.match(/^visual_pass_ratio: "> ([0-9.]+)"/m);
  const tolerance = text.match(/^geometry_tolerance_css_px: (\d+)/m);
  if (!breakpoints || !ratio || !tolerance) throw new Error(`Canonical run contract not parseable from ${routerPath}`);
  return {
    breakpoints: breakpoints[1].split(',').map((value) => Number(value.trim())),
    ratio: Number(ratio[1]),
    tolerance: Number(tolerance[1]),
  };
}

const sha256 = (file) => (fs.existsSync(file)
  ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  : null);
const sha256String = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const writeJson = (file, value) => {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Readiness is scoped to this page state: one pass covers every crop taken from it.
async function assertReadiness(page, { width, roots, samples, intervalMs, tolerance }) {
  return page.evaluate(async (input) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const record = {
      finalUrl: location.href,
      timestamp: new Date().toISOString(),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualViewportScale: window.visualViewport ? window.visualViewport.scale : null,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      failures: [],
    };
    if (window.innerWidth !== input.width) {
      record.failures.push(`innerWidth ${window.innerWidth} does not match requested ${input.width}`);
    }

    await document.fonts.ready;
    record.fonts = [...document.fonts].map((face) => ({
      family: face.family, weight: face.weight, style: face.style, status: face.status,
    }));
    if (record.fonts.some((face) => face.status !== 'loaded')) record.failures.push('a custom font face is not loaded');

    const step = Math.max(200, window.innerHeight - 100);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await sleep(60);
    }
    window.scrollTo(0, 0);
    await sleep(250);

    const visibleImages = [...document.images].filter((image) => image.getBoundingClientRect().width > 0);
    const undecoded = visibleImages.filter((image) => !(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0));
    record.images = { visible: visibleImages.length, undecoded: undecoded.map((image) => image.currentSrc || image.src) };
    if (undecoded.length) record.failures.push(`${undecoded.length} visible image(s) not decoded`);

    // Video decode and deterministic frame must happen before motion is frozen.
    record.videos = [];
    for (const video of document.querySelectorAll('video')) {
      if (video.getBoundingClientRect().width === 0) continue;
      video.scrollIntoView({ block: 'center' });
      await sleep(150);
      if (video.readyState < 2) {
        await new Promise((resolve) => {
          video.addEventListener('loadeddata', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }
      video.pause();
      if (video.readyState >= 2) {
        video.currentTime = 0.01;
        await new Promise((resolve) => {
          video.addEventListener('seeked', resolve, { once: true });
          setTimeout(resolve, 3000);
        });
        await new Promise((resolve) => (video.requestVideoFrameCallback
          ? video.requestVideoFrameCallback(() => resolve())
          : requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      const entry = {
        currentSrc: video.currentSrc,
        readyState: video.readyState,
        networkState: video.networkState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        currentTime: video.currentTime,
      };
      record.videos.push(entry);
      if (!(entry.readyState >= 2 && entry.videoWidth > 0 && entry.videoHeight > 0)) {
        record.failures.push(`video not decoded: ${entry.currentSrc || '(no currentSrc)'}`);
      }
    }

    // One batched pass over the whole element set per sample; per-element serialization adds no evidence.
    const targets = [
      { id: 'documentElement', selector: 'html', index: 0 },
      { id: 'body', selector: 'body', index: 0 },
      { id: 'main', selector: 'main', index: 0 },
      ...input.roots,
    ];
    const passes = [];
    for (let sample = 0; sample < input.samples; sample += 1) {
      passes.push(targets.map(({ selector, index }) => {
        const element = document.querySelectorAll(selector)[index];
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      }));
      if (sample < input.samples - 1) await sleep(input.intervalMs);
    }
    record.geometry = targets.map((target, position) => {
      const observed = passes.map((pass) => pass[position]).filter(Boolean);
      if (observed.length !== passes.length) return { ...target, present: false };
      const unstable = observed.slice(1).some((rect) => rect
        .some((value, axis) => Math.abs(value - observed[0][axis]) > input.tolerance));
      if (unstable) record.failures.push(`unstable geometry for ${target.id}`);
      return { ...target, present: true, samples: observed, stable: !unstable };
    });

    return record;
  }, { width, roots, samples, intervalMs, tolerance });
}

const freezeMotion = (page) => page.addStyleTag({
  content: '*,*::before,*::after{animation:none!important;transition:none!important}html{scroll-behavior:auto!important}',
});

async function captureState(browser, {
  role, mode, url, editorUrl, breakpoint, config, instances, outDir, contract,
}) {
  const context = await browser.newContext({
    viewport: { width: breakpoint, height: config.viewportHeight ?? 900 },
    deviceScaleFactor: config.deviceScaleFactor ?? 1,
    httpCredentials: role === 'target' && process.env.AEM_USER
      ? { username: process.env.AEM_USER, password: process.env.AEM_PASSWORD ?? '' }
      : undefined,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(config.settleMs ?? 3000); // dynamic-injection window from discovery

  const roots = instances.map((instance) => ({
    id: instance.id,
    selector: instance[role].selector,
    index: instance[role].matchIndex ?? 0,
  }));
  const readiness = await assertReadiness(page, {
    width: breakpoint, roots, samples: GEOMETRY_SAMPLES, intervalMs: SAMPLE_INTERVAL_MS, tolerance: contract.tolerance,
  });
  readiness.role = role;
  readiness.mode = mode;
  readiness.breakpoint = breakpoint;
  readiness.editorUrl = editorUrl ?? null;
  await freezeMotion(page);

  ensureDir(outDir);
  const fullPath = path.join(outDir, `full-${breakpoint}-${role}.png`);
  await page.screenshot({ path: fullPath, fullPage: true });

  const crops = {};
  for (const instance of instances) {
    const target = instance[role];
    const locator = page.locator(target.selector).nth(target.matchIndex ?? 0);
    const matches = await page.locator(target.selector).count();
    const expectedVisible = (instance.visibleAt ?? contract.breakpoints).includes(breakpoint);
    if (!expectedVisible) {
      crops[instance.id] = { skipped: 'hidden at this breakpoint', visibleMatches: matches };
      continue;
    }
    if (matches === 0) {
      crops[instance.id] = { error: `selector resolved 0 matches: ${target.selector}` };
      readiness.failures.push(`${instance.id}: selector resolved 0 matches in ${role}`);
      continue;
    }
    const cropPath = path.join(outDir, `${instance.id}-${breakpoint}-${role}.png`);
    await locator.scrollIntoViewIfNeeded();
    await locator.screenshot({ path: cropPath });
    crops[instance.id] = { path: cropPath, matches };
  }

  await context.close();
  return { readiness, fullPath, crops };
}

async function composeSideBySide(browser, { left, right, out }) {
  const leftPng = PNG.sync.read(fs.readFileSync(left));
  const rightPng = PNG.sync.read(fs.readFileSync(right));
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#101014;color:#fff;font:600 14px/1.6 system-ui">
<div style="display:flex;align-items:flex-start;gap:12px;padding:12px">
<figure style="margin:0"><figcaption>LIVE SITE</figcaption><img src="${pathToFileURL(left).href}" width="${leftPng.width}"></figure>
<figure style="margin:0"><figcaption>AEM</figcaption><img src="${pathToFileURL(right).href}" width="${rightPng.width}"></figure>
</div></body>`;
  const scratch = `${out}.compose.html`;
  fs.writeFileSync(scratch, html);
  const page = await browser.newPage({ viewport: { width: leftPng.width + rightPng.width + 48, height: 600 } });
  await page.goto(pathToFileURL(scratch).href, { waitUntil: 'load' });
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
  fs.unlinkSync(scratch);
}

async function score(browser, { sourcePath, targetPath, outDir, prefix, evidenceDir, config }) {
  const relative = (file) => path.relative(evidenceDir, file).split(path.sep).join('/');
  const source = PNG.sync.read(fs.readFileSync(sourcePath));
  const target = PNG.sync.read(fs.readFileSync(targetPath));
  const sideBySide = path.join(outDir, `${prefix}-side-by-side.png`);
  await composeSideBySide(browser, { left: sourcePath, right: targetPath, out: sideBySide });

  if (source.width !== target.width || source.height !== target.height) {
    return {
      withheld: 'SCORE WITHHELD — INVALID OR MISSING SCREENSHOT EVIDENCE',
      reason: `source ${source.width}x${source.height} !== target ${target.width}x${target.height}`,
      sourceScreenshot: relative(sourcePath),
      targetScreenshot: relative(targetPath),
      sideBySide: relative(sideBySide),
    };
  }

  const diff = new PNG({ width: source.width, height: source.height });
  const differingPixels = pixelmatch(source.data, target.data, diff.data, source.width, source.height, {
    threshold: config.pixelmatch?.threshold ?? 0.1,
    includeAA: config.pixelmatch?.includeAA ?? false,
  });
  const maskPath = path.join(outDir, `${prefix}-mask.png`);
  fs.writeFileSync(maskPath, PNG.sync.write(diff));

  const totalPixels = source.width * source.height;
  return {
    matchedPixels: totalPixels - differingPixels,
    differingPixels,
    totalPixels,
    ratio: (totalPixels - differingPixels) / totalPixels,
    sourceScreenshot: relative(sourcePath),
    targetScreenshot: relative(targetPath),
    sideBySide: relative(sideBySide),
    mask: relative(maskPath),
  };
}

async function sourceFingerprint(browser, config, breakpoint) {
  const context = await browser.newContext({ viewport: { width: breakpoint, height: 900 } });
  const page = await context.newPage();
  await page.goto(config.sourceUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
  const signature = await page.evaluate((instances) => ({
    title: document.title,
    signatures: instances.map(({ id, selector, index }) => {
      const element = document.querySelectorAll(selector)[index];
      return { id, text: element ? (element.textContent ?? '').trim().slice(0, 60) : null };
    }),
  }), config.instances.map((instance) => ({
    id: instance.id, selector: instance.source.selector, index: instance.source.matchIndex ?? 0,
  })));
  await context.close();
  return { ...signature, hash: sha256String(JSON.stringify(signature)) };
}

async function run(args) {
  const contract = readContract();
  const configPath = path.resolve(args.config);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const evidenceDir = path.resolve(path.dirname(configPath), config.evidenceDir ?? '.');
  const parityDir = path.join(evidenceDir, 'parity');
  const revision = {
    runner: sha256(runnerPath),
    config: sha256(configPath),
    lockfile: sha256(lockfilePath),
  };
  revision.id = sha256String(`${revision.runner}|${revision.config}|${revision.lockfile}`).slice(0, 12);

  const breakpoints = (args.breakpoints ?? contract.breakpoints).filter((bp) => contract.breakpoints.includes(bp));
  const modes = (args.modes ?? MODES).filter((mode) => MODES.includes(mode));
  let instances = config.instances.filter((instance) => !args.only || args.only.includes(instance.id));
  if (args.preflight) instances = instances.slice(0, 1);
  if (instances.length === 0) throw new Error('No instances selected');

  const browser = await chromium.launch();
  const failures = [];
  try {
    const fingerprintPath = path.join(parityDir, 'source-fingerprint.json');
    const live = await sourceFingerprint(browser, config, Math.max(...breakpoints));
    const stored = fs.existsSync(fingerprintPath) ? JSON.parse(fs.readFileSync(fingerprintPath, 'utf8')) : null;
    if (config.sourceFingerprint && config.sourceFingerprint !== live.hash) {
      throw new Error('Live source fingerprint does not match Stage 1 — source drift returns to discovery');
    }
    // Source captures stay valid while the fingerprint and the runner revision both re-verify.
    const reuseSource = !args.forceSource && stored?.hash === live.hash && stored?.revision === revision.id;
    if (!reuseSource) writeJson(fingerprintPath, { ...live, revision: revision.id });

    const sourceStates = new Map();
    await mapPool(breakpoints, args.concurrency, async (breakpoint) => {
      const outDir = path.join(parityDir, 'source', String(breakpoint));
      const cached = path.join(outDir, 'state.json');
      if (reuseSource && fs.existsSync(cached)) {
        sourceStates.set(breakpoint, JSON.parse(fs.readFileSync(cached, 'utf8')));
        return;
      }
      const state = await captureState(browser, {
        role: 'source', mode: 'source', url: config.sourceUrl, breakpoint, config, instances, outDir, contract,
      });
      writeJson(cached, state);
      sourceStates.set(breakpoint, state);
    });

    const states = modes.flatMap((mode) => breakpoints.map((breakpoint) => ({ mode, breakpoint })));
    const perInstance = [];
    const fullPage = [];

    await mapPool(states, args.concurrency, async ({ mode, breakpoint }) => {
      const targetConfig = config.target[mode];
      const outDir = path.join(parityDir, 'evidence', mode);
      const target = await captureState(browser, {
        role: 'target',
        mode,
        url: targetConfig.url,
        editorUrl: targetConfig.editorUrl,
        breakpoint,
        config,
        instances,
        outDir,
        contract,
      });
      const source = sourceStates.get(breakpoint);
      writeJson(path.join(parityDir, 'records', `readiness-${mode}-${breakpoint}.json`), {
        source: source.readiness, target: target.readiness, revision,
      });
      for (const readiness of [source.readiness, target.readiness]) {
        for (const failure of readiness.failures) {
          failures.push({ mode, breakpoint, instance_id: null, check: 'capture_readiness', detail: failure });
        }
      }

      // Mode-specific source copies keep concurrent modes from overwriting each other.
      const modeSource = path.join(outDir, `full-${breakpoint}-source.png`);
      fs.copyFileSync(source.fullPath, modeSource);
      const meta = {
        breakpoint,
        mode,
        sourceUrl: source.readiness.finalUrl,
        targetUrl: target.readiness.finalUrl,
        editorUrl: target.readiness.editorUrl,
        timestamp: new Date().toISOString(),
        viewport: `${breakpoint}x${config.viewportHeight ?? 900}`,
        devicePixelRatio: target.readiness.devicePixelRatio,
        runnerRevision: revision.id,
      };

      const pageScore = await score(browser, {
        sourcePath: modeSource,
        targetPath: target.fullPath,
        outDir,
        prefix: `full-${breakpoint}`,
        evidenceDir,
        config,
      });
      if (pageScore.withheld) {
        failures.push({ ...meta, instance_id: '(full page)', check: 'full_page_pair_valid', detail: pageScore.reason });
        fullPage.push({ ...meta, ...pageScore });
      } else {
        const { ratio, ...rest } = pageScore;
        fullPage.push({ ...meta, ...rest, fullPageVisualMatchRatio: ratio });
        if (!(ratio > contract.ratio)) {
          failures.push({ ...meta, instance_id: '(full page)', check: 'full_page_score', ratio });
        }
      }

      for (const instance of instances) {
        const sourceCrop = source.crops[instance.id];
        const targetCrop = target.crops[instance.id];
        if (sourceCrop?.skipped || targetCrop?.skipped) {
          if ((targetCrop?.visibleMatches ?? 0) > 0) {
            failures.push({ ...meta, instance_id: instance.id, check: 'hidden_state', detail: 'expected hidden but rendered' });
          }
          continue;
        }
        if (sourceCrop?.error || targetCrop?.error) {
          failures.push({
            ...meta,
            instance_id: instance.id,
            check: 'selector_resolves',
            detail: sourceCrop?.error ?? targetCrop.error,
          });
          continue;
        }
        const instanceScore = await score(browser, {
          sourcePath: sourceCrop.path,
          targetPath: targetCrop.path,
          outDir,
          prefix: `${instance.id}-${breakpoint}`,
          evidenceDir,
          config,
        });
        if (instanceScore.withheld) {
          failures.push({ ...meta, instance_id: instance.id, check: 'screenshot_pair_valid', detail: instanceScore.reason });
          perInstance.push({ ...meta, instance_id: instance.id, ...instanceScore });
          continue;
        }
        const { ratio, ...rest } = instanceScore;
        perInstance.push({ ...meta, instance_id: instance.id, ...rest, visualMatchRatio: ratio });
        if (!(ratio > contract.ratio)) {
          failures.push({ ...meta, instance_id: instance.id, check: 'screenshot_score', ratio });
        }
      }
    });

    const scoresPath = path.join(parityDir, 'scores.json');
    writeJson(scoresPath, { revision, contract, per_instance_scores: perInstance, full_page_scores: fullPage });

    // Failure-only handoff: full records stay on disk, stdout carries counts and failing rows.
    process.stdout.write(`${JSON.stringify({
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      preflight: Boolean(args.preflight),
      sourceEvidence: reuseSource ? 'reused (fingerprint and revision re-verified)' : 'recaptured',
      counts: {
        instances: instances.length,
        states: states.length,
        instanceScores: perInstance.length,
        fullPageScores: fullPage.length,
        failures: failures.length,
      },
      revision,
      artifacts: { scores: scoresPath, evidence: path.join(parityDir, 'evidence') },
      failures,
    }, null, 2)}\n`);
    return failures.length === 0 ? 0 : 1;
  } finally {
    await browser.close();
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.config) {
  process.stdout.write(HELP);
  process.exit(args.help ? 0 : 2);
}
process.exit(await run(args));
