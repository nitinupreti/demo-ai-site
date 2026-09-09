// Inspect Notion's hero computed styles at 1440.
import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('https://www.notion.com/customers/cursor', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(3500);
  const info = await p.evaluate(() => {
    const hero = document.querySelector('section[class*="HeroStories"], section[class*="hero"]');
    if (!hero) return { found: false };
    const cs = getComputedStyle(hero);
    const r = hero.getBoundingClientRect();
    const inner = hero.querySelector('[class*="content"]');
    const media = hero.querySelector('[class*="media"]');
    const h1 = hero.querySelector('h1');
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      bg: cs.backgroundColor, color: cs.color, padding: cs.padding, display: cs.display, gridTemplate: cs.gridTemplateColumns,
      content: inner ? { rect: inner.getBoundingClientRect(), cls: (inner.className||'').toString().slice(0,80) } : null,
      media: media ? { rect: media.getBoundingClientRect(), cls: (media.className||'').toString().slice(0,80) } : null,
      h1: h1 ? { rect: h1.getBoundingClientRect(), font: getComputedStyle(h1).fontFamily.slice(0,80), size: getComputedStyle(h1).fontSize, weight: getComputedStyle(h1).fontWeight, lineHeight: getComputedStyle(h1).lineHeight } : null
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
