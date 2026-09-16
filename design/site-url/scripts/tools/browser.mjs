import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const modulePath = fileURLToPath(import.meta.url);
const toolsDirectory = path.dirname(modulePath);
const isCommand = process.argv[1] && path.resolve(process.argv[1]) === modulePath;
const options = isCommand ? parseArgs({
  options: {
    install: { type: 'boolean', default: false },
    'browsers-path': { type: 'string' },
  },
}).values : {};
const configuredCache = options['browsers-path'] || process.env.PLAYWRIGHT_BROWSERS_PATH;
if (configuredCache === '0') throw new Error('Use a persistent shared PLAYWRIGHT_BROWSERS_PATH, not 0.');
const cacheDirectory = path.resolve(configuredCache || path.join(toolsDirectory, '../.tools/ms-playwright'));
process.env.PLAYWRIGHT_BROWSERS_PATH = cacheDirectory;

const require = createRequire(import.meta.url);
const expectedVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).dependencies.playwright;
const installedVersion = require('playwright/package.json').version;
const coreVersion = require('playwright-core/package.json').version;
if (installedVersion !== expectedVersion || coreVersion !== expectedVersion) {
  throw new Error('Playwright differs from the pinned version. Run npm ci --prefix design/site-url/scripts/tools --ignore-scripts.');
}
const browserDefinitions = JSON.parse(readFileSync(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json')));
const chromiumRevision = browserDefinitions.browsers.find(browser => browser.name === 'chromium-headless-shell').revision;

export const { chromium } = await import('playwright');

function reportProgress(stage) {
  if (isCommand) console.error(`Browser preflight: ${stage}`);
}

export async function checkBrowser() {
  const started = performance.now();
  reportProgress('launching Chromium');
  const browser = await chromium.launch({ headless: true, timeout: 0 });
  try {
    reportProgress('creating page');
    const page = await browser.newPage({ viewport: { width: 375, height: 200 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(0);
    page.setDefaultNavigationTimeout(0);
    reportProgress('rendering and checking viewport');
    await page.setContent('<title>Browser preflight</title><p id="ready">ready</p>', { timeout: 0 });
    if (await page.locator('#ready').textContent() !== 'ready' || await page.evaluate(() => innerWidth) !== 375) {
      throw new Error('Browser preflight did not render at the requested viewport.');
    }
    return {
      status: 'READY',
      playwright_version: installedVersion,
      chromium_revision: chromiumRevision,
      browser_version: browser.version(),
      browsers_path: cacheDirectory,
      module_uri: import.meta.url,
      elapsed_ms: Math.round(performance.now() - started),
    };
  } finally {
    reportProgress('closing Chromium');
    await browser.close();
  }
}

async function main() {
  try {
    return await checkBrowser();
  } catch (error) {
    const marker = path.join(cacheDirectory, `chromium_headless_shell-${chromiumRevision}`, 'INSTALLATION_COMPLETE');
    const incomplete = error.message.includes('spawn EFTYPE') && !existsSync(marker);
    if (!options.install || (!error.message.includes("Executable doesn't exist") && !incomplete)) throw error;
  }
  if (existsSync(path.join(cacheDirectory, '__dirlock'))) {
    throw new Error('Browser installer lock exists. Check the other installer before retrying; the lock was not deleted.');
  }
  console.error(`Installing pinned Chromium headless shell ${chromiumRevision} once into ${cacheDirectory}`);
  const installer = spawnSync(process.execPath, [
    path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'),
    'install', 'chromium', '--only-shell',
  ], {
    env: {
      ...process.env,
      PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '30000',
      PLAYWRIGHT_SKIP_BROWSER_GC: '1',
    },
    stdio: 'inherit',
    timeout: 300000,
    shell: false,
  });
  if (installer.error || installer.status !== 0) {
    throw new Error(`Browser installation failed: ${installer.error?.message || installer.status}. Check network/proxy access and installer processes before retrying.`);
  }
  return checkBrowser();
}

if (isCommand) {
  try {
    console.log(JSON.stringify(await main()));
  } catch (error) {
    console.error(error.message);
    console.error(`Explicit setup: node ${JSON.stringify(modulePath)} --install --browsers-path ${JSON.stringify(cacheDirectory)}`);
    console.log(JSON.stringify({ status: 'FAIL', error: error.message }));
    process.exitCode = 1;
  }
}