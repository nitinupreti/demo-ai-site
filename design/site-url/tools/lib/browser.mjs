import { chromium } from 'playwright';

export const MOTION_FREEZE_STYLE_ID = 'aem-migration-motion-freeze';

const MOTION_FREEZE_CSS = `
*, *::before, *::after {
  animation-delay: -0.0001s !important;
  animation-duration: 0.0001s !important;
  animation-iteration-count: 1 !important;
  animation-play-state: paused !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  caret-color: transparent !important;
}
html, body { scroll-behavior: auto !important; }
`;

export async function launchBrowser({ headless = true } = {}) {
  // Use the system Chrome by default so no browser binary download is needed (blocked behind the
  // corporate TLS-inspecting proxy). Set PLAYWRIGHT_CHANNEL="" to fall back to Playwright's bundled Chromium.
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';
  return chromium.launch({
    headless,
    channel: channel || undefined,
    args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
  });
}

/**
 * AEM answers an unauthenticated HTML request with a 302 to login.html instead of a 401, and
 * Chromium only attaches `httpCredentials` in response to a challenge — so they never fire, at any
 * `send` setting. Attaching the header ourselves is the only thing that works; scoping it to the
 * target origin keeps the credentials off any third-party asset the page happens to reference.
 */
async function attachBasicAuth(context, { username, password, origin }) {
  const header = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  await context.route('**/*', async (route) => {
    const request = route.request();
    let sameOrigin = !origin;
    if (origin) {
      try {
        sameOrigin = new URL(request.url()).origin === origin;
      } catch {
        sameOrigin = false;
      }
    }
    if (!sameOrigin) {
      await route.continue();
      return;
    }
    await route.continue({ headers: { ...request.headers(), authorization: header } });
  });
}

/** Both sides must render under identical conditions or the pixel score is meaningless. */
export async function createPage(browser, {
  width, height = 900, dpr = 1, httpCredentials, userAgent,
  colorScheme = 'light', locale = 'en-US', timezoneId = 'UTC',
} = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    userAgent,
    locale,
    timezoneId,
    colorScheme,
    reducedMotion: 'no-preference',
    forcedColors: 'none',
    extraHTTPHeaders: httpCredentials ? { Referer: 'http://localhost/' } : undefined,
  });
  if (httpCredentials?.username) await attachBasicAuth(context, httpCredentials);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.emulateMedia({ media: 'screen', colorScheme, reducedMotion: 'no-preference', forcedColors: 'none' });
  return page;
}

export async function navigate(page, url, { timeoutMs = 60000 } = {}) {
  const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    // Analytics and chat widgets keep long-lived connections open; load state is sufficient.
  }
  return {
    requested_url: url,
    final_url: page.url(),
    http_status: response ? response.status() : null,
  };
}

export async function triggerLazyLoad(page, { stepPx = 600, settleMs = 120, maxScrollPx = 50000 } = {}) {
  return page.evaluate(async ({ stepPx: step, settleMs: settle, maxScrollPx: limit }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxY = () => Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
    );
    // An infinite feed grows as fast as it is scrolled, so the pass has to stop somewhere.
    let y = 0;
    for (; y < maxY() && y <= limit; y += step) {
      window.scrollTo(0, y);
      await wait(settle);
    }
    const truncated = y < maxY();
    window.scrollTo(0, Math.min(maxY(), limit));
    await wait(settle * 4);
    window.scrollTo(0, 0);
    await wait(settle * 2);
    return { scrolled_to: Math.min(y, limit), height: maxY(), truncated };
  }, { stepPx, settleMs, maxScrollPx });
}

export async function freezeMotion(page) {
  await page.evaluate(({ styleId, css }) => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }, { styleId: MOTION_FREEZE_STYLE_ID, css: MOTION_FREEZE_CSS });
}

export async function restoreMotion(page) {
  await page.evaluate((styleId) => document.getElementById(styleId)?.remove(), MOTION_FREEZE_STYLE_ID);
}

export async function settleFonts(page, { timeoutMs = 30000 } = {}) {
  return page.evaluate(async (limit) => {
    const families = new Set();
    const nodes = Array.from(document.querySelectorAll('body *')).slice(0, 4000);
    for (const node of nodes) {
      if (!node.textContent || !node.textContent.trim()) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = getComputedStyle(node);
      const first = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (first) families.add(`${style.fontWeight}|${style.fontStyle}|${first}`);
    }
    // A font load that never finishes keeps fonts.ready pending; report it as not ready instead.
    const ready = await Promise.race([
      document.fonts.ready.then(() => true, () => false),
      new Promise((resolve) => { setTimeout(() => resolve(false), limit); }),
    ]);
    const checked = Array.from(families).slice(0, 60).map((entry) => {
      const [weight, style, family] = entry.split('|');
      let loaded = false;
      try {
        loaded = document.fonts.check(`${style} ${weight} 16px "${family}"`);
      } catch {
        loaded = false;
      }
      return { family, weight, style, loaded };
    });
    return { ready, checked, status: document.fonts.status };
  }, timeoutMs);
}

export async function settleImages(page, { decodeTimeoutMs = 30000 } = {}) {
  return page.evaluate(async (timeoutMs) => {
    const images = Array.from(document.images).filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    // A lazy image the viewport never reaches (clipped ticker/carousel) is never fetched, so decode() never settles.
    let promoted = 0;
    for (const image of images) {
      if (image.loading === 'lazy' && !image.complete) {
        image.loading = 'eager';
        promoted += 1;
      }
    }
    const failed = [];
    await Promise.all(images.map(async (image) => {
      try {
        if (typeof image.decode === 'function') {
          // Bounded so one image that never settles is reported as undecoded instead of stalling the capture.
          await Promise.race([image.decode(), new Promise((resolve) => { setTimeout(resolve, timeoutMs); })]);
        }
      } catch {
        // Fall through to the attribute assertions below.
      }
      if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
        failed.push(image.currentSrc || image.src || '(no src)');
      }
    }));
    return {
      total: images.length, decoded: images.length - failed.length, promoted, failed,
    };
  }, decodeTimeoutMs);
}

export async function settleMedia(page, { comparableTime = 0.01 } = {}) {
  return page.evaluate(async (targetTime) => {
    const once = (element, event, timeoutMs) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), timeoutMs);
      element.addEventListener(event, () => {
        clearTimeout(timer);
        resolve('ok');
      }, { once: true });
    });
    const presentedFrame = (video) => new Promise((resolve) => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        const timer = setTimeout(() => resolve('timeout'), 4000);
        video.requestVideoFrameCallback(() => {
          clearTimeout(timer);
          resolve('frame-callback');
        });
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => resolve('raf')));
    });

    const report = [];
    const videos = Array.from(document.querySelectorAll('video'));
    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      const entry = {
        selector: video.id ? `#${video.id}` : video.className ? `video.${String(video.className).trim().split(/\s+/)[0]}` : 'video',
        visible,
        autoplay: video.autoplay,
        loop: video.loop,
        muted: video.muted,
        controls: video.controls,
        preload: video.preload,
        poster: video.poster || null,
      };
      if (!visible) {
        report.push({ ...entry, skipped: true });
        continue;
      }
      try {
        video.muted = true;
        video.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (video.readyState < 1) {
          try { video.load(); } catch { /* already loading */ }
          entry.metadata = await once(video, 'loadedmetadata', 10000);
        }
        video.pause();
        if (video.seekable && video.seekable.length > 0) {
          const start = video.seekable.start(0);
          const desired = Math.max(start + targetTime, targetTime);
          if (Math.abs(video.currentTime - desired) > 0.001) {
            video.currentTime = desired;
            entry.seek = await once(video, 'seeked', 10000);
          }
        }
        entry.frame = await presentedFrame(video);
      } catch (error) {
        entry.error = String(error && error.message ? error.message : error);
      }
      entry.current_src = video.currentSrc || video.src || null;
      entry.ready_state = video.readyState;
      entry.network_state = video.networkState;
      entry.intrinsic = { width: video.videoWidth, height: video.videoHeight };
      entry.current_time = video.currentTime;
      entry.decoded = video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
      report.push(entry);
    }
    return report;
  }, comparableTime);
}

export async function sampleStableRects(page, selectors, { samples = 3, intervalMs = 500 } = {}) {
  const readings = [];
  for (let index = 0; index < samples; index += 1) {
    if (index > 0) await page.waitForTimeout(intervalMs);
    readings.push(await page.evaluate((list) => {
      const result = {};
      for (const entry of list) {
        const element = document.querySelectorAll(entry.css)[entry.matchIndex || 0];
        if (!element) {
          result[entry.key] = null;
          continue;
        }
        const rect = element.getBoundingClientRect();
        result[entry.key] = {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          w: rect.width,
          h: rect.height,
        };
      }
      return result;
    }, selectors));
  }

  let maxDelta = 0;
  const unstable = [];
  for (const key of Object.keys(readings[0] || {})) {
    const values = readings.map((reading) => reading[key]).filter(Boolean);
    if (values.length !== readings.length) {
      unstable.push(`${key}: element missing during sampling`);
      continue;
    }
    for (const axis of ['x', 'y', 'w', 'h']) {
      const numbers = values.map((value) => value[axis]);
      const delta = Math.max(...numbers) - Math.min(...numbers);
      if (delta > maxDelta) maxDelta = delta;
      if (delta > 1) unstable.push(`${key}.${axis} moved ${delta.toFixed(2)}px`);
    }
  }
  return { samples: readings.length, max_delta_px: Number(maxDelta.toFixed(3)), unstable, readings };
}

export async function viewportState(page, expectedWidth) {
  return page.evaluate((expected) => ({
    inner_width: window.innerWidth,
    client_width: document.documentElement.clientWidth,
    scroll_width: document.documentElement.scrollWidth,
    scroll_height: document.documentElement.scrollHeight,
    dpr: window.devicePixelRatio,
    visual_viewport_scale: window.visualViewport ? window.visualViewport.scale : 1,
    matches_expected: window.innerWidth === expected,
  }), expectedWidth);
}

/**
 * Identical readiness path for source and target; comparable scores depend on it.
 * Failures invalidate a capture. Warnings describe what the page itself did and are
 * reported rather than blocking, because the live source is the ground truth.
 */
export async function prepareForCapture(page, { width, dynamicSettleMs = 3000, stableSelectors = [] } = {}) {
  const failures = [];
  const warnings = [];
  const lazyLoad = await triggerLazyLoad(page);
  if (lazyLoad.truncated) {
    warnings.push(`lazy-load scroll stopped at ${lazyLoad.scrolled_to}px while the page kept growing (${lazyLoad.height}px)`);
  }
  await page.waitForTimeout(dynamicSettleMs);

  const viewport = await viewportState(page, width);
  if (!viewport.matches_expected) {
    failures.push(`innerWidth ${viewport.inner_width} does not match requested ${width}`);
  }

  const fonts = await settleFonts(page);
  if (!fonts.ready) failures.push('document.fonts.ready did not resolve');
  const unloadedFonts = fonts.checked.filter((entry) => !entry.loaded);
  if (unloadedFonts.length) {
    warnings.push(`font faces rendering from a fallback: ${unloadedFonts.map((entry) => `${entry.family} ${entry.weight}`).join(', ')}`);
  }

  const images = await settleImages(page);
  if (images.failed.length) failures.push(`undecoded images: ${images.failed.slice(0, 5).join(', ')}`);

  const media = await settleMedia(page);
  const undecodedVideo = media.filter((entry) => !entry.skipped && !entry.decoded);
  if (undecodedVideo.length) {
    failures.push(`undecoded video: ${undecodedVideo.map((entry) => entry.selector).join(', ')}`);
  }

  await freezeMotion(page);

  const stability = await sampleStableRects(page, [
    { key: '__document', css: 'html', matchIndex: 0 },
    ...stableSelectors,
  ]);
  const documentDrift = stability.unstable.filter((entry) => entry.startsWith('__document'));
  const selectorDrift = stability.unstable.filter((entry) => !entry.startsWith('__document'));
  if (selectorDrift.length) {
    failures.push(`unstable geometry: ${selectorDrift.slice(0, 5).join('; ')}`);
  }
  if (documentDrift.length) {
    warnings.push(`document height is not settled: ${documentDrift.join('; ')}`);
  }

  return {
    breakpoint: width,
    inner_width: viewport.inner_width,
    client_width: viewport.client_width,
    scrollbar_width: viewport.inner_width - viewport.client_width,
    scroll_width: viewport.scroll_width,
    scroll_height: viewport.scroll_height,
    dpr: viewport.dpr,
    visual_viewport_scale: viewport.visual_viewport_scale,
    fonts_ready: fonts.ready,
    fonts_checked: fonts.checked,
    images,
    media,
    max_rect_delta_px: stability.max_delta_px,
    stable_rect_samples: stability.samples,
    document_settled: documentDrift.length === 0,
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    warnings,
  };
}

const FONT_PROBE_ATTRIBUTE = 'data-aem-migration-font-probe';

/**
 * Fonts the platform actually rasterised for the element's text, which can differ from the declared
 * stack. CDP only reports a node's own text nodes, and a component root rarely has any, so every
 * text-bearing descendant is measured and the glyph counts are summed per family.
 */
export async function renderedFonts(page, selector, matchIndex = 0, { maxNodes = 250 } = {}) {
  let session;
  try {
    const marked = await page.evaluate(({ css, index, attribute, limit }) => {
      const root = document.querySelectorAll(css)[index];
      if (!root) return -1;
      let count = 0;
      for (const node of [root, ...root.querySelectorAll('*')]) {
        if (count >= limit) break;
        if (node.closest('script,style,noscript')) continue;
        if (!Array.from(node.childNodes).some((child) => child.nodeType === 3 && child.nodeValue.trim())) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        node.setAttribute(attribute, '');
        count += 1;
      }
      return count;
    }, {
      css: selector, index: matchIndex, attribute: FONT_PROBE_ATTRIBUTE, limit: maxNodes,
    });
    if (marked < 0) return null;
    session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: -1 });
    const { nodeIds } = await session.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `[${FONT_PROBE_ATTRIBUTE}]` });
    const totals = new Map();
    for (const nodeId of nodeIds) {
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      for (const font of fonts) {
        const entry = totals.get(font.familyName) || { family: font.familyName, glyphs: 0, custom: false };
        entry.glyphs += font.glyphCount;
        entry.custom = entry.custom || font.isCustomFont;
        totals.set(font.familyName, entry);
      }
    }
    return [...totals.values()].sort((a, b) => b.glyphs - a.glyphs);
  } catch {
    return null;
  } finally {
    await page.evaluate((attribute) => {
      for (const node of document.querySelectorAll(`[${attribute}]`)) node.removeAttribute(attribute);
    }, FONT_PROBE_ATTRIBUTE).catch(() => {});
    if (session) await session.detach().catch(() => {});
  }
}
