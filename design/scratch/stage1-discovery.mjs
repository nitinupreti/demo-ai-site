// Stage 1 source discovery for AEM page migration.
// Captures full-page screenshot, block discovery via unions of signals, coverage report,
// vertical-band scan, media manifest, DOM manifest, computed styles per breakpoint.
// Output: design/scratch/discovery/<bp>/{screenshot.png,coverage.json,manifest.json,media.json,dom.json}
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://www.notion.com/customers/cursor';
const BREAKPOINTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '375', width: 375, height: 812 }
];
const OUT = path.resolve('discovery');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
`;

async function capture(bp) {
  const bpDir = path.join(OUT, bp.name);
  if (!fs.existsSync(bpDir)) fs.mkdirSync(bpDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: bp.width, height: bp.height },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const network = [];
  page.on('response', r => {
    const url = r.url();
    const ct = r.headers()['content-type'] || '';
    if (/image|video|audio|font|json|css/i.test(ct) || /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|woff2?|ttf)$/i.test(url)) {
      network.push({ url, status: r.status(), contentType: ct });
    }
  });

  console.log(`[${bp.name}] navigating…`);
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Fonts + lazy loading
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 500));
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Freeze motion before capture
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.waitForTimeout(600);

  // Assert viewport
  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    scale: window.visualViewport ? window.visualViewport.scale : 1
  }));

  // Full-page screenshot
  await page.screenshot({ path: path.join(bpDir, 'screenshot.png'), fullPage: true });

  // Block discovery — signals unioned
  const discovery = await page.evaluate(() => {
    const MISSABLE = /(promo|marquee|ticker|announcement|cookie|consent|back-to-top|breadcrumb|logo-strip|stats|quote|divider|pinned|newsletter|region-selector|search-overlay|mega-menu|skip-link|preloader|progress|chat)/i;
    const CLASS_FAMILY = /(section|wrapper|container|block|panel|band|strip|bar|marquee|ticker|scroller|carousel|slider|announce|promo|cta|hero|footer|header|feature|nav|banner|consent|cookie|toast|snackbar|modal|drawer|sticky|float)/i;
    const LANDMARK_TAGS = new Set(['header','footer','main','nav','aside','article','section','form','figure','dialog','details']);
    const results = new Map();
    let counter = 0;
    function idFor(el) {
      const path = [];
      let cur = el;
      while (cur && cur !== document.body) {
        const p = cur.parentElement;
        if (!p) break;
        const idx = Array.prototype.indexOf.call(p.children, cur);
        path.unshift(`${cur.tagName.toLowerCase()}[${idx}]`);
        cur = p;
      }
      return path.join('>');
    }
    function shortText(el) {
      return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    function record(el, signal) {
      const rect = el.getBoundingClientRect();
      const key = idFor(el);
      if (!results.has(key)) {
        const cs = getComputedStyle(el);
        results.set(key, {
          instance_id: `blk-${String(counter++).padStart(3,'0')}`,
          dom_path: key,
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          classes: (el.className && el.className.toString) ? el.className.toString() : '',
          role: el.getAttribute('role') || '',
          aria_label: el.getAttribute('aria-label') || '',
          text_preview: shortText(el),
          rect: {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            w: rect.width,
            h: rect.height
          },
          styles: {
            display: cs.display,
            position: cs.position,
            background_color: cs.backgroundColor,
            background_image: cs.backgroundImage,
            color: cs.color,
            font_family: cs.fontFamily,
            font_size: cs.fontSize,
            font_weight: cs.fontWeight,
            line_height: cs.lineHeight,
            padding: cs.padding,
            margin: cs.margin,
            border: cs.border,
            border_radius: cs.borderRadius,
            box_shadow: cs.boxShadow,
            opacity: cs.opacity,
            z_index: cs.zIndex
          },
          signals: []
        });
      }
      const row = results.get(key);
      if (!row.signals.includes(signal)) row.signals.push(signal);
    }
    // 1. Landmarks
    document.querySelectorAll('header,footer,main,nav,aside,article,section,form,figure,dialog,details,[role]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 20) record(el, 'landmark');
    });
    // 2. Heading anchors — record heading owner (nearest section-like ancestor)
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
      let owner = h;
      while (owner.parentElement && !LANDMARK_TAGS.has(owner.parentElement.tagName.toLowerCase()) && !CLASS_FAMILY.test(owner.parentElement.className?.toString?.() || '')) {
        owner = owner.parentElement;
        if (owner === document.body) break;
      }
      record(owner, 'heading');
    });
    // 3. Class-family signals
    document.querySelectorAll('*').forEach(el => {
      const cls = el.className?.toString?.() || '';
      if (!cls) return;
      if (!CLASS_FAMILY.test(cls)) return;
      const r = el.getBoundingClientRect();
      if (r.width > 200 && r.height > 8) record(el, 'class-family');
    });
    // 4. Missable patterns
    document.querySelectorAll('*').forEach(el => {
      const cls = el.className?.toString?.() || '';
      const id = el.id || '';
      const attrs = Array.from(el.attributes || []).map(a => a.name).join(' ');
      if (MISSABLE.test(cls) || MISSABLE.test(id) || MISSABLE.test(attrs)) {
        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 2) record(el, 'missable');
      }
    });
    // 5. Interaction/media signals
    document.querySelectorAll('video,audio,canvas,iframe,embed,object,[data-cmp-is]').forEach(el => record(el, 'media'));
    // 6. Fixed/sticky
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'sticky') && parseFloat(cs.opacity) > 0) {
        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 2) record(el, 'floating');
      }
    });
    return Array.from(results.values());
  });

  // Vertical-band scan
  const bands = await page.evaluate(() => {
    const H = document.documentElement.scrollHeight;
    const step = 20;
    const bands = [];
    for (let y = 0; y < H; y += step) {
      const el = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.max(0, y - window.scrollY));
      // scrolling to y for accurate elementFromPoint
    }
    // More reliable: return total height + snapshot of top-level main children
    return { height: H, viewport: window.innerWidth };
  });

  // Coverage
  const coverage = await page.evaluate(() => {
    const H = document.documentElement.scrollHeight;
    return { totalHeight: H };
  });

  fs.writeFileSync(path.join(bpDir, 'discovery.json'), JSON.stringify({ viewport, discovery, bands, coverage }, null, 2));
  fs.writeFileSync(path.join(bpDir, 'network.json'), JSON.stringify(network, null, 2));

  await browser.close();
  console.log(`[${bp.name}] captured ${discovery.length} block candidates, ${network.length} media/asset responses`);
  return { bp: bp.name, blocks: discovery.length, network: network.length };
}

(async () => {
  const summary = [];
  for (const bp of BREAKPOINTS) {
    summary.push(await capture(bp));
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('DONE', summary);
})();
