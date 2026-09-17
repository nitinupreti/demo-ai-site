import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mjs';

export async function verifyDeployment(input) {
  if (input.schema_version !== 1 || !input.components?.length || !input.breakpoints?.length || !input.modes?.length) throw new Error('Incomplete deployment runtime input.');
  const origin = new URL(input.aem_urls.disabled).origin;
  const credentials = process.env[input.credentials_env] || '';
  const separator = credentials.indexOf(':');
  const browser = await chromium.launch({ headless: true });
  const report = { schema_version: 1, run_id: input.run_id, status: 'PASS', blocked: false, assets: [], models: [], pages: [], failures: [] };
  const fail = entry => { report.status = 'FAIL'; report.failures.push(entry); };
  const httpCredentials = separator >= 0 ? { username: credentials.slice(0, separator), password: credentials.slice(separator + 1), origin } : undefined;
  try {
    const assetsContext = await browser.newContext({ httpCredentials, extraHTTPHeaders: { Referer: `${origin}/` } });
    try {
      const imagePage = await assetsContext.newPage();
      for (const asset of input.assets || []) {
        try {
          const url = new URL(asset.dam_path, origin);
          if (url.origin !== origin || !url.pathname.startsWith('/content/dam/')) throw new Error('Invalid DAM origin or path.');
          const response = await assetsContext.request.get(url.href, { maxRedirects: 0 });
          if ([401, 403].includes(response.status())) report.blocked = true;
          if (response.status() !== 200) throw new Error(`DAM request returned HTTP ${response.status()}.`);
          const body = await response.body();
          const mime = response.headers()['content-type']?.split(';')[0] || '';
          if (!body.length || !/^(image\/|video\/|audio\/|font\/|application\/(font|pdf)|text\/css)/.test(mime)) throw new Error('DAM asset has empty or invalid media content.');
          if (mime.startsWith('image/')) {
            await imagePage.evaluate(async data => {
              const image = new Image();
              image.src = data;
              await image.decode();
              if (!image.naturalWidth || !image.naturalHeight) throw new Error('DAM image did not decode.');
            }, `data:${mime};base64,${body.toString('base64')}`);
          }
          report.assets.push({ path: asset.dam_path, mime, bytes: body.length, status: 'PASS' });
        } catch (error) {
          fail({ error: `DAM asset failed: ${asset.dam_path}: ${error.message}`, component_id: asset.owners?.[0], owning_layer: 'assets' });
        }
      }
    } finally {
      await assetsContext.close();
    }
    const modelContext = await browser.newContext({ httpCredentials, javaScriptEnabled: false, extraHTTPHeaders: { Referer: `${origin}/` } });
    try {
      for (const component of input.components) {
        for (const probe of component.model_probes || []) {
          const measured = { component_id: component.id, model: probe.model, resource_path: probe.resource_path, kind: probe.kind, status: 'PASS' };
          report.models.push(measured);
          const page = await modelContext.newPage();
          try {
            const suffix = probe.kind === 'htl' ? '.html?wcmmode=disabled' : '.model.json';
            const url = new URL(probe.resource_path + suffix, origin);
            if (url.origin !== origin || !url.pathname.startsWith('/content/')) throw new Error('Model probe escaped the AEM origin.');
            if (probe.kind === 'htl') {
              const response = await page.goto(url.href, { waitUntil: 'load' });
              if ([401, 403].includes(response?.status())) report.blocked = true;
              if (response?.status() !== 200 || page.url() !== url.href) throw new Error('HTL model probe failed or redirected.');
              if (/SightlyException|Cannot correctly instantiate|SlingException/.test(await page.locator('body').innerText())) throw new Error('HTL model adaptation failed.');
              const value = page.locator(probe.selector);
              if (await value.count() !== 1 || (await value.textContent())?.trim() !== probe.text) throw new Error('Server-rendered model value differs from the declared expectation.');
              measured.text = await value.textContent();
            } else {
              const response = await modelContext.request.get(url.href, { maxRedirects: 0 });
              if ([401, 403].includes(response.status())) report.blocked = true;
              if (response.status() !== 200) throw new Error(`Model exporter returned HTTP ${response.status()}.`);
              const actual = await response.json();
              const matches = (expected, value) => {
                if (Array.isArray(expected)) return Array.isArray(value) && expected.length === value.length && expected.every((entry, index) => matches(entry, value[index]));
                if (expected && typeof expected === 'object') return value && typeof value === 'object' && Object.entries(expected).every(([key, entry]) => Object.hasOwn(value, key) && matches(entry, value[key]));
                return expected === value;
              };
              if (!matches(probe.expected, actual)) throw new Error('Exported model values differ from the declared expectation.');
              measured.checked_keys = Object.keys(probe.expected);
            }
          } catch (error) {
            measured.status = 'FAIL';
            fail({ component_id: component.id, owning_layer: 'component', model: probe.model, error: error.message });
          } finally {
            await page.close();
          }
        }
      }
    } finally {
      await modelContext.close();
    }
    for (const width of input.breakpoints) {
      for (const mode of input.modes) {
        const result = { breakpoint: width, mode, status: 'PASS', components: [], clientlibs: [] };
        report.pages.push(result);
        const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, httpCredentials, extraHTTPHeaders: { Referer: `${origin}/` } });
        try {
          const page = await context.newPage();
          const errors = [];
          const loaded = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('response', response => {
            if (response.status() >= 200 && response.status() < 400 && ['stylesheet', 'script'].includes(response.request().resourceType())) loaded.push({ url: response.url(), kind: response.request().resourceType() });
            if (response.status() >= 400 && ['stylesheet', 'script', 'image', 'media', 'font'].includes(response.request().resourceType())) errors.push(`Resource HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
          });
          page.on('requestfailed', request => {
            if (['stylesheet', 'script', 'image', 'media', 'font'].includes(request.resourceType())) errors.push(`Resource failed: ${new URL(request.url()).pathname}`);
          });
          const url = input.aem_urls[mode];
          if (new URL(url).origin !== origin) throw new Error('Runtime URL is outside the configured AEM origin.');
          const response = await page.goto(url, { waitUntil: 'load' });
          if ([401, 403].includes(response?.status()) || /\/login|\/signin/.test(new URL(page.url()).pathname)) report.blocked = true;
          if (response?.status() !== 200 || page.url() !== url) throw new Error('Target page failed or redirected.');
          if (mode === 'author') {
            const frameElement = page.locator('iframe#ContentFrame');
            await frameElement.waitFor({ state: 'attached' });
            const frame = await (await frameElement.elementHandle()).contentFrame();
            if (!frame) throw new Error('Author content frame is unavailable.');
            await frame.waitForURL(candidate => candidate.origin === origin && candidate.pathname === `${input.target_page_path}.html`, { waitUntil: 'load' });
            const contentUrl = frame.url();
            loaded.length = 0;
            const content = await page.goto(contentUrl, { waitUntil: 'load' });
            if (content?.status() !== 200 || page.url() !== contentUrl) throw new Error('Author content frame failed to render.');
          }
          await page.waitForFunction(() => document.fonts.status === 'loaded');
          await page.evaluate(async () => {
            for (let top = 0; top < document.documentElement.scrollHeight; top += innerHeight) {
              scrollTo(0, top);
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
            scrollTo(0, 0);
          });
          await page.waitForFunction(() => [...document.images].filter(image => image.checkVisibility()).every(image => image.complete && image.naturalWidth > 0)
            && [...document.querySelectorAll('video,audio')].filter(media => media.checkVisibility()).every(media => media.readyState >= 2));
          await page.evaluate(() => Promise.all([...document.images].filter(image => image.checkVisibility()).map(image => image.decode())));
          if (/SightlyException|Cannot correctly instantiate|SlingException/.test(await page.locator('body').innerText())) throw new Error('AEM rendering or Sling Model adaptation failed.');
          const targets = [];
          for (const component of input.components) {
            const visible = !component.visible_breakpoints || component.visible_breakpoints.includes(width);
            const instances = [...new Set(component.source_selectors.filter(selector => !visible || !selector.breakpoint || selector.breakpoint === width).map(selector => selector.instance_id))];
            if (!instances.length) throw new Error(`No planned instances for ${component.id}/${width}.`);
            for (const instance of instances) {
              const candidates = component.targets.filter(target => target.instance_id === instance && (!target.breakpoint || target.breakpoint === width) && (!target.mode || target.mode === mode));
              if (!visible && !candidates.length) {
                const selectors = [...new Set(component.targets.filter(target => target.instance_id === instance && (!target.mode || target.mode === mode)).map(target => target.selector))];
                if (!selectors.length) throw new Error(`No target selector available to verify hidden instance ${component.id}/${instance}.`);
                for (const selector of selectors) targets.push({ component_id: component.id, instance_id: instance, selector, visible: false });
                continue;
              }
              const specificity = target => Number(Boolean(target.breakpoint)) + Number(Boolean(target.mode));
              candidates.sort((first, second) => specificity(second) - specificity(first));
              if (!candidates.length || (candidates.length > 1 && specificity(candidates[0]) === specificity(candidates[1]))) throw new Error(`Missing or ambiguous target for ${component.id}/${instance}/${width}/${mode}.`);
              targets.push({ ...candidates[0], component_id: component.id, source_order: component.source_order, delivery: component.delivery, visible });
            }
          }
          const measured = await page.evaluate(({ targets: specifications, tokenPrefix }) => {
            const rows = [];
            const assigned = new Set();
            const ordered = [];
            for (const target of specifications) {
              const nodes = [...document.querySelectorAll(target.selector)];
              const visibleNodes = nodes.filter(node => node.checkVisibility({ checkVisibilityCSS: true }));
              const row = { component_id: target.component_id, instance_id: target.instance_id, errors: [] };
              rows.push(row);
              if (!target.visible) {
                if (visibleNodes.length) row.errors.push('Component is visible at an intentionally hidden breakpoint.');
                continue;
              }
              const expectedCount = specifications.filter(other => other.visible && other.selector === target.selector).length;
              if (visibleNodes.length !== expectedCount) row.errors.push('Component match count differs from the accepted plan.');
              const node = nodes[target.match_index ?? 0];
              if (!node || !node.checkVisibility({ checkVisibilityCSS: true }) || assigned.has(node)) {
                row.errors.push('Target is missing, hidden, or assigned more than once.');
                continue;
              }
              assigned.add(node);
              ordered.push({ node, order: target.source_order, row });
              if (!node.textContent.trim() && !node.querySelector('img,video,svg,canvas,iframe,input,button')) row.errors.push('Component has no rendered content.');
              if (target.delivery === 'experience-fragment' && !node.closest('.experiencefragment,.cmp-experiencefragment,[data-cmp-is="experiencefragment"]')) row.errors.push('Site chrome is not rendered through an Experience Fragment.');
              for (const link of node.querySelectorAll('a')) {
                if (link.checkVisibility() && !link.getAttribute('href')?.trim()) row.errors.push('A visible link has no destination.');
              }
              for (const control of node.querySelectorAll('[aria-controls]')) {
                if (control.getAttribute('aria-controls').split(/\s+/).some(identity => !document.getElementById(identity))) row.errors.push('ARIA controls reference missing elements.');
              }
              if ([...node.querySelectorAll('[aria-expanded]')].some(control => !['true', 'false'].includes(control.getAttribute('aria-expanded')))) row.errors.push('Invalid initial ARIA expanded state.');
              row.tag = node.tagName.toLowerCase();
            }
            ordered.sort((first, second) => first.order - second.order);
            for (let index = 1; index < ordered.length; index += 1) {
              const previous = ordered[index - 1];
              const current = ordered[index];
              if (previous.order < current.order && !(previous.node.compareDocumentPosition(current.node) & Node.DOCUMENT_POSITION_FOLLOWING)) current.row.errors.push('Component source order is incorrect.');
            }
            const clientlibs = [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => ({ url: link.href, loaded: Boolean(link.sheet) }));
            const styles = getComputedStyle(document.documentElement);
            const tokens = [...styles].filter(name => name.startsWith(tokenPrefix));
            return { rows, clientlibs, tokens, viewport: innerWidth };
          }, { targets, tokenPrefix: input.token_prefix });
          result.components = measured.rows;
          result.clientlibs = measured.clientlibs;
          const normalizedLibrary = value => new URL(value, origin).pathname.replace(/\.lc-[^.]+-lc(?=\.)/g, '').replace(/\.min(?=\.(css|js)$)/, '');
          for (const component of input.components) {
            for (const library of component.clientlibs || []) {
              const expected = new URL(library.path, origin);
              const found = loaded.some(actual => new URL(actual.url).origin === origin && actual.kind === library.kind && normalizedLibrary(actual.url) === normalizedLibrary(expected.href));
              result.clientlibs.push({ component_id: component.id, url: expected.href, kind: library.kind, loaded: found, sources: library.sources });
              if (!found) {
                result.status = 'FAIL';
                fail({ component_id: component.id, owning_layer: 'component', error: `Required clientlib did not load: ${library.path}`, breakpoint: width, mode });
              }
            }
          }
          if (measured.viewport !== width) throw new Error('The browser viewport differs from the requested breakpoint.');
          if (!measured.clientlibs.length || measured.clientlibs.some(library => !library.loaded) || !measured.tokens.length) {
            fail({ component_id: input.components[0].id, owning_layer: 'foundation', error: 'Site stylesheets or shared tokens are not loaded.', breakpoint: width, mode });
            result.status = 'FAIL';
          }
          for (const row of measured.rows) {
            for (const error of row.errors) {
              fail({ component_id: row.component_id, owning_layer: 'component', error, breakpoint: width, mode });
              result.status = 'FAIL';
            }
          }
          if (errors.length) throw new Error(errors.join('; '));
        } catch (error) {
          result.status = 'FAIL';
          fail({ error: error.message, breakpoint: width, mode });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const report = await verifyDeployment(input);
  await writeFile(process.argv[3], JSON.stringify(report, null, 2));
  console.log(`Deployment runtime: ${report.status}`);
}