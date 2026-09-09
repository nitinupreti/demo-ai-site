// Stage 1 v2 — 11-signal discovery + No-Omission Inventory + cross-bp visibility.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://www.notion.com/customers/cursor';
const BPS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '375', width: 375, height: 812 }
];
const OUT = path.resolve('discovery-v2');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const FREEZE = `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }`;

const INVENTORY_CATALOG = [
  { group: 'Global chrome', members: ['skip-link', 'announcement-bar', 'ticker', 'sticky-top-nav', 'mega-menu-overlay', 'utility-bar', 'breadcrumb', 'search-overlay', 'region-language-selector'] },
  { group: 'Hero and marquee', members: ['primary-hero', 'secondary-hero', 'headless-media-band', 'background-video-strip', 'animated-canvas-bg'] },
  { group: 'Content bands', members: ['intro-lead', 'two-column-text', 'feature-grid', 'stat-strip', 'pull-quote', 'media-with-caption', 'carousel', 'tabs', 'accordion', 'comparison-table', 'pricing-grid', 'faq', 'timeline', 'roadmap'] },
  { group: 'Social proof', members: ['logo-strip', 'customer-story-teaser', 'testimonial-marquee', 'review-stars', 'awards-badges'] },
  { group: 'Conversion', members: ['inline-cta-strip', 'cta-band', 'newsletter-signup', 'contact-demo-form', 'download-panel', 'meeting-scheduler'] },
  { group: 'Related / cross-sell', members: ['related-articles', 'related-case-studies', 'product-carousel', 'also-on-site-grid'] },
  { group: 'Footer chrome', members: ['pre-footer-cta', 'footer-tagline', 'footer-nav-grid', 'secondary-links', 'copyright-bar', 'social-icons', 'legal-strip'] },
  { group: 'Floating / overlays', members: ['cookie-consent', 'gdpr-banner', 'chat-widget', 'back-to-top', 'floating-cta', 'notification-toast', 'video-lightbox-trigger', 'gated-modal', 'geo-redirect-prompt'] },
  { group: 'Responsive-only variants', members: ['mobile-bottom-nav', 'mobile-sticky-cta', 'mobile-mega-menu-drawer', 'tablet-only-sidebar'] }
];

// Selector heuristics per catalog member: array of selector strings; hit means at least one matches with visible rect.
const SELECTORS = {
  'skip-link': ['a[href^="#"][class*="skip" i]', 'a.skip-link', 'a[aria-label*="skip" i]'],
  'announcement-bar': ['[class*="announce" i]:not(button)', '[class*="promo" i][class*="bar" i]', '[data-announce]', '[class*="topbanner" i]'],
  'ticker': ['[class*="ticker" i]', '[class*="marquee" i]'],
  'sticky-top-nav': ['nav[class*="global" i]', 'header nav', 'nav[class*="navigation" i]'],
  'mega-menu-overlay': ['[class*="megamenu" i]', '[class*="dropdown" i][class*="panel" i]', '[class*="dropdown" i][role="menu"]', '[class*="dropdown" i][class*="grid" i]'],
  'utility-bar': ['[class*="utility" i][class*="bar" i]', '[class*="topbar" i]'],
  'breadcrumb': ['nav[aria-label*="breadcrumb" i]', '[class*="breadcrumb" i]'],
  'search-overlay': ['[class*="search" i][class*="overlay" i]', 'dialog[class*="search" i]'],
  'region-language-selector': ['[class*="language" i][class*="select" i]', '[class*="region" i][class*="select" i]', '[aria-label*="language" i]'],
  'primary-hero': ['section[class*="hero" i]', 'section[class*="HeroStories" i]', '[class*="hero" i][class*="section" i]'],
  'secondary-hero': [],
  'headless-media-band': ['section:has(> video)', 'section:has(> figure video)'],
  'background-video-strip': ['section [class*="background" i] video', 'div[class*="bg" i] video'],
  'animated-canvas-bg': ['canvas'],
  'intro-lead': ['section[class*="intro" i]', 'section[class*="lead" i]'],
  'two-column-text': ['[class*="twoColumn" i]', '[class*="two-column" i]', '[class*="sectionContent" i]'],
  'feature-grid': ['[class*="feature" i][class*="grid" i]', '[class*="featureGrid" i]'],
  'stat-strip': ['[class*="stats" i]', '[class*="statStrip" i]'],
  'pull-quote': ['blockquote', 'figure[class*="quote" i]', '[class*="pullQuote" i]'],
  'media-with-caption': ['figure[class*="mediaWithCaption" i]', 'figure > figcaption', '[class*="mediaWithCaption" i]'],
  'carousel': ['[class*="carousel" i]', '[class*="slider" i]', '[role="listbox"][aria-label*="carousel" i]'],
  'tabs': ['[role="tablist"]'],
  'accordion': ['[class*="accordion" i]', '[data-accordion]'],
  'comparison-table': ['table[class*="compare" i]'],
  'pricing-grid': ['[class*="pricing" i][class*="grid" i]', '[class*="priceCard" i]'],
  'faq': ['[class*="faq" i]', 'section[aria-label*="faq" i]'],
  'timeline': ['[class*="timeline" i]'],
  'roadmap': ['[class*="roadmap" i]'],
  'logo-strip': ['[class*="logoStrip" i]', '[class*="logoBar" i]', '[class*="logoWall" i]'],
  'customer-story-teaser': ['[class*="customerStory" i]', '[class*="caseStudy" i][class*="teaser" i]'],
  'testimonial-marquee': ['[class*="testimonial" i][class*="marquee" i]'],
  'review-stars': ['[class*="rating" i][class*="star" i]', '[aria-label*="rating" i]'],
  'awards-badges': ['[class*="awards" i]', '[class*="badge" i][class*="row" i]'],
  'inline-cta-strip': ['[class*="ctaStrip" i]', '[class*="cta" i][class*="row" i]'],
  'cta-band': ['section[class*="cta" i]', '[class*="ctaBand" i]', '[class*="ctaSection" i]'],
  'newsletter-signup': ['form[class*="newsletter" i]', '[class*="subscribe" i] form'],
  'contact-demo-form': ['form[class*="contact" i]', 'form[class*="demo" i]', 'form[class*="requestDemo" i]'],
  'download-panel': ['[class*="download" i][class*="panel" i]'],
  'meeting-scheduler': ['iframe[src*="chilipiper" i]', 'iframe[src*="calendly" i]', '[class*="chilipiper" i]'],
  'related-articles': ['[class*="relatedArticles" i]', '[class*="related" i][class*="post" i]'],
  'related-case-studies': ['[class*="relatedCaseStudies" i]', '[class*="related" i][class*="caseStud" i]'],
  'product-carousel': ['[class*="productCarousel" i]'],
  'also-on-site-grid': ['[class*="alsoOn" i]', '[class*="youMayLike" i]'],
  'pre-footer-cta': ['[class*="preFooter" i]', '[class*="footerCta" i]'],
  'footer-tagline': ['footer blockquote', 'footer [class*="tagline" i]', 'footer [class*="quote" i]'],
  'footer-nav-grid': ['footer nav', 'footer [class*="nav" i][class*="grid" i]'],
  'secondary-links': ['footer [class*="secondary" i]', 'footer [class*="sublinks" i]'],
  'copyright-bar': ['footer [class*="copyright" i]', 'footer [class*="legal" i][class*="bar" i]'],
  'social-icons': ['footer [class*="social" i]', 'footer ul[class*="social" i]'],
  'legal-strip': ['footer [class*="legal" i]'],
  'cookie-consent': ['[id*="cookie" i][class*="consent" i]', '[class*="cookieBanner" i]', '[class*="cookieConsent" i]', '#onetrust-banner-sdk', '[data-cookiebanner]', '#usercentrics-root'],
  'gdpr-banner': ['#didomi-host', '#truste-consent-track', '[class*="gdpr" i]'],
  'chat-widget': ['[id*="intercom" i]', '[class*="intercom" i]', '[id*="drift" i]', 'iframe[title*="chat" i]', '[class*="chatWidget" i]'],
  'back-to-top': ['[aria-label*="back to top" i]', 'a[href="#top"]', '[class*="backToTop" i]'],
  'floating-cta': ['[class*="floatingCta" i]', '[class*="stickyCta" i]'],
  'notification-toast': ['[role="status"][class*="toast" i]', '[class*="snackbar" i]'],
  'video-lightbox-trigger': ['button[class*="videoButton" i]', 'button[aria-label*="play video" i]'],
  'gated-modal': ['dialog[open]', '[role="dialog"][class*="gated" i]'],
  'geo-redirect-prompt': ['[class*="geoPrompt" i]', '[class*="regionPrompt" i]'],
  'mobile-bottom-nav': ['nav[class*="bottomNav" i]', 'nav[class*="mobile" i][class*="fixed" i]'],
  'mobile-sticky-cta': ['[class*="stickyMobileCta" i]', '[class*="mobileCta" i][class*="fixed" i]'],
  'mobile-mega-menu-drawer': ['[class*="drawer" i]', '[class*="mobileMenu" i]', 'dialog[class*="menu" i]'],
  'tablet-only-sidebar': ['aside[class*="tablet" i]']
};

async function auditOne(bp) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: bp.width, height: bp.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const embedResponses = [];
  page.on('response', r => {
    const u = r.url();
    if (/onetrust|cookiebot|usercentrics|didomi|truste|intercom|drift|zendesk|zdassets|amplitude|segment|optimizely|hotjar|clearbit|marketo|hubspot|chilipiper|calendly|youtube|vimeo/i.test(u)) {
      embedResponses.push({ url: u, status: r.status(), ct: r.headers()['content-type'] || '' });
    }
  });

  console.log(`[${bp.name}] navigating`);
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
  // scroll for lazy loading + scroll-triggered signals
  await page.evaluate(async () => {
    const H = document.documentElement.scrollHeight;
    for (let y = 0; y < H; y += 300) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 500));
  });
  // dynamic-injection wait (signal 10)
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(css => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }, FREEZE);
  await page.waitForTimeout(400);

  const viewport = await page.evaluate(() => ({ innerWidth: window.innerWidth, dpr: window.devicePixelRatio, height: document.documentElement.scrollHeight, ua: navigator.userAgent.slice(0, 80) }));

  // Vertical-band scan (signal 4) — collect bands
  const bands = await page.evaluate(() => {
    const step = 20;
    const H = document.documentElement.scrollHeight;
    const midX = Math.floor(window.innerWidth / 2);
    const bands = [];
    let last = null;
    for (let y = 0; y < H; y += step) {
      window.scrollTo(0, Math.max(0, y - 200));
      const yViewport = 200;
      const el = document.elementFromPoint(midX, yViewport);
      if (!el) continue;
      const owner = (function findBigOwner(node) {
        while (node && node !== document.body) {
          const r = node.getBoundingClientRect();
          if (r.width > window.innerWidth * 0.6 && r.height > 40) return node;
          node = node.parentElement;
        }
        return document.body;
      })(el);
      const key = owner.tagName + '|' + (owner.className || '').toString().slice(0, 40);
      if (key !== last) { bands.push({ y, tag: owner.tagName.toLowerCase(), cls: (owner.className || '').toString().slice(0, 80) }); last = key; }
    }
    window.scrollTo(0, 0);
    return { count: bands.length, sample: bands.slice(0, 30) };
  });

  // No-Omission Inventory audit — for each catalog member, run its selectors
  const inventory = await page.evaluate(SELECTORS_MAP => {
    const result = {};
    for (const [member, sels] of Object.entries(SELECTORS_MAP)) {
      let hit = null;
      let selUsed = null;
      for (const sel of sels) {
        let el;
        try { el = document.querySelector(sel); } catch (e) { continue; }
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        hit = { tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 80), rect: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) } };
        selUsed = sel;
        break;
      }
      result[member] = hit ? { present: true, selector: selUsed, evidence: hit } : { present: false, selectors_tried: sels };
    }
    return result;
  }, SELECTORS);

  // Full-page screenshot
  const bpDir = path.join(OUT, bp.name);
  if (!fs.existsSync(bpDir)) fs.mkdirSync(bpDir, { recursive: true });
  await page.screenshot({ path: path.join(bpDir, 'full.png'), fullPage: true });

  fs.writeFileSync(path.join(bpDir, 'inventory.json'), JSON.stringify({ viewport, inventory, bands, embedResponses }, null, 2));

  await browser.close();
  return { bp: bp.name, viewport, present: Object.values(inventory).filter(v => v.present).length, absent: Object.values(inventory).filter(v => !v.present).length, embedHits: embedResponses.length };
}

(async () => {
  const summary = {};
  for (const bp of BPS) summary[bp.name] = await auditOne(bp);

  // Cross-BP union
  const union = {};
  for (const bp of BPS) {
    const inv = JSON.parse(fs.readFileSync(path.join(OUT, bp.name, 'inventory.json'), 'utf-8')).inventory;
    for (const [member, v] of Object.entries(inv)) {
      if (!union[member]) union[member] = { visibility_by_bp: {}, evidence: {} };
      union[member].visibility_by_bp[bp.name] = v.present;
      if (v.present) union[member].evidence[bp.name] = { selector: v.selector, ...v.evidence };
    }
  }
  fs.writeFileSync(path.join(OUT, 'union.json'), JSON.stringify(union, null, 2));

  // Emit inventory audit markdown
  const rows = [];
  rows.push('| Group | Member | 1440 | 768 | 375 | Selector used or negative citation |');
  rows.push('|---|---|:-:|:-:|:-:|---|');
  for (const group of INVENTORY_CATALOG) {
    for (const m of group.members) {
      const u = union[m];
      const at = bp => u.visibility_by_bp[bp] ? 'yes' : 'no';
      const anyYes = Object.values(u.visibility_by_bp).some(Boolean);
      const cite = anyYes
        ? Object.entries(u.evidence).map(([bp, ev]) => `${bp}: \`${ev.selector}\` ${ev.rect ? `[${ev.rect.w}×${ev.rect.h} @ y${ev.rect.y}]` : ''}`).join('<br/>')
        : `zero matches for: \`${(SELECTORS[m] || []).join('`, `')}\``;
      rows.push(`| ${group.group} | ${m} | ${at('1440')} | ${at('768')} | ${at('375')} | ${cite} |`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'inventory-audit.md'), rows.join('\n'));

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('DONE', summary);
})();
