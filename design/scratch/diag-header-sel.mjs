// Diagnose Notion source header selector.
import { chromium } from 'playwright';
const SITE_URL = 'https://www.notion.com/customers/cursor';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3000);
  const info = await p.evaluate(() => {
    const cands = [
      'header', 'nav[aria-label*="Primary" i]', 'nav[aria-label*="global" i]',
      '[class*="globalNavigation"]', '[class*="GlobalNavigation"]',
      '[class*="header"] nav', 'div[class*="globalNav"]', 'body > div nav'
    ];
    return cands.map(sel => {
      const el = document.querySelector(sel);
      if (!el) return { sel, hit: false };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { sel, hit: true, tag: el.tagName, cls: (el.className || '').toString().slice(0, 120), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, position: cs.position, top: cs.top };
    });
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
