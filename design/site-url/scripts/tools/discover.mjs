import { chromium } from './browser.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SIGNALS = ['landmarks', 'headings', 'class_family', 'vertical_bands', 'interaction_media',
  'overlays', 'repetition', 'missable', 'scroll_triggered', 'dynamic_injection', 'third_party_embeds'];

export async function withDeadline(operation, milliseconds, label) {
  if (milliseconds === null || milliseconds === 0) return await operation();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function usingBrowser(operation) {
  const browser = await chromium.launch({ headless: true, timeout: 15000 });
  try {
    return await operation(browser);
  } finally {
    await browser.close();
  }
}

export function snapshotDOM(options = {}) {
  const familyPattern = /(section|wrapper|container|block|panel|band|strip|bar|marquee|ticker|scroller|carousel|slider|announce|promo|cta|hero|footer|header|feature|nav|banner|consent|cookie|toast|snackbar|modal|drawer|sticky|float)/i;
  const missablePattern = /(promo|marquee|ticker|announcement|cookie|consent|back-to-top|breadcrumb|logo-strip|stats|quote|divider|pinned|newsletter|region-selector|search-overlay|mega-menu|skip-link|preloader|progress|chat)/i;
  const styleNames = [
    'color', 'backgroundColor', 'backgroundImage', 'fontFamily', 'fontSize', 'fontWeight',
    'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'textDecoration',
    'display', 'position', 'zIndex', 'opacity', 'visibility', 'overflow', 'overflowX', 'overflowY',
    'width', 'height', 'maxWidth', 'minWidth', 'maxHeight', 'minHeight', 'boxSizing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap', 'rowGap', 'columnGap',
    'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderRadius', 'boxShadow',
    'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'gridTemplateColumns',
    'gridTemplateRows', 'aspectRatio', 'objectFit', 'objectPosition', 'transform',
    'animationName', 'animationDuration', 'transitionProperty', 'transitionDuration',
  ];
  const selectors = new Map();
  function selectorFor(element) {
    if (!element) return null;
    if (selectors.has(element)) return selectors.get(element);
    let selector;
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) {
      selector = `#${CSS.escape(element.id)}`;
    } else {
      const tag = element.localName;
      const peers = element.parentElement ? Array.from(element.parentElement.children).filter(child => child.localName === tag) : [element];
      const segment = `${tag}:nth-of-type(${peers.indexOf(element) + 1})`;
      selector = element.parentElement ? `${selectorFor(element.parentElement)} > ${segment}` : segment;
    }
    selectors.set(element, selector);
    return selector;
  }
  function boxFor(element) {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y + scrollY, width: box.width, height: box.height };
  }
  function visible(element, style, box) {
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      && (typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
  }
  const elements = [document.body, ...document.querySelectorAll('body *')].filter(Boolean);
  const records = new Map();
  const tokens = {};
  const fonts = new Map();
  for (const element of elements) {
    const box = boxFor(element);
    const computed = getComputedStyle(element);
    const isVisible = visible(element, computed, box);
    const text = Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ').trim();
    const attributes = Object.fromEntries(Array.from(element.attributes)
      .filter(attribute => /^(id|class|role|aria-|data-|href|target|rel|alt|title|src|srcset|sizes|poster|type|name|placeholder|tabindex|controls|autoplay|loop|muted|playsinline|preload|loading)/i.test(attribute.name))
      .map(attribute => [attribute.name, attribute.value]));
    const styles = isVisible ? Object.fromEntries(styleNames.map(name => [name, computed[name]])) : {};
    const inContent = element.closest('main,[role="main"],article,aside,footer,[role="contentinfo"]');
    const inHeader = Boolean(element.closest('[role="banner"]') || (!inContent && element.closest('header,nav,[role="navigation"]')));
    const record = { selector: selectorFor(element), parent: selectorFor(element.parentElement), tag: element.localName, observation_state: options.state || 'static',
      visible: isVisible, in_header: inHeader, rect: box, text, attributes, styles, signals: [] };
    if (element.matches('a[href]')) record.link_text = element.innerText?.trim() || '';
    records.set(element, record);
    if (!isVisible) continue;
    const classes = typeof element.className === 'string' ? element.className : element.getAttribute('class') || '';
    if (element.matches('header,footer,nav,main,aside,section,[role]')) record.signals.push('landmarks');
    if (element.matches('h1,h2,h3,h4,h5,h6')) {
      record.signals.push('headings');
      record.content_text = element.textContent.trim();
    }
    if (familyPattern.test(classes) && box.width > 200 && box.height > 8) record.signals.push('class_family');
    if (element.matches('video,audio,canvas,iframe,embed,object,[data-component],[data-track],[data-analytics],[data-testid]') || computed.animationName !== 'none' || computed.transform !== 'none') record.signals.push('interaction_media');
    const inViewport = box.y < scrollY + innerHeight && box.y + box.height > scrollY;
    if (['fixed', 'sticky'].includes(computed.position) || (Number(computed.zIndex) > 0 && inViewport)) record.signals.push('overlays');
    if (missablePattern.test([element.id, classes, ...Array.from(element.attributes).filter(attribute => attribute.name.startsWith('data-')).map(attribute => `${attribute.name}=${attribute.value}`)].join(' '))) record.signals.push('missable');
    for (const property of ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'borderRadius', 'boxShadow', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap']) {
      const value = computed[property];
      const key = `${property}:${value}`;
      tokens[key] ||= { property, value, count: 0, selectors: [] };
      tokens[key].count++;
      tokens[key].selectors.push(record.selector);
    }
    if (text) {
      const font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
      fonts.set(font, { font, ready: document.fonts.check(font, text), families: computed.fontFamily });
    }
    record.pseudo = {};
    for (const pseudo of ['::before', '::after']) {
      const pseudoStyle = getComputedStyle(element, pseudo);
      if (!['none', 'normal', '""'].includes(pseudoStyle.content)) {
        record.pseudo[pseudo] = Object.fromEntries(['content', ...styleNames].map(name => [name, pseudoStyle[name]]));
      }
    }
    const tracking = window[Symbol.for('aem.discovery.observer')];
    if (tracking?.added.has(element)) record.signals.push('dynamic_injection');
    if (tracking?.hidden.has(element)) record.signals.push('scroll_triggered');
  }
  for (const [element, record] of records) {
    if (!record.visible) continue;
    const children = Array.from(element.children).map(child => records.get(child)).filter(child => child?.visible);
    const signatures = new Map();
    for (const child of children) {
      const signature = `${child.tag}|${child.attributes.role || ''}|${child.attributes.class || ''}|${child.styles.display}`;
      signatures.set(signature, (signatures.get(signature) || 0) + 1);
    }
    if (Array.from(signatures.values()).some(count => count >= 2)) record.signals.push('repetition');
    if (record.signals.includes('headings')) {
      let owner = element.parentElement;
      while (owner?.parentElement && (records.get(owner)?.rect.width || 0) < innerWidth * .6) owner = owner.parentElement;
      record.owner_selector = selectorFor(owner);
    }
  }
  const media = Array.from(document.querySelectorAll('img,video,audio,iframe,embed,object,canvas,svg')).filter(element => element.localName !== 'svg' || !element.parentElement?.closest('svg')).map(element => {
    const record = records.get(element);
    const result = { selector: selectorFor(element), tag: element.localName, visible: record?.visible || false, rect: boxFor(element),
      source_url: element.currentSrc || element.src || element.data || '', attributes: record?.attributes || {},
      sources: Array.from(element.querySelectorAll('source,track')).map(child => ({ tag: child.localName, src: child.src, type: child.type || '', kind: child.kind || '' })),
      complete: element.complete ?? null, natural_width: element.naturalWidth ?? null, natural_height: element.naturalHeight ?? null,
      ready_state: element.readyState ?? null, video_width: element.videoWidth ?? null, video_height: element.videoHeight ?? null,
      autoplay: element.autoplay ?? null, paused: element.paused ?? null, current_time: element.currentTime ?? null,
      muted: element.muted ?? null, loop: element.loop ?? null, plays_inline: element.playsInline ?? null,
      styles: record?.styles || {},
    };
    if (element.localName === 'svg') {
      result.source_type = 'inline-svg';
      if (options.captureInlineSvg && record?.visible) {
        const clone = element.cloneNode(true);
        const originals = [element, ...element.querySelectorAll('*')];
        const copies = [clone, ...clone.querySelectorAll('*')];
        const presentation = ['color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
          'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
          'opacity', 'clip-rule', 'clip-path', 'mask', 'mask-type', 'stop-color', 'stop-opacity', 'vector-effect',
          'shape-rendering', 'display', 'visibility'];
        const unsupported = [];
        originals.forEach((original, index) => {
          const copy = copies[index];
          const computed = getComputedStyle(original);
          const cssTransform = computed.transform !== 'none' && !original.hasAttribute('transform');
          const transform = cssTransform ? new DOMMatrixReadOnly(computed.transform) : null;
          const rootTranslation = index === 0 && transform?.is2D
            && transform.a === 1 && transform.b === 0 && transform.c === 0 && transform.d === 1;
          if (computed.animationName !== 'none' || computed.filter !== 'none' || computed.mixBlendMode !== 'normal'
              || cssTransform && !rootTranslation) {
            unsupported.push({ node_index: index, animation_name: computed.animationName, filter: computed.filter,
              mix_blend_mode: computed.mixBlendMode, transform: computed.transform, transform_origin: computed.transformOrigin,
              transform_box: computed.transformBox, has_transform_attribute: original.hasAttribute('transform') });
          }
          for (const attribute of Array.from(copy.attributes)) {
            if (/^(class|style|role|tabindex|focusable)$/.test(attribute.name) || /^(aria-|data-)/.test(attribute.name)) copy.removeAttribute(attribute.name);
          }
          for (const property of presentation) {
            let value = computed.getPropertyValue(property).trim();
            if (value.includes('url(')) {
              value = value.replace(/url\(["']?([^"')]+)["']?\)/g, (match, reference) => {
                const resolved = new URL(reference, location.href);
                const pageUrl = new URL(location.href);
                return resolved.origin === pageUrl.origin && resolved.pathname === pageUrl.pathname && resolved.search === pageUrl.search && resolved.hash
                  ? `url(${resolved.hash})` : match;
              });
            }
            if (value && !(value === 'none' && ['clip-path', 'mask'].includes(property))) copy.setAttribute(property, value);
          }
        });
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(record.rect.width));
        clone.setAttribute('height', String(record.rect.height));
        if (unsupported.length) {
          result.inline_svg_error = 'Static SVG export does not support animation, filters, blending or CSS-only transforms.';
          let background = 'rgb(255, 255, 255)';
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const color = getComputedStyle(ancestor).backgroundColor;
            if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
              background = color;
              break;
            }
          }
          result.inline_svg_recovery = { schema_version: 1, selector: result.selector, source_url: location.href,
            original_svg: new XMLSerializer().serializeToString(element), candidate_svg: new XMLSerializer().serializeToString(clone),
            unsupported_styles: unsupported, background, rect: record.rect };
        } else result.inline_svg = new XMLSerializer().serializeToString(clone);
      }
    }
    return result;
  });
  const embeds = Array.from(document.querySelectorAll('iframe,embed,object,script[src]')).map(element => ({
    selector: selectorFor(element), tag: element.localName, src: element.src || element.data || '',
  })).filter(entry => {
    try { return new URL(entry.src, location.href).origin !== location.origin; } catch { return false; }
  });
  const headerLinks = Array.from(records.values()).filter(row => row.in_header && row.visible && row.tag === 'a' && 'href' in row.attributes
    && row.rect.x < innerWidth && row.rect.x + row.rect.width > 0 && row.rect.y < scrollY + innerHeight && row.rect.y + row.rect.height > scrollY)
    .map(row => ({ selector: row.selector, text: row.link_text, href: row.attributes.href, target: row.attributes.target || '', rel: row.attributes.rel || '', rect: row.rect }));
  return { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    scale: visualViewport?.scale ?? 1, client_width: document.documentElement.clientWidth, scroll_width: document.documentElement.scrollWidth,
    scroll_height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), scroll_y: scrollY },
  elements: Array.from(records.values()).filter(record => !options.viewportOnly || (record.visible && record.rect.y < scrollY + innerHeight && record.rect.y + record.rect.height > scrollY)),
  media, fonts: Array.from(fonts.values()), tokens: Object.values(tokens), third_party_embeds: embeds, header_links: headerLinks };
}

function observeChanges() {
  const tracking = { added: new Set(), hidden: new Set(), mutations: 0 };
  for (const element of document.querySelectorAll('body *')) {
    const rect = element.getBoundingClientRect();
    if (!rect.height || !rect.width || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) tracking.hidden.add(element);
  }
  const observer = new MutationObserver(records => {
    tracking.mutations += records.length;
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue;
        tracking.added.add(added);
        for (const element of added.querySelectorAll('*')) tracking.added.add(element);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  window[Symbol.for('aem.discovery.observer')] = tracking;
}

function viewportBands() {
  const step = 20;
  const rows = [];
  function selectorFor(element) {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) return `#${CSS.escape(element.id)}`;
    const peers = element.parentElement ? Array.from(element.parentElement.children).filter(child => child.localName === element.localName) : [element];
    const segment = `${element.localName}:nth-of-type(${peers.indexOf(element) + 1})`;
    return element.parentElement ? `${selectorFor(element.parentElement)} > ${segment}` : segment;
  }
  for (let localY = 0; localY < innerHeight; localY += step) {
    const absoluteY = Math.round(scrollY + localY);
    if (absoluteY >= document.documentElement.scrollHeight) break;
    const owners = [];
    for (const fraction of [.1, .5, .9]) {
      const elements = document.elementsFromPoint(Math.floor(innerWidth * fraction), localY);
      const candidates = elements.map(element => ({ element, rect: element.getBoundingClientRect() }))
        .filter(entry => entry.rect.width >= innerWidth * .6 && entry.rect.height > 0 && !['HTML', 'BODY'].includes(entry.element.tagName));
      candidates.sort((first, second) => first.rect.width * first.rect.height - second.rect.width * second.rect.height);
      if (candidates.length) owners.push(selectorFor(candidates[0].element));
    }
    rows.push({ from_y: absoluteY, to_y: Math.min(absoluteY + step, document.documentElement.scrollHeight), candidates: [...new Set(owners)] });
  }
  return rows;
}

function validateConfig(input) {
  if (input.schema_version !== 1 || typeof input.run_id !== 'string' || !input.run_id) throw new Error('Invalid discovery run identity.');
  const source = new URL(input.site_url);
  if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) throw new Error('Discovery needs an HTTP(S) URL without credentials.');
  if (!Array.isArray(input.breakpoints) || !input.breakpoints.length || input.breakpoints.some(width => !Number.isInteger(width) || width <= 0)
      || new Set(input.breakpoints).size !== input.breakpoints.length) throw new Error('Discovery requires unique positive integer breakpoints.');
  if (!path.isAbsolute(input.output_dir)) throw new Error('Discovery output_dir must be absolute.');
  const config = { max_parallel: 2, page_timeout_ms: null, navigation_timeout_ms: 30000,
    readiness_timeout_ms: 15000, stability_samples: 3, stability_interval_ms: 500, ...input };
  if (config.page_timeout_ms !== null && (!Number.isInteger(config.page_timeout_ms) || config.page_timeout_ms < 0)) throw new Error('Invalid discovery setting: page_timeout_ms');
  for (const key of ['max_parallel', 'navigation_timeout_ms', 'readiness_timeout_ms', 'stability_samples', 'stability_interval_ms']) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) throw new Error(`Invalid discovery setting: ${key}`);
  }
  if (config.max_parallel > 3 || config.stability_samples < 3 || config.stability_interval_ms < 500) throw new Error('Discovery sampling/concurrency settings violate the capture contract.');
  return config;
}

function writeJSON(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx' });
}

const STAGE_LABELS = {
  navigate: 'Load source page',
  dynamic_injection: 'Wait for dynamically loaded content',
  scroll_and_bands: 'Scan page and lazy-loaded content',
  interaction_discovery: 'Check hover and focus states',
  media_and_fonts: 'Check media and fonts',
  static_stability: 'Check layout stability and save evidence',
  COLLECTED: 'Collection complete',
  FAIL: 'Collection failed',
};

function logText(value, limit = 180) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function formatDiscoveryProgress(event) {
  const width = event.breakpoint == null ? 'all viewports' : `${event.breakpoint}px`;
  const status = event.status || (['COLLECTED', 'FAIL'].includes(event.stage) ? event.stage : 'START');
  const elapsed = (Math.max(0, event.elapsed_ms || 0) / 1000).toFixed(1);
  const label = STAGE_LABELS[event.stage] || event.stage;
  const parts = [`[discovery ${width} +${elapsed}s] ${status}: ${label}`];
  if (event.message) parts.push(logText(event.message));
  if (Number.isInteger(event.current) && Number.isInteger(event.total)) {
    parts.push(`${event.current}/${event.total} ${logText(event.unit || 'items')}`);
  }
  if (event.selector) parts.push(`selector=${logText(event.selector)}`);
  if (Number.isFinite(event.stage_elapsed_ms)) parts.push(`stage ${(event.stage_elapsed_ms / 1000).toFixed(1)}s`);
  if (Number.isFinite(event.remaining_ms)) parts.push(`viewport budget ${(Math.max(0, event.remaining_ms) / 1000).toFixed(1)}s remaining`);
  return parts.join(' | ');
}

async function collectBreakpoint(browser, config, width, progress) {
  const started = performance.now();
  const directory = path.join(config.output_dir, String(width));
  mkdirSync(directory);
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const issues = [];
  const artifacts = [];
  const timings = {};
  const save = (name, value) => {
    const relative = `${width}/${name}`;
    writeJSON(path.join(config.output_dir, relative), value);
    artifacts.push(relative);
  };
  async function stage(name, operation) {
    progress(width, name);
    const beginning = performance.now();
    try { return await operation(); } finally { timings[name] = Math.round(performance.now() - beginning); }
  }
  try {
    return await withDeadline(async () => {
      const page = await context.newPage();
      page.setDefaultTimeout(config.readiness_timeout_ms);
      await page.mouse.move(-1, -1);
      const network = [];
      page.on('response', response => {
        if (['image', 'media', 'font', 'stylesheet', 'document'].includes(response.request().resourceType())) {
          network.push({ url: response.url(), status: response.status(), kind: response.request().resourceType(), mime: response.headers()['content-type'] || '' });
        }
      });
      page.on('requestfailed', request => network.push({ url: request.url(), kind: request.resourceType(), error: request.failure()?.errorText }));
      page.on('pageerror', error => issues.push({ gate: 'source_javascript', error: error.message }));
      const navigation = await stage('navigate', () => page.goto(config.site_url, { waitUntil: 'load', timeout: config.navigation_timeout_ms }));
      if (!navigation || !navigation.ok()) throw new Error(`Source navigation failed: HTTP ${navigation?.status()}`);
      await page.evaluate(observeChanges);
      const initial = await page.evaluate(snapshotDOM);
      save('initial.json', initial);
      const observed = new Map(initial.elements.filter(row => row.visible).map(row => [row.selector, row]));
      const embeds = new Map(initial.third_party_embeds.map(row => [row.src, row]));
      const bandRows = new Map();
      const merge = snapshot => {
        for (const embed of snapshot.third_party_embeds) embeds.set(embed.src, embed);
        for (const row of snapshot.elements.filter(element => element.visible)) {
          const previous = observed.get(row.selector);
          row.signals = [...new Set([...(previous?.signals || []), ...row.signals])];
          observed.set(row.selector, row);
        }
      };
      await stage('dynamic_injection', () => page.waitForTimeout(3000));
      const headerSnapshot = await page.evaluate(snapshotDOM);
      save('header-links.json', { scope: 'visible-links-only', breakpoint: width, links: headerSnapshot.header_links });
      await stage('scroll_and_bands', async () => {
        let height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let position = 0; position < height; position += 720) {
          await page.evaluate(offset => window.scrollTo(0, offset), position);
          await page.waitForTimeout(80);
          merge(await page.evaluate(snapshotDOM, { viewportOnly: true }));
          for (const row of await page.evaluate(viewportBands)) bandRows.set(row.from_y, row);
          height = await page.evaluate(() => document.documentElement.scrollHeight);
        }
        for (let position = height; position >= 0; position -= 720) {
          await page.evaluate(offset => window.scrollTo(0, offset), position);
          await page.waitForTimeout(50);
          merge(await page.evaluate(snapshotDOM, { viewportOnly: true }));
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      });
      await stage('interaction_discovery', async () => {
        const interactions = [];
        const controls = new Set();
        progress(width, 'interaction_discovery', { status: 'INFO', message: `Header: ${headerSnapshot.header_links.length} visible links captured; hover and submenu probing disabled.` });
        const isControl = row => ['a', 'button', 'input', 'textarea', 'select', 'summary'].includes(row.tag)
          || row.attributes.role === 'button' || 'tabindex' in row.attributes;
        while (true) {
          const current = await page.evaluate(snapshotDOM);
          merge(current);
          const candidate = current.elements.find(row => row.visible && !row.in_header && isControl(row) && !controls.has(row.selector));
          if (!candidate) break;
          controls.add(candidate.selector);
          const locator = page.locator(candidate.selector);
          try {
            try {
              await locator.hover({ timeout: config.readiness_timeout_ms });
            } catch {
              // Overlay anchors and long scroll animations stall an actionable hover; force dispatches it anyway.
              await locator.hover({ timeout: config.readiness_timeout_ms, force: true });
            }
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const hover = await page.evaluate(snapshotDOM, { viewportOnly: true, state: `hover:${candidate.selector}` });
            merge(hover);
            await locator.focus({ timeout: config.readiness_timeout_ms });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const focus = await page.evaluate(snapshotDOM, { viewportOnly: true, state: `focus:${candidate.selector}` });
            merge(focus);
            interactions.push({ selector: candidate.selector, before: candidate.styles,
              hover: hover.elements.filter(row => row.selector === candidate.selector || !current.elements.some(before => before.visible && before.selector === row.selector)),
              focus: focus.elements.filter(row => row.selector === candidate.selector || !current.elements.some(before => before.visible && before.selector === row.selector)) });
            await locator.evaluate(element => element.blur());
            await page.mouse.move(-1, -1);
          } catch (error) {
            issues.push({ gate: 'interaction_discovery', selector: candidate.selector, error: error.message });
          }
          if (page.url().split('#')[0] !== initial.url.split('#')[0]) throw new Error('Source navigation changed during interaction discovery; linked-page crawling is not permitted.');
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        save('interactions.json', interactions);
      });
      await stage('media_and_fonts', async () => {
        try {
          await withDeadline(() => page.evaluate(() => document.fonts.ready.then(() => true)), config.readiness_timeout_ms, 'Font readiness');
        } catch (error) { issues.push({ gate: 'fonts', error: error.message }); }
        const mediaSnapshot = await page.evaluate(snapshotDOM);
        for (const media of mediaSnapshot.media.filter(row => row.visible && ['video', 'audio'].includes(row.tag))) {
          const locator = page.locator(media.selector);
          await locator.scrollIntoViewIfNeeded();
          await locator.evaluate(element => { if (element.readyState < 2 && element.networkState === 0) element.load(); });
        }
        try {
          await page.waitForFunction(() => {
            const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
              && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
            return Array.from(document.images).filter(visible).every(image => image.complete && image.naturalWidth > 0)
              && Array.from(document.querySelectorAll('video,audio')).filter(visible).every(media => media.readyState >= 2 && media.currentSrc && !media.error
                && (media.tagName !== 'VIDEO' || (media.videoWidth > 0 && media.videoHeight > 0)));
          }, null, { timeout: config.readiness_timeout_ms });
        } catch (error) { issues.push({ gate: 'media', error: error.message }); }
        try {
          await withDeadline(() => page.evaluate(() => Promise.all(Array.from(document.images)
            .filter(image => image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
            .map(image => image.decode()))), config.readiness_timeout_ms, 'Image decode');
        } catch (error) { issues.push({ gate: 'media', error: error.message }); }
        const capturedMedia = await page.evaluate(snapshotDOM, { captureInlineSvg: true }).then(snapshot => snapshot.media);
        for (const media of capturedMedia) {
          if (media.inline_svg_recovery) {
            const recovery = media.inline_svg_recovery;
            const identity = createHash('sha256').update(JSON.stringify(recovery)).digest('hex');
            const relative = `${width}/inline-svg-recovery/${identity}.json`;
            const target = path.join(config.output_dir, relative);
            mkdirSync(path.dirname(target), { recursive: true });
            try {
              const image = `${width}/inline-svg-recovery/${identity}.png`;
              const payload = await page.locator(media.selector).screenshot({ path: path.join(config.output_dir, image) });
              recovery.source_image = path.join(config.output_dir, image);
              recovery.source_image_sha256 = createHash('sha256').update(payload).digest('hex');
              artifacts.push(image);
            } catch (error) { recovery.capture_error = error.message; }
            const payload = Buffer.from(JSON.stringify(recovery, null, 2) + '\n', 'utf8');
            writeFileSync(target, payload, { flag: 'wx' });
            artifacts.push(relative);
            media.inline_svg_recovery = { source_file: target, sha256: createHash('sha256').update(payload).digest('hex'),
              source_image: recovery.source_image || null, capture_error: recovery.capture_error || null };
          }
          if (!media.inline_svg) continue;
          const payload = Buffer.from(media.inline_svg, 'utf8');
          media.sha256 = createHash('sha256').update(payload).digest('hex');
          const relative = `${width}/inline-svg/${media.sha256}.svg`;
          const target = path.join(config.output_dir, relative);
          mkdirSync(path.dirname(target), { recursive: true });
          if (!artifacts.includes(relative)) {
            writeFileSync(target, payload, { flag: 'wx' });
            artifacts.push(relative);
          }
          media.source_file = target;
          media.mime = 'image/svg+xml';
          delete media.inline_svg;
        }
        save('media.json', capturedMedia);
        await page.evaluate(() => { for (const media of document.querySelectorAll('video,audio')) media.pause(); });
        await page.evaluate(() => window.scrollTo(0, 0));
      });
      await stage('static_stability', async () => {
        await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;scroll-behavior:auto!important}' });
        const final = await page.evaluate(snapshotDOM);
        merge(final);
        const selectors = final.elements.filter(row => row.visible).map(row => row.selector);
        const samples = [];
        for (let sampleIndex = 0; sampleIndex < config.stability_samples; sampleIndex++) {
          samples.push(await page.evaluate(selected => selected.map(selector => {
            const element = document.querySelector(selector);
            if (!element) return { selector, rect: null };
            const box = element.getBoundingClientRect();
            return { selector, rect: { x: box.x, y: box.y + scrollY, width: box.width, height: box.height } };
          }), selectors));
          if (sampleIndex + 1 < config.stability_samples) await page.waitForTimeout(config.stability_interval_ms);
        }
        const unstable = samples[0].filter((row, index) => !row.rect || samples.some(sample => !sample[index]?.rect
          || ['x', 'y', 'width', 'height'].some(key => Math.abs(row.rect[key] - sample[index].rect[key]) > 1))).map(row => row.selector);
        if (unstable.length) issues.push({ gate: 'stability', selectors: unstable });
        if (final.viewport.width !== width || final.viewport.dpr !== 1 || final.viewport.scale !== 1) issues.push({ gate: 'viewport', actual: final.viewport });
        const missingFonts = final.fonts.filter(font => !font.ready);
        if (missingFonts.length) issues.push({ gate: 'fonts', missing: missingFonts });
        save('stability.json', { interval_ms: config.stability_interval_ms, samples, unstable });
        save('final.json', final);
        save('observations.json', [...observed.values()]);
        const tokens = new Map();
        const tokenProperties = new Set(final.tokens.map(token => token.property));
        for (const row of observed.values()) {
          for (const [suffix, styles] of [['', row.styles], ...Object.entries(row.pseudo || {})]) {
            for (const property of tokenProperties) {
              if (!styles[property]) continue;
              const key = `${property}:${styles[property]}`;
              const token = tokens.get(key) || { property, value: styles[property], count: 0, selectors: [] };
              token.count++;
              token.selectors.push(row.selector + suffix);
              tokens.set(key, token);
            }
          }
        }
        save('tokens.json', [...tokens.values()]);
        bandRows.clear();
        for (let position = 0; position < final.viewport.scroll_height; position += 720) {
          await page.evaluate(offset => window.scrollTo(0, offset), position);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          for (const row of await page.evaluate(viewportBands)) bandRows.set(row.from_y, row);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        if (await page.evaluate(() => document.documentElement.scrollHeight) !== final.viewport.scroll_height) issues.push({ gate: 'stability', error: 'Page height changed during the final band scan' });
        const bands = [...bandRows.values()].sort((first, second) => first.from_y - second.from_y);
        save('bands.json', { sample_step: 20, scroll_height: final.viewport.scroll_height, bands });
        save('network.json', network);
        const mutations = await page.evaluate(() => window[Symbol.for('aem.discovery.observer')].mutations);
        save('signals.json', { executed: SIGNALS, mutations, signals: Object.fromEntries(SIGNALS.map(signal => [signal,
          signal === 'vertical_bands' ? bands : signal === 'third_party_embeds' ? [...embeds.values()]
            : [...observed.values()].filter(row => row.signals.includes(signal)).map(row => row.selector)])) });
        const screenshot = `${width}/source.png`;
        await page.screenshot({ path: path.join(config.output_dir, screenshot), fullPage: true, timeout: config.readiness_timeout_ms });
        artifacts.push(screenshot);
        const summary = { breakpoint: width, source_url: config.site_url, final_url: final.url, viewport: final.viewport,
          header_navigation_scope: 'visible-links-only', header_links: headerSnapshot.header_links,
          title: final.title, issues, signals_executed: SIGNALS, candidate_count: [...observed.values()].filter(row => row.signals.length).length,
          headings: [...observed.values()].filter(row => row.signals.includes('headings')).map(row => ({ selector: row.selector, text: row.content_text, owner: row.owner_selector, rect: row.rect })),
          candidates: [...observed.values()].filter(row => row.signals.length).map(row => ({ selector: row.selector, tag: row.tag, signals: row.signals, rect: row.rect })),
          media_count: final.media.length, conditional_selectors: [...observed.values()].filter(row => row.signals.includes('scroll_triggered') || row.signals.includes('dynamic_injection')).map(row => row.selector),
          third_party_embeds: [...embeds.values()] };
        save('summary.json', summary);
      });
      const status = issues.some(issue => issue.gate !== 'source_javascript') ? 'FAIL' : 'COLLECTED';
      progress(width, status);
      return { breakpoint: width, status, issues, timings, elapsed_ms: Math.round(performance.now() - started), artifacts };
    }, config.page_timeout_ms, `Discovery at ${width}px`);
  } catch (error) {
    issues.push({ gate: 'collection', error: error.message });
    save('failure.json', { breakpoint: width, issues, timings });
    progress(width, 'FAIL');
    return { breakpoint: width, status: 'FAIL', issues, timings, elapsed_ms: Math.round(performance.now() - started), artifacts };
  } finally {
    await context.close();
  }
}

export async function collectSource(input) {
  const config = validateConfig(input);
  if (existsSync(config.output_dir) && readdirSync(config.output_dir).length) throw new Error('Discovery output directory is not empty.');
  mkdirSync(config.output_dir, { recursive: true });
  const started = performance.now();
  const progress = (width, stage, details = {}) => {
    const event = { ...details, event: 'discovery', run_id: config.run_id, breakpoint: width, stage,
      at: new Date().toISOString(), elapsed_ms: Math.round(performance.now() - started) };
    appendFileSync(path.join(config.output_dir, 'progress.jsonl'), `${JSON.stringify(event)}\n`);
    console.log(formatDiscoveryProgress(event));
  };
  const results = await usingBrowser(async browser => {
    const results = [];
    const pending = [...config.breakpoints];
    await Promise.all(Array.from({ length: Math.min(config.max_parallel, pending.length) }, async () => {
      while (pending.length) results.push(await collectBreakpoint(browser, config, pending.shift(), progress));
    }));
    return results.sort((first, second) => first.breakpoint - second.breakpoint);
  });
  const artifacts = results.flatMap(result => result.artifacts).map(relative => {
    const bytes = readFileSync(path.join(config.output_dir, relative));
    return { path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const manifest = { schema_version: 1, run_id: config.run_id, site_url: config.site_url, breakpoints: config.breakpoints,
    header_navigation_scope: 'visible-links-only',
    status: results.every(result => result.status === 'COLLECTED') ? 'COLLECTED' : 'FAIL',
    collector_sha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
    elapsed_ms: Math.round(performance.now() - started), results, artifacts };
  writeJSON(path.join(config.output_dir, 'manifest.json'), manifest);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node discover.mjs <input.json>');
    const result = await collectSource(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify({ event: 'discovery_complete', status: result.status, elapsed_ms: result.elapsed_ms }));
    process.exitCode = result.status === 'COLLECTED' ? 0 : 1;
  } catch (error) {
    console.error(`Discovery failed: ${error.message}`);
    process.exitCode = 1;
  }
}