#!/usr/bin/env node
/**
 * Makes the migration tools runnable on a machine that has never run them: installs the GitHub
 * Copilot CLI and SDK globally when they are missing, installs the pinned npm dependencies, then
 * makes sure Playwright has a browser it can launch.
 *
 *   node design/site-url/tools/setup.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findCopilot, findCopilotSdk } from '../orchestrator/copilot.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const DEPENDENCIES = ['playwright', 'pixelmatch', 'pngjs'];
// Global, because that is where the launcher and the orchestrator look for them.
const COPILOT_PACKAGES = { '@github/copilot': findCopilot, '@github/copilot-sdk': findCopilotSdk };
// Playwright's own Chromium build, for machines without the system Chrome the tools default to.
const BUNDLED_CHANNEL = 'chromium';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function runCommand(command, args, { cwd }) {
  // npm is a .cmd shim on Windows that only a shell can start; its arguments here are fixed words.
  const result = process.platform === 'win32' && command === 'npm'
    ? spawnSync([command, ...args].join(' '), { cwd, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  return result.status ?? 1;
}

async function launchFailure(dir) {
  const { launchBrowser } = await import(pathToFileURL(path.join(dir, 'lib', 'browser.mjs')).href);
  try {
    const browser = await launchBrowser();
    await browser.close();
    return null;
  } catch (error) {
    return String(error?.message || error).split('\n')[0];
  }
}

function missingCopilotPackages() {
  return Object.entries(COPILOT_PACKAGES).filter(([, find]) => {
    try {
      find();
      return false;
    } catch {
      return true;
    }
  }).map(([name]) => name);
}

export function ensureCopilot({ log = console.log, run = runCommand, missing = missingCopilotPackages } = {}) {
  const absent = missing();
  if (!absent.length) return 'present';
  log(`installing ${absent.join(', ')} globally`);
  if (run('npm', ['install', '--global', '--no-fund', '--no-audit', ...absent], { cwd: toolsDir }) !== 0) {
    throw new Error(`npm could not install ${absent.join(', ')} globally; check the npm registry and proxy settings`
      + ' and write access to the global npm prefix, then retry');
  }
  const unresolved = missing();
  if (unresolved.length) {
    throw new Error(`${unresolved.join(', ')} installed globally but still cannot be found or started; set`
      + ' COPILOT_BIN to the copilot executable and COPILOT_SDK_PATH to the SDK directory, then retry');
  }
  return 'installed';
}

export async function ensureTools({
  dir = toolsDir, log = console.log, run = runCommand, launch = () => launchFailure(dir),
} = {}) {
  const lock = readJson(path.join(dir, 'package-lock.json'));
  const stale = DEPENDENCIES.filter((name) => {
    const installed = readJson(path.join(dir, 'node_modules', name, 'package.json'))?.version;
    const locked = lock?.packages?.[`node_modules/${name}`]?.version;
    return !installed || (locked && installed !== locked);
  });
  if (stale.length) {
    log(`installing capture tool dependencies: ${stale.join(', ')}`);
    if (run('npm', [lock ? 'ci' : 'install', '--no-fund', '--no-audit'], { cwd: dir }) !== 0) {
      throw new Error(`npm could not install the dependencies in ${dir}; check the npm registry and proxy settings, then retry`);
    }
  }
  const dependencies = stale.length ? 'installed' : 'present';
  const ready = () => `${dependencies}, browser ${(process.env.PLAYWRIGHT_CHANNEL ?? 'chrome') || 'headless shell'}`;

  const explicit = process.env.PLAYWRIGHT_CHANNEL;
  let failure = await launch();
  if (!failure) return ready();
  if (explicit && explicit !== BUNDLED_CHANNEL) {
    throw new Error(`PLAYWRIGHT_CHANNEL=${explicit} cannot be launched: ${failure}`);
  }
  // Set in this process's environment, so the discovery and parity tools spawned later inherit it.
  if (explicit === undefined) {
    process.env.PLAYWRIGHT_CHANNEL = BUNDLED_CHANNEL;
    failure = await launch();
  }
  if (failure) {
    log('downloading Playwright Chromium (one time)');
    const cli = path.join(dir, 'node_modules', 'playwright', 'cli.js');
    if (run(process.execPath, [cli, 'install', 'chromium'], { cwd: dir }) !== 0) {
      throw new Error('Playwright could not download Chromium. Install Google Chrome, or allow the download'
        + ' (behind a TLS-inspecting proxy, point NODE_EXTRA_CA_CERTS at its CA certificate), then retry');
    }
    failure = await launch();
    if (failure) throw new Error(`Playwright Chromium is installed but will not start: ${failure}`);
  }
  return ready();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    console.log(`copilot cli and sdk: ${ensureCopilot()}`);
    console.log(`capture tools ready: ${await ensureTools()}`);
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
