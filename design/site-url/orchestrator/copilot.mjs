/** Locates the installed GitHub Copilot CLI. Shared by the launcher and the orchestrator. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
    const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (probe.status === 0) {
      return { executable, version: (probe.stdout || '').trim() || 'GitHub Copilot CLI' };
    }
  }
  throw new Error('GitHub Copilot CLI was not found. Run `npm install -g @github/copilot` and `copilot login`, then retry.');
}
