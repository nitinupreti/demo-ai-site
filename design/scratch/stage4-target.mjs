// Stage 4 target capture — AEM 4504 disabled-mode screenshots at 3 breakpoints.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const TARGET_URL = 'http://localhost:4504/content/demo-ai-site/us/en/customers/cursor.html?wcmmode=disabled';
const BREAKPOINTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '375', width: 375, height: 812 }
];
const OUT = path.resolve('target-shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const auth = { username: 'admin', password: 'admin' };
const authHeader = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');

const FREEZE_CSS = `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }`;

(async () => {
  for (const bp of BREAKPOINTS) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 1,
      httpCredentials: auth,
      extraHTTPHeaders: { Authorization: authHeader }
    });
    const page = await context.newPage();
    console.log(`[${bp.name}] navigating ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.waitForTimeout(500);
    const viewport = await page.evaluate(() => ({ innerWidth: window.innerWidth, dpr: window.devicePixelRatio, height: document.documentElement.scrollHeight }));
    const bpDir = path.join(OUT, bp.name);
    if (!fs.existsSync(bpDir)) fs.mkdirSync(bpDir, { recursive: true });
    await page.screenshot({ path: path.join(bpDir, 'screenshot.png'), fullPage: true });

    // Component crops
    const roots = await page.evaluate(() => {
      const pick = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
      };
      return {
        siteHeader: pick('.site-header'),
        hero: pick('.hero'),
        siteFooter: pick('.site-footer')
      };
    });
    fs.writeFileSync(path.join(bpDir, 'roots.json'), JSON.stringify({ viewport, roots }, null, 2));
    for (const [name, r] of Object.entries(roots)) {
      if (!r) continue;
      try {
        const loc = page.locator(name === 'siteHeader' ? '.site-header' : name === 'hero' ? '.hero' : '.site-footer').first();
        await loc.screenshot({ path: path.join(bpDir, `${name}.png`) });
      } catch (e) { console.log(`[${bp.name}] ${name} crop failed`, e.message); }
    }
    await browser.close();
    console.log(`[${bp.name}] captured; viewport=${viewport.innerWidth}, page height=${viewport.height}`);
  }
})();
