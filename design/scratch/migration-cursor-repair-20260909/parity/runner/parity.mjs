import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
const scratchRoot = path.resolve(here, '../../..');
const require = createRequire(path.join(scratchRoot, 'package.json'));
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;
const config = JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
const outputRoot = path.resolve(here, '..');
const freezeCss = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}';

async function readyPage(browser, url, breakpoint, authenticate) {
  const context = await browser.newContext({
    viewport: { width: breakpoint.width, height: breakpoint.height },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (authenticate && page.url().includes('/login.html')) {
    const username = process.env.AEM_USER;
    const password = process.env.AEM_PASSWORD;
    if (!username || !password) {
      throw new Error('AEM_USER and AEM_PASSWORD are required for the target capture');
    }
    await page.locator('input[name="j_username"], input#username').fill(username);
    await page.locator('input[name="j_password"], input#password').fill(password);
    await Promise.all([
      page.waitForURL((currentUrl) => !currentUrl.pathname.includes('/login.html'), { timeout: 30000 }),
      page.locator('button[type="submit"]').click()
    ]);
  }
  await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    window.scrollTo(0, 0);
    await Promise.all([...document.querySelectorAll('video')].map((video) => new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      const seek = () => {
        clearTimeout(timeout);
        video.pause();
        try {
          video.currentTime = 0;
        } catch (error) {
          // A media stream without a seekable range remains paused at its initial frame.
        }
        resolve();
      };
      if (video.readyState >= 1) seek();
      else video.addEventListener('loadedmetadata', seek, { once: true });
    })));
  });
  await page.evaluate((css) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }, freezeCss);
  await page.waitForTimeout(500);
  return { context, page };
}

async function capture(page, selector, filePath) {
  const locator = page.locator(selector).first();
  if (await locator.count() !== 1 || !await locator.isVisible()) {
    return { status: 'INVALID', reason: 'selector did not resolve to one visible first instance' };
  }
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const text = (await locator.innerText()).replace(/\s+/g, ' ').trim();
  await locator.screenshot({ path: filePath });
  const image = PNG.sync.read(fs.readFileSync(filePath));
  return {
    status: image.width > 1 && image.height > 1 ? 'PASS' : 'INVALID',
    box,
    pixels: { width: image.width, height: image.height },
    text: text.slice(0, 160),
    file: path.relative(outputRoot, filePath).replaceAll('\\', '/')
  };
}

function compare(source, target, maskPath) {
  if (source.status !== 'PASS' || target.status !== 'PASS') {
    return { status: 'SCORE_WITHHELD', reason: 'missing or invalid crop' };
  }
  if (source.pixels.width !== target.pixels.width || source.pixels.height !== target.pixels.height) {
    return {
      status: 'SCORE_WITHHELD',
      reason: 'crop dimensions differ',
      sourcePixels: source.pixels,
      targetPixels: target.pixels
    };
  }
  const sourcePng = PNG.sync.read(fs.readFileSync(path.join(outputRoot, source.file)));
  const targetPng = PNG.sync.read(fs.readFileSync(path.join(outputRoot, target.file)));
  const mask = new PNG({ width: sourcePng.width, height: sourcePng.height });
  const differingPixels = pixelmatch(
    sourcePng.data,
    targetPng.data,
    mask.data,
    sourcePng.width,
    sourcePng.height,
    { threshold: 0.15, includeAA: true }
  );
  fs.writeFileSync(maskPath, PNG.sync.write(mask));
  const totalPixels = sourcePng.width * sourcePng.height;
  const matchedPixels = totalPixels - differingPixels;
  const visualMatchRatio = matchedPixels / totalPixels;
  return {
    status: visualMatchRatio > 0.90 ? 'PASS' : 'FAIL',
    matchedPixels,
    differingPixels,
    totalPixels,
    visualMatchRatio,
    visualMatchPercent: Number((visualMatchRatio * 100).toFixed(3)),
    mask: path.relative(outputRoot, maskPath).replaceAll('\\', '/')
  };
}

const browser = await chromium.launch();
const report = { generatedAt: new Date().toISOString(), config, breakpoints: {} };
try {
  for (const breakpoint of config.breakpoints) {
    const breakpointRoot = path.join(outputRoot, 'evidence', breakpoint.name);
    fs.mkdirSync(path.join(breakpointRoot, 'source'), { recursive: true });
    fs.mkdirSync(path.join(breakpointRoot, 'target'), { recursive: true });
    const source = await readyPage(browser, config.sourceUrl, breakpoint, false);
    const target = await readyPage(browser, config.targetUrl, breakpoint, true);
    await source.page.screenshot({ path: path.join(breakpointRoot, 'full-source.png'), fullPage: true });
    await target.page.screenshot({ path: path.join(breakpointRoot, 'full-target.png'), fullPage: true });
    const components = {};
    for (const component of config.components) {
      const sourceCapture = await capture(source.page, component.source, path.join(breakpointRoot, 'source', `${component.id}.png`));
      const targetCapture = await capture(target.page, component.target, path.join(breakpointRoot, 'target', `${component.id}.png`));
      const comparison = compare(sourceCapture, targetCapture, path.join(breakpointRoot, `${component.id}-mask.png`));
      components[component.id] = { source: sourceCapture, target: targetCapture, comparison };
      console.log(`${breakpoint.name} ${component.id}: ${comparison.status}${comparison.visualMatchPercent ? ` ${comparison.visualMatchPercent}%` : ''}`);
    }
    report.breakpoints[breakpoint.name] = {
      sourceUrl: source.page.url(),
      targetUrl: target.page.url(),
      components
    };
    await source.context.close();
    await target.context.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));