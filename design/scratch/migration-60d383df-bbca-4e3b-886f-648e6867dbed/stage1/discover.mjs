#!/usr/bin/env node
// Stage 1 exhaustive discovery script (run 60d383df) — signals 1-11 at each required breakpoint.
// Writes per-breakpoint JSON evidence + a merged coverage/selector-map summary to stage1/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_URL = 'https://www.notion.com/customers/cursor';
const BREAKPOINTS = [375, 768, 1440];

const MISSABLE = '(promo|marquee|ticker|announcement|cookie|consent|back-to-top|breadcrumb|logo-strip|stats|quote|divider|pinned|newsletter|region-selector|search-overlay|mega-menu|skip-link|preloader|progress|chat)';
const CLASSFAM = '(section|wrapper|container|block|panel|band|strip|bar|marquee|ticker|scroller|carousel|slider|announce|promo|cta|hero|footer|header|feature|nav|banner|consent|cookie|toast|snackbar|modal|drawer|sticky|float)';
const THIRDPARTY = '(youtube\\.com|youtube-nocookie\\.com|vimeo\\.com|player\\.|embed\\.|onetrust|cookiebot|usercentrics|didomi|trustarc|truste|optimizely|vwo|abtasty|hubspot|marketo|salesforce|chilipiper|segment\\.com|amplitude)';

async function discoverAtBreakpoint(page, width) {
  const height = Math.max(900, Math.round(width * 1.3));
  await page.setViewportSize({ width, height });
  await page.goto(SITE_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  const beforeCount = await page.evaluate(() => document.querySelectorAll('*').length);
  // signal 9: scroll-triggered reveal — walk top -> bottom -> top
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight / 2));
    const max = document.documentElement.scrollHeight;
    for (let y = 0; y < max; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, max);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
  // signal 10: dynamic injection settle window (>= 3000ms after load)
  await page.waitForTimeout(3000);
  const afterCount = await page.evaluate(() => document.querySelectorAll('*').length);

  const data = await page.evaluate(({ missableSrc, classfamSrc, thirdpartySrc }) => {
    const MISSABLE_RE = new RegExp(missableSrc, 'i');
    const CLASSFAM_RE = new RegExp(classfamSrc, 'i');
    const THIRDPARTY_RE = new RegExp(thirdpartySrc, 'i');

    function absRect(el) {
      const r = el.getBoundingClientRect();
      return { x: round(r.x + window.scrollX), y: round(r.y + window.scrollY), width: round(r.width), height: round(r.height) };
    }
    function round(n) { return Math.round(n * 100) / 100; }
    function isVisible(el) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    }
    function classOf(el) { return (el.className && typeof el.className === 'string') ? el.className : ''; }

    // ---- Known reading-order instance map (verified via manual structural probe) ----
    const nav = document.querySelector('nav') || document.querySelector('header nav') || document.querySelector('[role=navigation]');
    const main = document.querySelector('main');
    const root = main ? main.querySelector(':scope > div') : null;
    const topSections = root ? Array.from(root.children) : [];
    const footer = document.querySelector('footer');

    const instanceDefs = [
      { id: 'nav-sticky', el: nav },
      { id: 'hero', el: topSections[0] },
      { id: 'section1-simplicity', el: topSections[1] },
      { id: 'section2-why-build', el: topSections[2] },
      { id: 'quote-1-ryo', el: topSections[3] },
      { id: 'section3-ai-strongest-video', el: topSections[4] },
      { id: 'quote-2-michael-a', el: topSections[5] },
      { id: 'section4-modern-stack', el: topSections[6] },
      { id: 'quote-3-michael-b', el: topSections[7] },
      { id: 'cta-band', el: topSections[8] },
      { id: 'related-stories-grid', el: topSections[9] },
      { id: 'video-fallback-dialog', el: topSections[10] },
      { id: 'footer', el: footer },
    ].filter((d) => d.el);

    const source_selector_map = instanceDefs.map((d) => {
      const rect = absRect(d.el);
      const cls = classOf(d.el).trim().split(/\s+/).filter(Boolean).slice(0, 1)[0] || '';
      const tag = d.el.tagName.toLowerCase();
      return {
        instance_id: d.id,
        selector: cls ? `${tag}.${CSS.escape(cls)}` : tag,
        match_index: 1,
        expected_matches: document.querySelectorAll(cls ? `${tag}.${CSS.escape(cls)}` : tag).length,
        text_signature: (d.el.innerText || '').trim().slice(0, 60).replace(/\s+/g, ' '),
        rect,
        visible: isVisible(d.el),
      };
    });

    // ---- Signal 7: repetition groups (>=2 visually-equivalent siblings) ----
    const repetitionGroups = [];
    document.querySelectorAll('body *').forEach((parent) => {
      if (parent.children.length < 2) return;
      const groups = {};
      Array.from(parent.children).forEach((child) => {
        const key = child.tagName + '|' + classOf(child).replace(/\d/g, '#');
        (groups[key] = groups[key] || []).push(child);
      });
      Object.entries(groups).forEach(([key, els]) => {
        if (els.length >= 2 && els.every((e) => isVisible(e)) && els[0].getBoundingClientRect().width > 40) {
          repetitionGroups.push({ parentTag: parent.tagName, parentClass: classOf(parent).slice(0, 40), key, count: els.length });
        }
      });
    });
    // dedupe repetition groups by key+count
    const seenRep = new Set();
    const repetitionGroupsUnique = repetitionGroups.filter((g) => {
      const k = g.key + '|' + g.count;
      if (seenRep.has(k)) return false;
      seenRep.add(k);
      return true;
    });

    // ---- Signal 8: missable-pattern catalog scan ----
    const missableHits = [];
    document.querySelectorAll('body *').forEach((el) => {
      const cls = classOf(el);
      const id = el.id || '';
      if ((cls && MISSABLE_RE.test(cls)) || (id && MISSABLE_RE.test(id))) {
        const m = (cls + ' ' + id).match(MISSABLE_RE);
        missableHits.push({ tag: el.tagName.toLowerCase(), match: m ? m[0] : '', cls: cls.slice(0, 60), id });
      }
    });

    // ---- Signal 3: class-family candidates (visible, w>200 h>8) ----
    let classFamilyCount = 0;
    document.querySelectorAll('body *').forEach((el) => {
      const cls = classOf(el);
      if (cls && CLASSFAM_RE.test(cls)) {
        const r = el.getBoundingClientRect();
        if (r.width > 200 && r.height > 8 && isVisible(el)) classFamilyCount++;
      }
    });

    // ---- Signal 11: third-party embed hosts ----
    const thirdPartyHits = [];
    document.querySelectorAll('iframe[src], script[src]').forEach((el) => {
      const src = el.getAttribute('src') || '';
      if (THIRDPARTY_RE.test(src)) thirdPartyHits.push({ tag: el.tagName.toLowerCase(), src });
    });

    // ---- Signal 6: fixed/sticky + positive z-index overlays ----
    const floatingEls = [];
    document.querySelectorAll('body *').forEach((el) => {
      const cs = getComputedStyle(el);
      const z = parseInt(cs.zIndex, 10);
      if ((cs.position === 'fixed' || cs.position === 'sticky') && isVisible(el)) {
        floatingEls.push({ tag: el.tagName.toLowerCase(), cls: classOf(el).slice(0, 50), position: cs.position, z: isNaN(z) ? null : z });
      }
    });

    // ---- Signal 1/2: landmarks + headings ----
    const landmarks = Array.from(document.querySelectorAll('header,footer,main,nav,aside,article,section,form,figure,dialog,details,[role]'))
      .filter(isVisible).length;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => h.tagName);

    // ---- Signal 4 (proxy): 20px band ownership + coverage using known instance rects ----
    const scrollHeight = document.documentElement.scrollHeight;
    const bandOwners = [];
    const instanceRects = source_selector_map
      .filter((s) => s.instance_id !== 'nav-sticky' && s.rect.height > 0)
      .map((s) => ({ id: s.instance_id, top: s.rect.y, bottom: s.rect.y + s.rect.height, width: s.rect.width }));
    for (let y = 0; y < scrollHeight; y += 20) {
      const owners = instanceRects.filter((r) => y >= r.top && y < r.bottom && r.width >= window.innerWidth * 0.6);
      let owner = 'UNCLAIMED';
      if (owners.length) owner = owners.sort((a, b) => (a.bottom - a.top) - (b.bottom - b.top))[0].id;
      bandOwners.push({ y, owner });
    }
    // merge contiguous bands into ranges
    const coverage_report = [];
    let cur = null;
    for (const b of bandOwners) {
      if (!cur || cur.owner !== b.owner) {
        if (cur) coverage_report.push(cur);
        cur = { from_y: b.y, to_y: b.y + 20, owner: b.owner };
      } else {
        cur.to_y = b.y + 20;
      }
    }
    if (cur) coverage_report.push(cur);
    const gaps20px = coverage_report.filter((r) => r.owner === 'UNCLAIMED' && (r.to_y - r.from_y) >= 20);

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollHeight,
      source_selector_map,
      repetitionGroups: repetitionGroupsUnique,
      missableHits,
      classFamilyCount,
      thirdPartyHits,
      floatingEls,
      landmarksCount: landmarks,
      headingsSeq: headings,
      coverage_report,
      gaps20px,
    };
  }, { missableSrc: MISSABLE, classfamSrc: CLASSFAM, thirdpartySrc: THIRDPARTY });

  return { ...data, dynamicInjectionDelta: afterCount - beforeCount, nodeCountBefore: beforeCount, nodeCountAfter: afterCount };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = {};
  for (const bp of BREAKPOINTS) {
    // eslint-disable-next-line no-await-in-loop
    results[bp] = await discoverAtBreakpoint(page, bp);
    fs.writeFileSync(path.join(HERE, `discovery-${bp}-full.json`), JSON.stringify(results[bp], null, 2));
    console.log(`[bp ${bp}] scrollHeight=${results[bp].scrollHeight} gaps=${results[bp].gaps20px.length} dynDelta=${results[bp].dynamicInjectionDelta} repGroups=${results[bp].repetitionGroups.length} thirdParty=${results[bp].thirdPartyHits.length}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(HERE, 'discovery-all-breakpoints.json'), JSON.stringify(results, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
