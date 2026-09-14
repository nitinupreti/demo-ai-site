// Stage 1 source discovery runner: 11-signal union, coverage bands, inventory, media/metadata manifest.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SITE_URL = process.argv[2];
const OUT_DIR = process.argv[3];
const BREAKPOINTS = (process.argv[4] || '375,768,1440').split(',').map(Number);

const CLASS_FAMILY_SRC = '(section|wrapper|container|block|panel|band|strip|bar|marquee|ticker|scroller|carousel|slider|announce|promo|cta|hero|footer|header|feature|nav|banner|consent|cookie|toast|snackbar|modal|drawer|sticky|float)';
const MISSABLE = ['promo','marquee','ticker','announcement','cookie','consent','back-to-top','breadcrumb','logo-strip','stats','quote','divider','pinned','newsletter','region-selector','search-overlay','mega-menu','skip-link','preloader','progress','chat'];
const THIRD_PARTY_HOSTS = ['youtube.com','vimeo.com','player.','embed.','onetrust','cookiebot','usercentrics','didomi','trustarc','truste','optimizely','vwo','abtasty','hubspot','marketo','salesforce','chilipiper','segment.','amplitude'];

const EXTRACT_FN = ([classFamilySrc, missable]) => {
  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    const path = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && path.length < 6) {
      let selector = node.nodeName.toLowerCase();
      if (node.id) { selector += '#' + CSS.escape(node.id); path.unshift(selector); break; }
      let sib = node, nth = 1;
      while ((sib = sib.previousElementSibling)) { if (sib.nodeName === node.nodeName) nth++; }
      selector += `:nth-of-type(${nth})`;
      path.unshift(selector);
      node = node.parentElement;
    }
    return path.join(' > ');
  }
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x*100)/100, y: Math.round((r.y + window.scrollY)*100)/100, width: Math.round(r.width*100)/100, height: Math.round(r.height*100)/100 };
  }
  function textSig(el) {
    return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  }
  const classFamily = new RegExp(classFamilySrc, 'i');
  const all = Array.from(document.querySelectorAll('body *'));
  const candidates = [];
  const seen = new Set();
  function addCandidate(el, signal) {
    if (!el || seen.has(el)) {
      if (seen.has(el)) {
        const existing = candidates.find(c => c._el === el);
        if (existing && !existing.signals.includes(signal)) existing.signals.push(signal);
      }
      return;
    }
    const rect = rectOf(el);
    const style = window.getComputedStyle(el);
    const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    if (!visible) return;
    seen.add(el);
    candidates.push({
      _el: el,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: el.className && typeof el.className === 'string' ? el.className : null,
      role: el.getAttribute('role'),
      selector: cssPath(el),
      rect,
      text: textSig(el),
      signals: [signal],
      position: style.position,
      zIndex: style.zIndex,
    });
  }
  // Signal 1: landmarks/ARIA
  ['header','footer','main','nav','aside','article','section','form','figure','dialog','details'].forEach(tag => {
    document.querySelectorAll(tag).forEach(el => addCandidate(el, 'landmark:' + tag));
  });
  document.querySelectorAll('[role]').forEach(el => {
    const r = el.getAttribute('role');
    if (['region','list','status','dialog'].includes(r)) addCandidate(el, 'aria-role:' + r);
  });
  // Signal 2: headings
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => addCandidate(el, 'heading:' + el.tagName.toLowerCase()));
  // Signal 3: class-family, size filtered
  all.forEach(el => {
    const cls = (el.className && typeof el.className === 'string') ? el.className : '';
    if (classFamily.test(cls)) {
      const r = el.getBoundingClientRect();
      if (r.width > 200 && r.height > 8) addCandidate(el, 'class-family');
    }
  });
  // Signal 5: interaction/media
  document.querySelectorAll('video,audio,canvas,iframe,embed,object').forEach(el => addCandidate(el, 'media:' + el.tagName.toLowerCase()));
  all.forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.animationName && style.animationName !== 'none') addCandidate(el, 'animation');
  });
  // Signal 6: floating/overlay
  all.forEach(el => {
    const style = window.getComputedStyle(el);
    if ((style.position === 'fixed' || style.position === 'sticky')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) addCandidate(el, 'floating:' + style.position);
    }
  });
  // Signal 7: repetition - parents with 2+ visually equivalent direct children
  const repetitionParents = [];
  all.forEach(el => {
    const kids = Array.from(el.children);
    if (kids.length >= 2) {
      const tagGroups = {};
      kids.forEach(k => {
        const key = k.tagName + '|' + (typeof k.className === 'string' ? k.className : '');
        tagGroups[key] = (tagGroups[key] || 0) + 1;
      });
      const maxGroup = Math.max(...Object.values(tagGroups));
      if (maxGroup >= 2) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          addCandidate(el, 'repetition-parent');
          repetitionParents.push(cssPath(el));
        }
      }
    }
  });
  // Signal 8: missable pattern catalog
  missable.forEach(pattern => {
    all.forEach(el => {
      const cls = (el.className && typeof el.className === 'string') ? el.className : '';
      const idAttr = el.id || '';
      const dataAttrs = Array.from(el.attributes || []).map(a => a.name + '=' + a.value).join(' ');
      const hay = (cls + ' ' + idAttr + ' ' + dataAttrs).toLowerCase();
      if (hay.includes(pattern)) addCandidate(el, 'missable:' + pattern);
    });
  });

  // media manifest detail
  const media = Array.from(document.querySelectorAll('video,audio,iframe,embed,object,canvas')).map(el => {
    const rect = rectOf(el);
    const style = window.getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      src: el.currentSrc || el.src || el.getAttribute('src') || null,
      rect,
      autoplay: el.autoplay || null,
      loop: el.loop || null,
      muted: el.muted || null,
      controls: el.controls || null,
      poster: el.poster || null,
      objectFit: style.objectFit,
    };
  });
  const thirdPartyHosts = new Set();
  document.querySelectorAll('iframe[src]').forEach(f => {
    try { thirdPartyHosts.add(new URL(f.src, location.href).host); } catch (e) {}
  });

  const inventoryHay = document.body.innerHTML.toLowerCase();

  const result = {
    url: location.href,
    title: document.title,
    metadata: {
      description: document.querySelector('meta[name="description"]')?.content || null,
      canonical: document.querySelector('link[rel="canonical"]')?.href || null,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || null,
      ogDescription: document.querySelector('meta[property="og:description"]')?.content || null,
      ogImage: document.querySelector('meta[property="og:image"]')?.content || null,
    },
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth,
    },
    candidates: candidates.map(({ _el, ...c }) => c),
    repetitionParents,
    media,
    thirdPartyHosts: Array.from(thirdPartyHosts),
    inventoryHayLength: inventoryHay.length,
  };
  return result;
};

async function run() {
  const browser = await chromium.launch();
  for (const bp of BREAKPOINTS) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: bp, height: 900 });
    await page.goto(SITE_URL, { waitUntil: 'load', timeout: 60000 });
    const innerWidthCheck1 = await page.evaluate(() => window.innerWidth);
    await page.evaluate(() => document.fonts.ready);
    // scroll cycle top -> bottom -> top (signal 9)
    await page.evaluate(async () => {
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y <= h; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
      window.scrollTo(0, 0);
    });
    // wait for dynamic injection (signal 10) then rescan via re-scroll
    await page.waitForTimeout(3000);
    await page.evaluate(async () => {
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y <= h; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 20)); }
      window.scrollTo(0, 0);
    });
    const innerWidthCheck2 = await page.evaluate(() => window.innerWidth);

    // geometry stability sampling x3 (documentElement/body/main)
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const s = await page.evaluate(() => {
        const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        return { html: pick('html'), body: pick('body'), main: pick('main') };
      });
      samples.push(s);
      if (i < 2) await page.waitForTimeout(500);
    }

    const manifest = await page.evaluate(EXTRACT_FN, [CLASS_FAMILY_SRC, MISSABLE]);
    // disable animations for static full-page screenshot
    await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; scroll-behavior: auto !important; }' });
    const shotPath = path.join(OUT_DIR, `screenshot-${bp}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });

    const readiness = {
      breakpoint: bp,
      requestedWidth: bp,
      innerWidthCheck1,
      innerWidthCheck2,
      readinessOk: innerWidthCheck1 === bp && innerWidthCheck2 === bp,
      geometrySamples: samples,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(OUT_DIR, `manifest-${bp}.json`), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, `readiness-${bp}.json`), JSON.stringify(readiness, null, 2));
    console.log(`BP ${bp}: candidates=${manifest.candidates.length} scrollHeight=${manifest.viewport.scrollHeight} readinessOk=${readiness.readinessOk}`);
    await page.close();
  }
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
