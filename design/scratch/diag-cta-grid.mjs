// Inspect Notion's cta-band computed styles to guide remediation.
import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('https://www.notion.com/customers/cursor', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => window.scrollTo(0, 5000));
  await p.waitForTimeout(1000);
  const info = await p.evaluate(() => {
    // Notion's CTA is the section containing "Build with less tool sprawl"
    const all = Array.from(document.querySelectorAll('section'));
    const cta = all.find(s => /less tool sprawl/i.test(s.textContent || ''));
    if (!cta) return { found: false };
    const cs = getComputedStyle(cta);
    const r = cta.getBoundingClientRect();
    return {
      found: true,
      cls: (cta.className||'').toString().slice(0,120),
      rect: { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height },
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage.slice(0,60),
      color: cs.color,
      fontFamily: cs.fontFamily,
      padding: cs.padding,
      textAlign: cs.textAlign,
      innerHTML: cta.innerHTML.slice(0, 400)
    };
  });
  console.log(JSON.stringify(info, null, 2));

  // Also check case-study-grid layout
  const grid = await p.evaluate(() => {
    const g = document.querySelector('[class*="relatedCaseStudies"]');
    if (!g) return { found: false };
    const cs = getComputedStyle(g);
    const r = g.getBoundingClientRect();
    const tiles = Array.from(g.querySelectorAll('a, article, [class*="tile"], [class*="card"]')).slice(0, 4).map(t => { const tr = t.getBoundingClientRect(); return { tag: t.tagName, cls: (t.className||'').toString().slice(0,80), w: Math.round(tr.width), h: Math.round(tr.height) }; });
    return { found: true, cls: (g.className||'').toString().slice(0,120), bg: cs.backgroundColor, display: cs.display, gridTemplate: cs.gridTemplateColumns, rect: { w: r.width, h: r.height }, tiles };
  });
  console.log('--- grid ---');
  console.log(JSON.stringify(grid, null, 2));
  await b.close();
})();
