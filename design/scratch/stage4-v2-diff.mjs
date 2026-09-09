// Stage 4 v2 diff: 7 components across 3 breakpoints. Live source vs :4504 target.
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';

const OUT = path.resolve('parity-v2');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const SITE_URL = 'https://www.notion.com/customers/cursor';
const TARGET_URL = 'http://localhost:4504/content/demo-ai-site/us/en/customers/cursor.html?wcmmode=disabled';
const auth = { username: 'admin', password: 'admin' };
const authHeader = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
const BPS = [{ n: '1440', w: 1440, h: 900 }, { n: '768', w: 768, h: 1024 }, { n: '375', w: 375, h: 812 }];
const FREEZE = `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }`;

const COMPS = [
  { key: 'site-header',        src: 'nav[class*="globalNavigation-module"]',                                  tgt: '.site-header' },
  { key: 'hero',               src: 'section[class*="HeroStories"], section[class*="hero"]',                  tgt: '.hero' },
  { key: 'pull-quote',         src: 'figure[class*="quote-module"]',                                          tgt: '.pull-quote' },
  { key: 'media-with-caption', src: 'figure[class*="mediaWithCaption-module"]',                               tgt: '.media-with-caption' },
  { key: 'cta-band',           src: 'section:has(> div[class*="flex-col"][class*="items-center"])',           tgt: '.cta-band' },
  { key: 'case-study-grid',    src: 'div[class*="relatedCaseStudies"]',                                       tgt: '.case-study-grid' },
  { key: 'site-footer',        src: 'footer[class*="surface"]',                                               tgt: '.site-footer' }
];

async function shot(page, sel, out) {
  try {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) return null;
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(180);
    await loc.screenshot({ path: out });
    return await loc.evaluate(el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  } catch (e) { return null; }
}

async function capture(url, bp, dir, extraHeaders) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: bp.w, height: bp.h }, deviceScaleFactor: 1, ...(extraHeaders ? { extraHTTPHeaders: extraHeaders, httpCredentials: auth } : {}) });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => { const H = document.documentElement.scrollHeight; for (let y = 0; y < H; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 500)); });
  await page.evaluate(css => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }, FREEZE);
  await page.waitForTimeout(500);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rects = {};
  for (const c of COMPS) rects[c.key] = await shot(page, url === SITE_URL ? c.src : c.tgt, path.join(dir, `${c.key}.png`));
  await b.close();
  return rects;
}

function pad(img, W, H) {
  if (img.width === W && img.height === H) return img;
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i]=255; out.data[i+1]=255; out.data[i+2]=255; out.data[i+3]=255; }
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const si = (y * img.width + x) * 4, di = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) out.data[di + c] = img.data[si + c];
  }
  return out;
}

function diff(srcPath, tgtPath, maskPath, sbsPath) {
  if (!fs.existsSync(srcPath) || !fs.existsSync(tgtPath)) return null;
  const s = PNG.sync.read(fs.readFileSync(srcPath));
  const t = PNG.sync.read(fs.readFileSync(tgtPath));
  const W = Math.max(s.width, t.width), H = Math.max(s.height, t.height);
  const A = pad(s, W, H), B = pad(t, W, H);
  const mask = new PNG({ width: W, height: H });
  const differing = pixelmatch(A.data, B.data, mask.data, W, H, { threshold: 0.15, includeAA: true });
  fs.writeFileSync(maskPath, PNG.sync.write(mask));

  const gap = 20;
  const bannerH = 32;
  const sbs = new PNG({ width: W * 2 + gap, height: H + bannerH });
  for (let i = 0; i < sbs.data.length; i += 4) { sbs.data[i]=245; sbs.data[i+1]=245; sbs.data[i+2]=245; sbs.data[i+3]=255; }
  // banner rows: LIVE in dark, AEM in blue
  const paintBanner = (xStart, xEnd, r, g, b) => {
    for (let y = 0; y < bannerH; y++) for (let x = xStart; x < xEnd; x++) {
      const idx = (y * (W * 2 + gap) + x) * 4;
      sbs.data[idx] = r; sbs.data[idx+1] = g; sbs.data[idx+2] = b; sbs.data[idx+3] = 255;
    }
  };
  paintBanner(0, W, 20, 20, 20);
  paintBanner(W + gap, W * 2 + gap, 27, 79, 148);
  // Copy crops below the banner
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 4;
    const dstY = y + bannerH;
    const dL = (dstY * (W * 2 + gap) + x) * 4, dR = (dstY * (W * 2 + gap) + x + W + gap) * 4;
    for (let c = 0; c < 4; c++) { sbs.data[dL + c] = A.data[si + c]; sbs.data[dR + c] = B.data[si + c]; }
  }
  fs.writeFileSync(sbsPath, PNG.sync.write(sbs));
  const total = W * H, matched = total - differing;
  return { W, H, matched, differing, total, visualMatchPercent: Number((matched / total * 100).toFixed(3)), sideBySidePath: sbsPath, maskPath };
}

(async () => {
  const report = {};
  for (const bp of BPS) {
    console.log(`--- ${bp.n} ---`);
    const srcDir = path.join(OUT, bp.n, 'source');
    const tgtDir = path.join(OUT, bp.n, 'target');
    const srcRects = await capture(SITE_URL, bp, srcDir, null);
    const tgtRects = await capture(TARGET_URL, bp, tgtDir, { Authorization: authHeader });
    const bpReport = { srcRects, tgtRects, components: {} };
    for (const c of COMPS) {
      const d = diff(path.join(srcDir, `${c.key}.png`), path.join(tgtDir, `${c.key}.png`), path.join(OUT, bp.n, `${c.key}-mask.png`), path.join(OUT, bp.n, `${c.key}-sbs.png`));
      bpReport.components[c.key] = d;
      console.log(`  ${c.key.padEnd(20)} ${d ? d.visualMatchPercent + '%' : 'MISSING'}`);
    }
    report[bp.n] = bpReport;
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DONE');
})();
