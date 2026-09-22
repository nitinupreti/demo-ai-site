import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

export function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
  return filePath;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function parseArgs(argv, spec) {
  const options = { ...spec.defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const name = argument.slice(2);
    if (spec.flags?.includes(name)) {
      options[name] = true;
      continue;
    }
    if (!spec.values?.includes(name)) throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    options[name] = value;
    index += 1;
  }
  return options;
}

export function parseBreakpoints(value) {
  const widths = String(value)
    .split(',')
    .map((entry) => Number.parseInt(entry.trim(), 10));
  if (!widths.length || widths.some((width) => !Number.isInteger(width) || width < 240)) {
    throw new Error('Breakpoints must be comma-separated integers of at least 240.');
  }
  return widths;
}

export function toolDependencies(toolRoot) {
  const manifest = readJson(path.join(toolRoot, 'package.json'));
  const versions = {};
  for (const name of Object.keys(manifest.dependencies || {})) {
    try {
      versions[name] = readJson(path.join(toolRoot, 'node_modules', name, 'package.json')).version;
    } catch {
      versions[name] = 'not-installed';
    }
  }
  return versions;
}

export function relativePath(fromDir, filePath) {
  return path.relative(fromDir, filePath).replaceAll('\\', '/');
}

export function round(value, decimals = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
