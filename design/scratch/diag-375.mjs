// Diagnose target hero+header at 375 vs source to inform CSS remediation.
import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch();
  const src = await (await b.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await src.goto('https://www.notion.com/customers/cursor', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await src.waitForTimeout(3500);
  await src.evaluate(() => window.scrollTo(0, 0));
  await src.waitForTimeout(500);
  const s = await src.evaluate(() => {
    const nav = document.querySelector('nav[class*="globalNavigation-module"]');
    const hero = document.querySelector('section[class*="HeroStories"], section[class*="hero"]');
    const g = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily, padding: cs.padding, display: cs.display }; };
    return { nav: g(nav), hero: g(hero) };
  });
  console.log('SOURCE 375');
  console.log(JSON.stringify(s, null, 2));

  const authHeader = 'Basic ' + Buffer.from('admin:admin').toString('base64');
  const tgt = await (await b.newContext({ viewport: { width: 375, height: 812 }, extraHTTPHeaders: { Authorization: authHeader }, httpCredentials: { username: 'admin', password: 'admin' } })).newPage();
  await tgt.goto('http://localhost:4504/content/demo-ai-site/us/en/customers/cursor.html?wcmmode=disabled', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await tgt.waitForTimeout(2000);
  const t = await tgt.evaluate(() => {
    const nav = document.querySelector('.site-header');
    const hero = document.querySelector('.hero');
    const g = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily, padding: cs.padding, display: cs.display }; };
    return { nav: g(nav), hero: g(hero) };
  });
  console.log('TARGET 375');
  console.log(JSON.stringify(t, null, 2));
  await b.close();
})();
