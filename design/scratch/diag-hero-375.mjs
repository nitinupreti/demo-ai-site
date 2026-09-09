// Inspect Notion hero at 375 for a mobile-accurate rebuild.
import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 375, height: 812 } })).newPage();
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
      hero: { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, bg: cs.backgroundColor, padding: cs.padding, display: cs.display, gridTemplate: cs.gridTemplateColumns },
      content: inner ? { rect: inner.getBoundingClientRect() } : null,
      media: media ? { rect: media.getBoundingClientRect(), cls: (media.className||'').toString().slice(0,80) } : null,
      h1: h1 ? { rect: h1.getBoundingClientRect(), size: getComputedStyle(h1).fontSize, weight: getComputedStyle(h1).fontWeight, lineHeight: getComputedStyle(h1).lineHeight, textAlign: getComputedStyle(h1).textAlign } : null
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
