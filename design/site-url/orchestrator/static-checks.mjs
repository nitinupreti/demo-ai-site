/**
 * Deterministic checks on files an agent wrote, run before Maven. They are exact, take
 * milliseconds and name the file and line, where the pixel gate can only report a region that
 * looks wrong three phases later.
 */
import fs from 'node:fs';
import path from 'node:path';

export const FRONTEND_ROOT = 'ui.frontend/src/main/webpack';
export const TOKENS_FILE = `${FRONTEND_ROOT}/site/_tokens.scss`;
const APPS_ROOT = 'ui.apps/src/main/content/jcr_root/apps';
const DAM_ROOT = 'ui.content/src/main/content/jcr_root/content/dam';
const EXCLUDED = new Set(['node_modules', 'target', 'dist', 'node', '.git']);

const normalize = (value) => String(value).replaceAll('\\', '/');

/** Blanks comments with spaces so offsets and line numbers survive; `//` inside a string or url() is kept. */
export function stripComments(text) {
  const source = String(text);
  let output = '';
  let quote = null;
  let urlDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      output += char;
      if (char === '\\') {
        output += next ?? '';
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }
    if (/url\($/i.test(source.slice(Math.max(0, index - 3), index + 1))) urlDepth += 1;
    if (char === ')' && urlDepth) urlDepth -= 1;
    if (!urlDepth && char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      output += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop - 1;
      continue;
    }
    if (!urlDepth && char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      output += ' '.repeat(stop - index);
      index = stop - 1;
      continue;
    }
    output += char;
  }
  return output;
}

/** Every custom property declaration, with the at-rules and selector it sits in. */
export function extractTokens(scss) {
  const text = stripComments(scss);
  const tokens = [];
  const stack = [];
  let buffer = '';
  let quote = null;
  const flush = () => {
    const match = /^\s*(--[A-Za-z0-9_-]+)\s*:\s*([\s\S]*?)\s*(!default)?\s*$/.exec(buffer);
    if (match && !match[1].includes('#{')) {
      tokens.push({
        name: match[1],
        value: match[2].replace(/\s+/g, ' ').trim(),
        // A breakpoint mixin is as much an override as a media query.
        media: stack.filter((header) => header.startsWith('@')).map((header) => header.replace(/^@media\s*/, '')),
        selector: stack.filter((header) => !header.startsWith('@')).pop() || null,
      });
    }
    buffer = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }
    // Sass interpolation is part of the text around it, never a block.
    if (char === '#' && text[index + 1] === '{') {
      const end = text.indexOf('}', index);
      buffer += text.slice(index, end + 1);
      index = end;
      continue;
    }
    if (char === '{') {
      stack.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
    } else if (char === '}') {
      flush();
      stack.pop();
    } else if (char === ';') {
      flush();
    } else {
      buffer += char;
    }
  }
  return tokens;
}

/** The vocabulary a component may consume: one entry per token, breakpoint overrides beside it. */
export function tokenManifest(scss, { source = TOKENS_FILE } = {}) {
  const tokens = {};
  for (const token of extractTokens(scss)) {
    const entry = tokens[token.name] || (tokens[token.name] = { value: null, overrides: [] });
    if (!token.media.length && entry.value === null) entry.value = token.value;
    else entry.overrides.push({ media: token.media.join(' and '), selector: token.selector, value: token.value });
  }
  return { source, count: Object.keys(tokens).length, tokens };
}

export function readTokenManifest(repoRoot, file = TOKENS_FILE) {
  const absolute = path.join(repoRoot, file);
  if (!fs.existsSync(absolute)) return { source: file, count: 0, tokens: {}, missing: true };
  return tokenManifest(fs.readFileSync(absolute, 'utf8'), { source: file });
}

/** Names declared as `--x:` anywhere, or passed around as a string (setProperty, a Java style map). */
export function declaredProperties(text) {
  const names = new Set();
  for (const match of String(text).matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) names.add(match[1]);
  for (const match of String(text).matchAll(/["'`](--[A-Za-z0-9_-]+)["'`]/g)) names.add(match[1]);
  return names;
}

function lineOf(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

/** Every `var(--x)` with whether it carries a fallback, which keeps it valid when `--x` is unset. */
export function varReferences(text) {
  const source = stripComments(text);
  const references = [];
  for (const match of source.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])?/g)) {
    if (/#\{/.test(source.slice(match.index, match.index + match[0].length + 2))) continue;
    references.push({ name: match[1], fallback: match[2] === ',', line: lineOf(source, match.index) });
  }
  return references;
}

function walkFiles(root, relative, test, out = []) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return out;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkFiles(root, child, test, out);
    else if (test(child)) out.push(child);
  }
  return out;
}

/**
 * What a component may reference: the frontend's tokens and base styles, every clientlib's CSS,
 * and whatever its own files declare. A `var()` outside this set is invalid at computed-value
 * time, so the whole declaration silently falls back — padding collapses to zero, colour to inherit.
 */
export function declaredVocabulary(root, ownFiles = []) {
  const names = new Set();
  const files = [
    ...walkFiles(root, FRONTEND_ROOT, (file) => /\.(s?css)$/.test(file)),
    ...walkFiles(root, APPS_ROOT, (file) => /\/clientlibs\/.+\.css$/.test(file)),
    ...ownFiles,
  ];
  for (const file of new Set(files.map(normalize))) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) continue;
    for (const name of declaredProperties(fs.readFileSync(absolute, 'utf8'))) names.add(name);
  }
  return names;
}

const REFERENCING = /\.(s?css|html|js|java)$/i;

/** References without a fallback to a property nothing declares, file and line each. */
export function undeclaredVars({ root, files, declared }) {
  const problems = [];
  for (const file of files.map(normalize).filter((entry) => REFERENCING.test(entry))) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    for (const reference of varReferences(fs.readFileSync(absolute, 'utf8'))) {
      if (reference.fallback || declared.has(reference.name)) continue;
      problems.push({ file, line: reference.line, name: reference.name });
    }
  }
  return problems;
}

const IGNORED_URL = /^(data:|https?:|\/\/|#|about:|blob:|var\()/i;

export function cssUrls(text) {
  const source = stripComments(text);
  const urls = [];
  for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!url || IGNORED_URL.test(url) || url.includes('#{') || url.includes('$')) continue;
    urls.push({ url: url.split(/[?#]/)[0], line: lineOf(source, match.index) });
  }
  return urls;
}

/** Where a clientlib path lives in the source tree; clientlib-site resources are built from the frontend. */
function sourceOfClientlibPath(clientlibPath) {
  const [app, lib, ...rest] = clientlibPath.split('/');
  if (lib === 'clientlib-site' && rest[0] === 'resources') {
    return `${FRONTEND_ROOT}/resources/${rest.slice(1).join('/')}`;
  }
  return `${APPS_ROOT}/${app}/clientlibs/${[lib, ...rest].join('/')}`;
}

/**
 * AEM rewrites a clientlib's relative url() against the source CSS file's own folder. Everything
 * the frontend compiles lands in clientlib-site/css/site.css, so its URLs resolve from css/, and a
 * `url("resources/…")` there points at a folder that does not exist: the font or image 404s and the
 * page quietly falls back.
 */
export function unresolvedUrls({ root, damRoot = root, files }) {
  const problems = [];
  const exists = (base, relative) => fs.existsSync(path.join(base, relative));
  for (const file of files.map(normalize)) {
    const isFrontend = file.startsWith(`${FRONTEND_ROOT}/`) && /\.(s?css)$/i.test(file);
    const clientlib = /^ui\.apps\/src\/main\/content\/jcr_root\/apps\/([^/]+)\/clientlibs\/(.+)\.css$/i.exec(file);
    if (!isFrontend && !clientlib) continue;
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;

    for (const { url, line } of cssUrls(fs.readFileSync(absolute, 'utf8'))) {
      let resolved = null;
      let found = false;
      if (url.startsWith('/content/dam/')) {
        resolved = `${DAM_ROOT}/${url.slice('/content/dam/'.length)}`;
        found = exists(damRoot, resolved);
      } else if (url.startsWith('/etc.clientlibs/')) {
        resolved = sourceOfClientlibPath(url.slice('/etc.clientlibs/'.length).replace(/^([^/]+)\/clientlibs\//, '$1/'));
        found = exists(root, resolved);
      } else if (url.startsWith('/')) {
        continue;
      } else if (isFrontend) {
        const served = path.posix.normalize(`clientlib-site/css/${url}`);
        if (served.startsWith('clientlib-site/resources/')) {
          resolved = `${FRONTEND_ROOT}/resources/${served.slice('clientlib-site/resources/'.length)}`;
          found = exists(root, resolved);
        } else {
          resolved = served;
        }
      } else {
        resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), url));
        found = exists(root, resolved);
      }
      if (found) continue;

      let hint = '';
      const bare = url.replace(/^(\.\/)+/, '').replace(/^resources\//, '');
      if (isFrontend && exists(root, `${FRONTEND_ROOT}/resources/${bare}`)) {
        hint = ` Compiled CSS is served from clientlib-site/css/, so write url("../resources/${bare}").`;
      }
      problems.push({
        file, line, url, resolved, message: `${file}:${line} url("${url}") resolves to ${resolved}, which does not exist.${hint}`,
      });
    }
  }
  return problems;
}

/** Both checks over one change set, as rejection text for the agent that wrote it; null when clean. */
export function staticRejection({ root, damRoot = root, changedFiles, ownedFiles = [] }) {
  const lines = [];
  const undeclared = undeclaredVars({ root, files: changedFiles, declared: declaredVocabulary(root, ownedFiles) });
  if (undeclared.length) {
    lines.push('These `var()` references name custom properties nothing declares, so each declaration is invalid'
      + ' and silently falls back (padding to 0, colour to inherit):');
    for (const problem of undeclared.slice(0, 15)) lines.push(`- ${problem.file}:${problem.line} ${problem.name}`);
    if (undeclared.length > 15) lines.push(`- … and ${undeclared.length - 15} more`);
    lines.push('Use a name from your tokens.json, declare the property in your own CSS, or give var() a fallback.');
  }
  const urls = unresolvedUrls({ root, damRoot, files: changedFiles });
  if (urls.length) {
    if (lines.length) lines.push('');
    lines.push('These url() references point at nothing that will be deployed:');
    for (const problem of urls.slice(0, 15)) lines.push(`- ${problem.message}`);
  }
  return lines.length ? { text: lines.join('\n'), undeclared, urls } : null;
}

/** Every file under the frontend source, for checks that must cover the whole shared layer. */
export function frontendFiles(root) {
  return walkFiles(root, FRONTEND_ROOT, (file) => /\.(s?css)$/.test(file));
}
