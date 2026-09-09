// Enumerate Notion's actual case-study tiles at 1440.
import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('https://www.notion.com/customers/cursor', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => window.scrollTo(0, 5500));
  await p.waitForTimeout(1000);
  const info = await p.evaluate(() => {
    const grid = document.querySelector('[class*="relatedCaseStudies"]');
    if (!grid) return { found: false };
    const heading = grid.parentElement.querySelector('h1, h2, h3');
    const tiles = Array.from(grid.querySelectorAll('a, article, [class*="card"]')).slice(0, 6).map(t => {
      const r = t.getBoundingClientRect();
      const eb = t.querySelector('[class*="eyebrow"], [class*="Eyebrow"], p:first-of-type');
      const title = t.querySelector('h2, h3, h4, [class*="title" i]');
      const img = t.querySelector('img');
      return {
        tag: t.tagName,
        rect: { w: Math.round(r.width), h: Math.round(r.height) },
        eyebrow: eb ? eb.textContent.trim().slice(0, 60) : null,
        title: title ? title.textContent.trim().slice(0, 90) : null,
        img: img ? img.src.slice(0, 120) : null
      };
    });
    return { heading: heading ? heading.textContent.trim() : null, tiles };
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
