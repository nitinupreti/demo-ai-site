/** Font acquisition assertions. A stub fetch keeps the check offline and deterministic. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  FONTS_DIR, FONTS_SCSS, MAIN_SCSS, acquireFonts, bestSource, ensureFontsImport, usedFaces,
} from './fonts.mjs';
import { unresolvedUrls } from './static-checks.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-check-'));
const main = path.join(sandbox, MAIN_SCSS);
fs.mkdirSync(path.dirname(main), { recursive: true });
fs.writeFileSync(main, "@import 'tokens';\r\n@import 'base';\r\n", 'utf8');
fs.mkdirSync(path.join(sandbox, FONTS_DIR), { recursive: true });
fs.writeFileSync(path.join(sandbox, FONTS_DIR, 'hand-picked.woff2'), 'kept');
fs.writeFileSync(path.join(sandbox, FONTS_DIR, 'src-stale-400-normal-00000000.woff2'), 'stale');

const discovery = {
  fonts: {
    faces: [
      {
        family: 'Brand Sans',
        weight: '100 1000',
        style: 'normal',
        unicode_range: 'U+0000-00FF',
        display: 'swap',
        loaded: true,
        src: [
          { url: 'https://fonts.test/brand.ttf', format: 'truetype' },
          { url: 'https://fonts.test/brand.woff2', format: 'woff2' },
        ],
      },
      // One file serving two declared faces is downloaded once.
      { family: 'Brand Sans', weight: '700', style: 'italic', loaded: true, src: [{ url: 'https://fonts.test/brand.woff2', format: 'woff2' }] },
      { family: 'Unused Serif', weight: '400', style: 'normal', loaded: false, src: [{ url: 'https://fonts.test/serif.woff2', format: 'woff2' }] },
      { family: 'Broken Mono', weight: '400', style: 'normal', loaded: true, src: [{ url: 'https://fonts.test/missing.woff2', format: 'woff2' }] },
    ],
  },
};

expect(usedFaces(discovery).length === 3, 'only faces the source rendered may be acquired');
expect(bestSource(discovery.fonts.faces[0]).format === 'woff2', 'woff2 must be preferred over truetype');

const fetched = [];
const stubFetch = async (url, init) => {
  fetched.push({ url, referer: init?.headers?.referer });
  if (url.endsWith('missing.woff2')) return { ok: false, status: 404 };
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'font/woff2' },
    arrayBuffer: async () => new TextEncoder().encode(`bytes of ${url}`).buffer,
  };
};

const acquired = await acquireFonts({
  repoRoot: sandbox, discovery, fetchFn: stubFetch, referer: 'https://source.test/page',
});
expect(acquired.status === 'PARTIAL' && acquired.failures.length === 1 && acquired.failures[0].reason === 'HTTP 404',
  `an unfetchable face must be reported without stopping the others, got ${JSON.stringify(acquired)}`);
expect(fetched.filter((entry) => entry.url.endsWith('brand.woff2')).length === 1, 'one file must be downloaded once');
expect(fetched.every((entry) => entry.referer === 'https://source.test/page'), 'fonts must be requested with the source as referer');
expect(acquired.faces.length === 2 && acquired.families.join(',') === 'Brand Sans', `two faces must be declared, got ${JSON.stringify(acquired.faces)}`);

const files = fs.readdirSync(path.join(sandbox, FONTS_DIR));
expect(files.includes('hand-picked.woff2'), 'a font this module did not write must be left alone');
expect(!files.includes('src-stale-400-normal-00000000.woff2'), 'a previous run\'s generated font must be removed');

const scss = fs.readFileSync(path.join(sandbox, FONTS_SCSS), 'utf8');
expect(scss.includes('font-family: "Brand Sans";') && scss.includes('font-weight: 100 1000;')
  && scss.includes('unicode-range: U+0000-00FF;') && scss.includes('font-display: swap;') && scss.includes('font-style: italic;'),
`the generated rules must carry every descriptor, got\n${scss}`);
expect(/src: url\("\.\.\/resources\/fonts\/src-brand-sans-[^"]+\.woff2"\) format\("woff2"\);/.test(scss),
  'the generated url must be relative to clientlib-site/css/');
expect(unresolvedUrls({ root: sandbox, files: [FONTS_SCSS] }).length === 0,
  'every generated url must resolve to a shipped file');

const mainText = fs.readFileSync(main, 'utf8');
expect(mainText === "@import 'tokens';\r\n@import 'fonts';\r\n@import 'base';\r\n",
  `the fonts import must follow the tokens and keep the file's line endings, got ${JSON.stringify(mainText)}`);
expect(ensureFontsImport(sandbox) === false, 'the import must be added once');

// A source that used no web font declares nothing, but the partial main.scss imports must remain.
const none = await acquireFonts({ repoRoot: sandbox, discovery: { fonts: { faces: [] } }, fetchFn: stubFetch });
const emptyScss = fs.readFileSync(path.join(sandbox, FONTS_SCSS), 'utf8');
expect(none.status === 'SKIPPED' && !emptyScss.includes('@font-face {'),
  'no used face must leave an empty partial, never a dangling import');
expect(!fs.readdirSync(path.join(sandbox, FONTS_DIR)).some((name) => name.startsWith('src-')),
  'no used face must leave no generated font file');

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('font acquisition assertions: all passed');
}
