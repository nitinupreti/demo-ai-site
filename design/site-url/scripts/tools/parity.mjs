import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mjs';

export function snapshot(root, properties) {
  const rows = [];
  const rootBox = root.getBoundingClientRect();
  function selectorFor(element) {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) return `#${CSS.escape(element.id)}`;
    const peers = element.parentElement ? [...element.parentElement.children].filter(child => child.localName === element.localName) : [element];
    const segment = `${element.localName}:nth-of-type(${peers.indexOf(element) + 1})`;
    return element.parentElement ? `${selectorFor(element.parentElement)} > ${segment}` : segment;
  }
  const normalize = text => (text || '').replace(/\s+/g, ' ').trim();
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element.matches('script,style,link,meta,noscript,source,track') || element.parentElement?.closest('svg')) continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const computed = getComputedStyle(element);
    const nodes = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && normalize(node.textContent));
    const text = normalize(nodes.map(node => node.textContent).join(' '));
    const media = element.matches('img,svg,video,audio,iframe,canvas,object,embed');
    const kind = element === root ? 'root' : text ? 'text' : media ? 'media' : 'container';
    const row = {
      id: `role-${rows.length}`, selector: selectorFor(element), kind, text, has_text: Boolean(text), tag: element.localName,
      key: JSON.stringify([kind, text || normalize(element.innerText), media ? element.localName : '', element.getAttribute('alt') || '']),
      styles: Object.fromEntries(properties.map(name => [name, computed[name]])),
      rect: { x: element === root ? box.x : box.x - rootBox.x, y: element === root ? box.y + scrollY : box.y - rootBox.y, width: box.width, height: box.height },
      font_ready: !text || document.fonts.check(`${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`, text),
      fonts: [], line_boxes: nodes.flatMap(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()].map(rect => ({ width: rect.width, height: rect.height }));
      }),
      interactive: element.matches('a[href],button,input,select,textarea,summary,[role="button"],[tabindex]'),
      state: Object.fromEntries(['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'open', 'checked', 'disabled'].filter(name => element.hasAttribute(name)).map(name => [name, element.getAttribute(name)])),
      in_header: Boolean(element.closest('header,[role="banner"]') || (!element.closest('main,article,footer,[role="contentinfo"]') && element.closest('nav,[role="navigation"]'))),
    };
    if (element.matches('img')) row.media = { kind: 'img', ready: element.complete && element.naturalWidth > 0, width: element.naturalWidth, height: element.naturalHeight };
    if (element.matches('video,audio')) row.media = { kind: element.localName, ready: element.readyState >= 2 && Boolean(element.currentSrc), autoplay: element.autoplay, loop: element.loop, muted: element.muted, controls: element.controls, playsInline: element.playsInline ?? false, width: element.videoWidth || 0, height: element.videoHeight || 0 };
    if (element.matches('iframe,object,embed')) row.media = { kind: element.localName, ready: false, error: 'Embedded media requires a supported, explicit frame verification; it is not automatically accepted.' };
    rows.push(row);
    for (const pseudo of ['::before', '::after']) {
      const style = getComputedStyle(element, pseudo);
      if (['none', 'normal'].includes(style.content) || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const content = style.content === '""' ? '' : style.content;
      rows.push({ id: `role-${rows.length}`, selector: row.selector, pseudo, kind: 'pseudo', text: content, has_text: Boolean(content),
        key: JSON.stringify(['pseudo', pseudo, row.key, content]), styles: Object.fromEntries(properties.map(name => [name, style[name]])),
        font_ready: !content || document.fonts.check(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, content), fonts: [], line_boxes: [] });
    }
  }
  if (!rows.length || rows[0].kind !== 'root') throw new Error('Mapped root is not visible.');
  return rows;
}

async function rootFor(page, selector, index) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (!count || (index === null && count !== 1) || (index !== null && index >= count)) throw new Error(`Missing or ambiguous root: ${selector}`);
  return locator.nth(index ?? 0);
}

async function measure(page, root, input) {
  await root.scrollIntoViewIfNeeded();
  let previous;
  let rows;
  for (let sample = 0; sample < input.stability_samples; sample++) {
    if (sample) await page.waitForTimeout(input.stability_interval_ms);
    rows = await root.evaluate(snapshot, input.properties);
    if (previous && JSON.stringify(previous) !== JSON.stringify(rows)) throw new Error('Unstable component styles, content or geometry.');
    previous = rows;
  }
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const document = await session.send('DOM.getDocument');
    const textRows = rows.filter(row => row.has_text);
    for (let offset = 0; offset < textRows.length; offset += 20) {
      await Promise.all(textRows.slice(offset, offset + 20).map(async row => {
        let { nodeId } = await session.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: row.selector });
        if (row.pseudo) {
          const { node } = await session.send('DOM.describeNode', { nodeId });
          nodeId = node.pseudoElements?.find(element => element.pseudoType === row.pseudo.slice(2))?.nodeId;
          if (!nodeId) throw new Error(`Cannot identify rendered pseudo-element font: ${row.selector}${row.pseudo}`);
        }
        const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
        row.fonts = fonts.filter(font => font.glyphCount > 0).map(({ familyName, postScriptName, isCustomFont }) => ({ familyName, postScriptName, isCustomFont }))
          .sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)));
      }));
    }
  } finally { await session.detach(); }
  return { rows, root };
}

async function resolveRole(root, selector, rows) {
  const pseudo = selector.endsWith('::before') ? '::before' : selector.endsWith('::after') ? '::after' : '';
  return root.evaluate((element, input) => {
    const matches = input.selector === ':scope' ? [element] : [...element.querySelectorAll(input.selector)];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous role selector: ${input.selector}`);
    return input.rows.find(row => (row.pseudo || '') === input.pseudo && document.querySelector(row.selector) === matches[0])?.id;
  }, { selector: pseudo ? selector.slice(0, -pseudo.length) : selector, pseudo, rows });
}

async function match(source, target, overrides = []) {
  const pairs = [{ source: source.rows[0].id, target: target.rows[0].id }];
  const usedSource = new Set([source.rows[0].id]);
  const usedTarget = new Set([target.rows[0].id]);
  const errors = [];
  for (const override of overrides) {
    const sourceId = await resolveRole(source.root, override.source_selector, source.rows);
    const targetId = await resolveRole(target.root, override.target_selector, target.rows);
    if (!sourceId || !targetId || usedSource.has(sourceId) || usedTarget.has(targetId)) throw new Error('Invalid or duplicate explicit role mapping.');
    pairs.push({ source: sourceId, target: targetId });
    usedSource.add(sourceId);
    usedTarget.add(targetId);
  }
  for (const row of source.rows.slice(1)) {
    if (usedSource.has(row.id)) continue;
    const matches = target.rows.filter(candidate => !usedTarget.has(candidate.id) && candidate.key === row.key);
    if (matches.length !== 1) {
      errors.push({ source_selector: row.selector + (row.pseudo || ''), error: matches.length ? 'Ambiguous counterpart; provide a role mapping.' : 'Missing counterpart; source roles cannot be omitted.' });
      continue;
    }
    pairs.push({ source: row.id, target: matches[0].id });
    usedSource.add(row.id);
    usedTarget.add(matches[0].id);
  }
  for (const row of target.rows) {
    if (!usedTarget.has(row.id) && ['text', 'media', 'pseudo'].includes(row.kind)) errors.push({ target_selector: row.selector + (row.pseudo || ''), error: 'Unexpected target content.' });
  }
  return { source_roles: source.rows, target_roles: target.rows, pairs, errors };
}

async function prepare(page, url, input, author = false) {
  const response = await page.goto(url, { waitUntil: 'load' });
  if (!response?.ok()) throw new Error(`Page request failed: ${response?.status()}`);
  if (page.url() !== url) throw new Error('Unexpected redirect; update the explicit run URL rather than comparing a different page.');
  if (author && await page.locator('iframe#ContentFrame').count()) {
    const element = await page.locator('iframe#ContentFrame').elementHandle();
    const frame = await element.contentFrame();
    const resolved = new URL(frame.url());
    if (resolved.origin !== new URL(url).origin || resolved.pathname !== `${input.target_page_path}.html`) throw new Error('Author content frame does not belong to the target page.');
    const contentResponse = await page.goto(resolved.href, { waitUntil: 'load' });
    if (!contentResponse?.ok() || page.url() !== resolved.href) throw new Error('Author content frame failed to render at its validated URL.');
  }
  await page.mouse.move(0, 0);
  await page.addStyleTag({ content: '* { scroll-behavior: auto !important; }' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const height = document.documentElement.scrollHeight;
    for (let top = 0; top < height; top += Math.max(1, innerHeight)) {
      scrollTo(0, top);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    scrollTo(0, 0);
    await Promise.all([...document.images].filter(image => image.getBoundingClientRect().width > 0).map(image => image.decode()));
    await document.fonts.ready;
    for (const media of document.querySelectorAll('video,audio')) {
      if (!media.checkVisibility({ checkVisibilityCSS: true }) || !media.getBoundingClientRect().width) continue;
      if (media.readyState < 2) await new Promise((resolve, reject) => {
        media.addEventListener('loadeddata', resolve, { once: true });
        media.addEventListener('error', () => reject(new Error('Media failed to decode.')), { once: true });
      });
      if (media.autoplay) {
        const before = media.currentTime;
        await new Promise(resolve => setTimeout(resolve, 1100));
        if (media.paused || media.currentTime - before < 0.5) throw new Error('Autoplay media is not playing.');
      }
      media.pause();
      if (!media.seekable.length) throw new Error('Visible media has no deterministic seekable frame.');
      const target = Math.max(0.01, media.seekable.start(0));
      if (Math.abs(media.currentTime - target) > 0.001) {
        await new Promise((resolve, reject) => {
          media.addEventListener('seeked', resolve, { once: true });
          media.addEventListener('error', () => reject(new Error('Media seek failed.')), { once: true });
          media.currentTime = target;
        });
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  });
}

async function freeze(page) {
  return page.addStyleTag({ content: '*,*::before,*::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
}

async function savePair(source, target, directory, index) {
  const sourceImage = path.join(directory, `${index}-source.png`);
  const targetImage = path.join(directory, `${index}-target.png`);
  await source.screenshot({ path: sourceImage });
  await target.screenshot({ path: targetImage });
  return { source_image: sourceImage, target_image: targetImage };
}

async function interact(page, root, action, side) {
  const locator = root.locator(action[`${side}_selector`]);
  if (await locator.count() !== 1) throw new Error('Missing or ambiguous interaction control.');
  if (action.type === 'hover') await locator.hover();
  else if (action.type === 'focus') await locator.focus();
  else if (action.type === 'click') {
    const unsafe = await locator.evaluate(element => Boolean(element.closest('a[href]') || element.closest('form') || element.matches('input[type=submit],input[type=image]')));
    if (unsafe) throw new Error('Navigation, form submission and data-changing controls are outside deterministic interaction probing.');
    await locator.click();
  } else throw new Error(`Unsupported interaction type: ${action.type}`);
  await page.waitForTimeout(500);
}

export async function capture(input, directory) {
  mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, timeout: 0 });
  const measured = { schema_version: 1, run_id: input.run_id, groups: [], page_composites: [] };
  let imageIndex = 0;
  try {
    for (const width of input.breakpoints) {
      for (const mode of input.modes) {
        console.error(`Comparing ${width}px / ${mode}`);
        const sourceContext = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        const credentials = process.env[input.credentials_env] || '';
        const separator = credentials.indexOf(':');
        const targetContext = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1,
          ...(separator >= 0 ? { httpCredentials: { username: credentials.slice(0, separator), password: credentials.slice(separator + 1) } } : {}) });
        try {
          const sourcePage = await sourceContext.newPage();
          const targetPage = await targetContext.newPage();
          let pageError;
          try {
            await prepare(sourcePage, input.live_url, input);
            await prepare(targetPage, input.aem_urls[mode], input, mode === 'author');
            if (await sourcePage.evaluate(() => innerWidth) !== width || await targetPage.evaluate(() => innerWidth) !== width) throw new Error('Incorrect rendered viewport.');
          } catch (error) { pageError = error.message; }
          for (const group of input.groups.filter(row => row.breakpoint === width && row.mode === mode)) {
            const result = { component_id: group.component_id, instance_id: group.instance_id, breakpoint: width, mode,
              live_url: input.live_url, aem_url: input.aem_urls[mode], dpr: 1, states: [], errors: [] };
            try {
              if (pageError) throw new Error(pageError);
              await sourcePage.mouse.move(0, 0);
              await targetPage.mouse.move(0, 0);
              await sourcePage.evaluate(() => document.activeElement?.blur());
              await targetPage.evaluate(() => document.activeElement?.blur());
              result.final_source_url = sourcePage.url();
              result.final_target_url = targetPage.url();
              result.source_viewport = await sourcePage.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, scale: visualViewport.scale }));
              result.target_viewport = await targetPage.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, scale: visualViewport.scale }));
              if ([result.source_viewport, result.target_viewport].some(viewport => viewport.width !== width || viewport.dpr !== 1 || viewport.scale !== 1)) throw new Error('Viewport, DPR or scale changed before component measurement.');
              const sourceRoot = await rootFor(sourcePage, group.source_selector, group.source_match_index);
              const targetRoot = await rootFor(targetPage, group.target_selector, group.target_match_index);
              const sourceFreeze = await freeze(sourcePage);
              const targetFreeze = await freeze(targetPage);
              const source = await measure(sourcePage, sourceRoot, input);
              const target = await measure(targetPage, targetRoot, input);
              Object.assign(result, await match(source, target, group.roles), await savePair(sourceRoot, targetRoot, directory, imageIndex++));
              await sourceFreeze.evaluate(element => element.remove());
              await targetFreeze.evaluate(element => element.remove());
              const header = await sourceRoot.evaluate(element => Boolean(element.closest('header,[role=banner]') || element.matches('nav,[role=navigation]') || (!element.closest('main,article,footer') && !element.querySelector('main,article,footer') && element.querySelector('nav'))));
              result.header_interactions_excluded = header;
              const explicit = group.interactions || [];
              const actions = header ? [] : [...explicit];
              if (!header) for (const pair of result.pairs) {
                const sourceRole = source.rows.find(row => row.id === pair.source);
                const targetRole = target.rows.find(row => row.id === pair.target);
                if (!sourceRole.interactive || sourceRole.in_header) continue;
                for (const type of ['hover', 'focus']) actions.push({ id: `${type}:${sourceRole.id}`, type, source_selector: sourceRole.selector, target_selector: targetRole.selector, automatic: true });
              }
              result.required_interactions = header ? [] : group.required_interactions;
              for (const action of actions) {
                const state = { id: action.id, errors: [] };
                try {
                  await sourcePage.mouse.move(0, 0);
                  await targetPage.mouse.move(0, 0);
                  await sourcePage.evaluate(() => document.activeElement?.blur());
                  await targetPage.evaluate(() => document.activeElement?.blur());
                  const sourceScope = action.automatic ? sourcePage.locator('html') : sourceRoot;
                  const targetScope = action.automatic ? targetPage.locator('html') : targetRoot;
                  const sourceState = action.automatic ? sourcePage.locator(action.source_selector) : action.source_state_selector ? sourcePage.locator(action.source_state_selector) : sourceRoot;
                  const targetState = action.automatic ? targetPage.locator(action.target_selector) : action.target_state_selector ? targetPage.locator(action.target_state_selector) : targetRoot;
                  const signature = rows => JSON.stringify(rows.map(row => ({ kind: row.kind, text: row.text, state: row.state })));
                  const before = [];
                  if (action.type === 'click') {
                    for (const locator of [sourceState, targetState]) {
                      before.push(await locator.isVisible() ? signature(await locator.evaluate(snapshot, input.properties)) : null);
                    }
                  }
                  await interact(sourcePage, sourceScope, action, 'source');
                  await interact(targetPage, targetScope, action, 'target');
                  const liveState = await measure(sourcePage, sourceState, input);
                  const aemState = await measure(targetPage, targetState, input);
                  if (action.type === 'click' && (signature(liveState.rows) === before[0] || signature(aemState.rows) === before[1])) {
                    state.errors.push({ error: 'Click did not produce a measurable content/semantic-state change on both pages; unsupported or incorrect probe.' });
                  }
                  Object.assign(state, await match(liveState, aemState), await savePair(sourceState, targetState, directory, imageIndex++));
                } catch (error) { state.errors.push({ error: error.message }); }
                result.states.push(state);
              }
              if (actions.some(action => action.type === 'click')) {
                await prepare(sourcePage, input.live_url, input);
                await prepare(targetPage, input.aem_urls[mode], input, mode === 'author');
              }
            } catch (error) { result.errors.push({ error: error.message }); }
            measured.groups.push(result);
          }
          const pageResult = { breakpoint: width, mode, live_url: input.live_url, aem_url: input.aem_urls[mode], dpr: 1 };
          try {
            if (pageError) throw new Error(pageError);
            await sourcePage.mouse.move(0, 0);
            await targetPage.mouse.move(0, 0);
            await sourcePage.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
            await targetPage.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
            await freeze(sourcePage);
            await freeze(targetPage);
            pageResult.source_image = path.join(directory, `page-${width}-${mode}-source.png`);
            pageResult.target_image = path.join(directory, `page-${width}-${mode}-target.png`);
            await sourcePage.screenshot({ path: pageResult.source_image, fullPage: true });
            await targetPage.screenshot({ path: pageResult.target_image, fullPage: true });
          } catch (error) { pageResult.error = error.message; }
          measured.page_composites.push(pageResult);
        } finally {
          await sourceContext.close();
          await targetContext.close();
        }
      }
    }
  } finally { await browser.close(); }
  return measured;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node parity.mjs <input.json> <capture-directory>');
    const result = await capture(JSON.parse(readFileSync(process.argv[2], 'utf8')), path.resolve(process.argv[3]));
    writeFileSync(path.join(process.argv[3], 'measured.json'), JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}