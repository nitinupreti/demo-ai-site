// Stage 4 pixel diff — component-level source vs target at each breakpoint.
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';

const OUT = path.resolve('parity');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const SITE_URL = 'https://www.notion.com/customers/cursor';
const TARGET_URL = 'http://localhost:4504/content/demo-ai-site/us/en/customers/cursor.html?wcmmode=disabled';
const auth = { username: 'admin', password: 'admin' };
const authHeader = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');

const BPS = [{ n: '1440', w: 1440, h: 900 }, { n: '768', w: 768, h: 1024 }, { n: '375', w: 375, h: 812 }];
const FREEZE = `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }`;

async function shot(page, sel, out) {
  const loc = page.locator(sel).first();
  const count = await loc.count();
  if (!count) return null;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(200);
  await loc.screenshot({ path: out });
  const rect = await loc.evaluate(el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  return rect;
}

async function capture(url, bp, headerSel, footerSel, heroSel, dir, extraHeaders) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: bp.w, height: bp.h }, deviceScaleFactor: 1, ...(extraHeaders ? { extraHTTPHeaders: extraHeaders, httpCredentials: auth } : {}) });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 50)); } window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 400)); });
  await page.evaluate((css) => {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }, FREEZE);
  await page.waitForTimeout(500);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const results = {};
  for (const [name, sel] of Object.entries({ header: headerSel, hero: heroSel, footer: footerSel })) {
    results[name] = await shot(page, sel, path.join(dir, `${name}.png`));
  }
  await b.close();
  return results;
}

function diff(srcPath, tgtPath, outPath) {
  if (!fs.existsSync(srcPath) || !fs.existsSync(tgtPath)) return null;
  const s = PNG.sync.read(fs.readFileSync(srcPath));
  const t = PNG.sync.read(fs.readFileSync(tgtPath));
  const W = Math.max(s.width, t.width);
  const H = Math.max(s.height, t.height);
  const pad = (img) => {
    if (img.width === W && img.height === H) return img;
    const out = new PNG({ width: W, height: H });
    // fill white
    for (let i = 0; i < out.data.length; i += 4) { out.data[i]=255; out.data[i+1]=255; out.data[i+2]=255; out.data[i+3]=255; }
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const srcIdx = (y * img.width + x) * 4;
        const dstIdx = (y * W + x) * 4;
        out.data[dstIdx] = img.data[srcIdx];
        out.data[dstIdx+1] = img.data[srcIdx+1];
        out.data[dstIdx+2] = img.data[srcIdx+2];
        out.data[dstIdx+3] = img.data[srcIdx+3];
      }
    }
    return out;
  };
  const A = pad(s), B = pad(t);
  const mask = new PNG({ width: W, height: H });
  const differing = pixelmatch(A.data, B.data, mask.data, W, H, { threshold: 0.15, includeAA: true });
  fs.writeFileSync(outPath, PNG.sync.write(mask));
  // side-by-side
  const sbs = new PNG({ width: W * 2 + 20, height: H });
  for (let i = 0; i < sbs.data.length; i += 4) { sbs.data[i]=245; sbs.data[i+1]=245; sbs.data[i+2]=245; sbs.data[i+3]=255; }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const srcIdx = (y * W + x) * 4;
      const dstL = (y * (W * 2 + 20) + x) * 4;
      const dstR = (y * (W * 2 + 20) + x + W + 20) * 4;
      for (let c = 0; c < 4; c++) sbs.data[dstL + c] = A.data[srcIdx + c];
      for (let c = 0; c < 4; c++) sbs.data[dstR + c] = B.data[srcIdx + c];
    }
  }
  fs.writeFileSync(outPath.replace('mask', 'sbs'), PNG.sync.write(sbs));
  const total = W * H;
  const matched = total - differing;
  const pct = (matched / total) * 100;
  return { W, H, matched, differing, total, visualMatchPercent: Number(pct.toFixed(3)) };
}

(async () => {
  const report = {};
  for (const bp of BPS) {
    console.log(`--- ${bp.n} ---`);
    const srcDir = path.join(OUT, bp.n, 'source');
    const tgtDir = path.join(OUT, bp.n, 'target');
    // Source selectors — Notion cursor customer page
    const srcHeader = 'nav[class*="globalNavigation-module"]';
    const srcFooter = 'footer[class*="surface"]';
    const srcHero = 'section[class*="HeroStories"], section[class*="hero"]';
    console.log(`[src] capturing`);
    const srcRects = await capture(SITE_URL, bp, srcHeader, srcFooter, srcHero, srcDir, null);
    console.log(`[tgt] capturing`);
    const tgtRects = await capture(TARGET_URL, bp, '.site-header', '.site-footer', '.hero', tgtDir, { Authorization: authHeader });
    const bpReport = { srcRects, tgtRects, components: {} };
    for (const c of ['header', 'hero', 'footer']) {
      const src = path.join(srcDir, `${c}.png`);
      const tgt = path.join(tgtDir, `${c}.png`);
      const maskPath = path.join(OUT, bp.n, `${c}-mask.png`);
      const d = diff(src, tgt, maskPath);
      bpReport.components[c] = d;
      console.log(`  ${c}: ${d ? d.visualMatchPercent + '%' : 'MISSING'}`);
    }
    report[bp.n] = bpReport;
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DONE');
})();
