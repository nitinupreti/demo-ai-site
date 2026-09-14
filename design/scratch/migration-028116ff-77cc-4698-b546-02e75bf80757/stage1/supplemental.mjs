import { chromium } from 'playwright';
import fs from 'fs';

const OUT = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('https://www.notion.com/customers/cursor', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(1500);

const footerDetail = await page.evaluate(() => {
  const footer = document.querySelector('footer#site-footer');
  if (!footer) return null;
  const links = Array.from(footer.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().slice(0,40), href: a.href }));
  const svgs = footer.querySelectorAll('svg').length;
  const copyrightNode = Array.from(footer.querySelectorAll('*')).find(el => /\u00a9|copyright|all rights reserved/i.test(el.textContent || '') && el.children.length <= 2);
  return {
    linkCount: links.length,
    links: links.slice(0, 40),
    svgCount: svgs,
    copyrightText: copyrightNode ? copyrightNode.textContent.trim().slice(0,120) : null,
  };
});

const heroDetail = await page.evaluate(() => {
  const hero = document.querySelector('main section, main section section');
  const h1 = document.querySelector('h1');
  const heroSection = h1 ? h1.closest('section') : null;
  const buttons = heroSection ? Array.from(heroSection.querySelectorAll('a,button')).map(b => ({ tag: b.tagName, text: b.textContent.trim().slice(0,40), href: b.href || null })) : [];
  const leadPara = heroSection ? (heroSection.querySelector('p')?.textContent.trim().slice(0,140) || null) : null;
  const closeIcon = heroSection ? !!heroSection.querySelector('svg') : false;
  return { h1: h1 ? h1.textContent.trim().slice(0,100) : null, buttons, leadPara, closeIcon };
});

const skipLink = await page.evaluate(() => {
  const a = document.querySelector('a[href="#main"], a.skip-link, [class*="skip" i]');
  return a ? { text: a.textContent.trim(), href: a.href } : null;
});

const logoStrip = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('[class*="logo" i]'));
  return candidates.slice(0, 10).map(c => ({ tag: c.tagName, class: c.className, text: c.textContent.trim().slice(0,40) }));
});

fs.writeFileSync(OUT, JSON.stringify({ footerDetail, heroDetail, skipLink, logoStrip }, null, 2));
console.log('done');
await browser.close();
