/** Locates the installed GitHub Copilot CLI. Shared by the launcher and the orchestrator. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function findCopilot() {
  const candidates = [];
  if (process.env.COPILOT_BIN) candidates.push(process.env.COPILOT_BIN);
  if (process.platform === 'win32' && process.env.APPDATA) {
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    candidates.push(path.join(
      process.env.APPDATA, 'npm', 'node_modules', '@github', 'copilot', 'node_modules',
      '@github', `copilot-win32-${architecture}`, 'copilot.exe',
    ));
  }
  candidates.push('copilot');

  for (const executable of candidates) {
    if (executable.includes(path.sep) && !fs.existsSync(executable)) continue;
    // A real path is executed directly; only the bare name needs a shell to resolve the npm shim,
    // and then with no arguments, so nothing a caller supplies can reach a command line.
    const direct = executable.includes(path.sep);
    const probe = direct
      ? spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true })
      : spawnSync(`${executable} --version`, { encoding: 'utf8', shell: true, windowsHide: true });
    if (probe.status === 0) {
      return { executable, version: (probe.stdout || '').trim() || 'GitHub Copilot CLI', direct };
    }
  }
  throw new Error('GitHub Copilot CLI was not found. Run `npm install -g @github/copilot` and `copilot login`, then retry.');
}

/**
 * The SDK now ships as the standalone `@github/copilot-sdk` npm package; the CLI no longer
 * bundles it beside the binary. Resolve its ESM entry from a local or global install.
 */
export function findCopilotSdk() {
  const require = createRequire(import.meta.url);
  const files = [];
  const dirs = [];

  if (process.env.COPILOT_SDK_PATH) {
    const configured = process.env.COPILOT_SDK_PATH;
    if (fs.existsSync(configured) && fs.statSync(configured).isFile()) files.push(configured);
    else dirs.push(configured);
  }
  try {
    dirs.push(path.dirname(require.resolve('@github/copilot-sdk/package.json')));
  } catch { /* not resolvable from here; fall through to the global locations below */ }
  if (process.platform === 'win32' && process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@github', 'copilot-sdk'));
  }

  const entryFor = (candidateDirs) => [...files, ...candidateDirs.map((dir) => path.join(dir, 'dist', 'index.js'))]
    .find((candidate) => fs.existsSync(candidate));

  // The global npm root is only consulted when the cheaper lookups above all miss.
  let sdkPath = entryFor(dirs);
  if (!sdkPath) {
    const globalRoot = spawnSync('npm', ['root', '-g'], {
      encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true,
    });
    if (globalRoot.status === 0 && globalRoot.stdout) {
      sdkPath = entryFor([path.join(globalRoot.stdout.trim(), '@github', 'copilot-sdk')]);
    }
  }
  if (!sdkPath) {
    throw new Error('The Copilot SDK (`@github/copilot-sdk`) was not found. Run'
      + ' `npm install -g @github/copilot-sdk`, or set COPILOT_SDK_PATH to its install'
      + ' directory, then retry.');
  }
  return sdkPath;
}

/**
 * The models this account may actually use, with the reasoning efforts each one advertises.
 * Asked of the SDK that ships with the CLI, so no list is ever hardcoded or guessed at.
 */
export async function listAvailableModels() {
  const { CopilotClient } = await import(pathToFileURL(findCopilotSdk()).href);
  const client = new CopilotClient();
  try {
    await client.start();
    const auth = await client.getAuthStatus();
    if (!auth.isAuthenticated) {
      throw new Error('GitHub Copilot CLI is not authenticated. Run `copilot login`, then retry.');
    }
    const models = await client.listModels();
    return models.filter((model) => model.policy?.state !== 'disabled');
  } finally {
    await client.stop();
  }
}

/** Empty means the model manages its own reasoning and will not accept an --effort flag. */
export function modelEfforts(model) {
  if (!model?.capabilities?.supports?.reasoningEffort) return [];
  return model.supportedReasoningEfforts || [];
}
