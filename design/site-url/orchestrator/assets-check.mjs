/** Asset acquisition assertions. A stub fetch keeps the check offline and deterministic. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { acquireAssets, assetNameFor, collectAssetUrls } from './assets.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-check-'));
const repoRoot = path.join(sandbox, 'repo');
const damPath = '/content/dam/demo/us/en/page';
const damRoot = `ui.content/src/main/content/jcr_root${damPath}`;

const discovery = {
  source: { final_url: 'https://example.com/customers/cursor' },
  instances: [
    {
      id: 'inst-001',
      media: {
        375: [
          { tag: 'svg', visible: true },
          { tag: 'img', src: '/logo.svg', alt: 'Logo', intrinsic: { width: 800, height: 195 } },
        ],
        1440: [
          // The same file behind a resizer proxy must collapse onto one asset.
          { tag: 'img', src: 'https://cdn.test/_next/image?url=https%3A%2F%2Fimages.test%2Fhero.jpg&w=1080', alt: 'Hero' },
        ],
      },
    },
    {
      id: 'inst-002',
      media: { 1440: [{ tag: 'img', src: 'https://images.test/hero.jpg', alt: 'Hero' }] },
    },
    {
      id: 'inst-003',
      media: {
        1440: [
          { tag: 'video', src: 'https://videos.test/clip.mp4', poster: 'https://images.test/poster.png', intrinsic: { width: 1920, height: 1080 } },
          { tag: 'source', src: 'https://videos.test/clip.webm', type: 'video/webm' },
        ],
      },
    },
  ],
};

const collected = collectAssetUrls(discovery);
expect(collected.length === 5, `images, video, source and poster should all be collected, got ${collected.length}`);
expect(collected[0].url === 'https://example.com/logo.svg', `relative src must resolve against the source, got ${collected[0].url}`);
const hero = collected.find((entry) => entry.url === 'https://images.test/hero.jpg');
expect(Boolean(hero), 'the proxied URL must be unwrapped to the original file');
expect(hero.instances.join(',') === 'inst-001,inst-002', `both instances should claim the shared asset, got ${hero?.instances}`);
expect(collected.find((entry) => entry.url.endsWith('poster.png'))?.intrinsic === null,
  'a poster must not inherit the video dimensions');

expect(assetNameFor('https://images.test/Hero Shot.JPG', 'image/jpeg', new Set()) === 'hero-shot.jpg',
  'asset names must be slugged and extension-corrected');
const taken = new Set(['hero.jpg']);
expect(assetNameFor('https://images.test/hero.jpg', 'image/jpeg', taken).startsWith('hero-'),
  'a name collision must be disambiguated, not overwritten');

const bodies = {
  'https://example.com/logo.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  'https://images.test/hero.jpg': { type: 'image/jpeg', body: 'jpeg-bytes' },
  'https://images.test/poster.png': { type: 'image/png', body: 'png-bytes' },
  'https://videos.test/clip.mp4': { type: 'video/mp4', body: 'mp4-bytes' },
  'https://videos.test/clip.webm': { type: 'video/webm', body: 'webm-bytes' },
};
const stubFetch = async (url) => {
  const entry = bodies[url];
  if (!entry) return { ok: false, status: 404, headers: { get: () => null } };
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? `${entry.type}; charset=utf-8` : null) },
    arrayBuffer: async () => new TextEncoder().encode(entry.body).buffer,
  };
};

const acquired = await acquireAssets({ repoRoot, discovery, damRoot, damPath, fetchFn: stubFetch });
expect(acquired.status === 'PASS', `clean acquisition should pass: ${JSON.stringify(acquired.failures)}`);
expect(acquired.manifest.length === 5, `manifest should list every acquired file, got ${acquired.manifest.length}`);

const clip = acquired.manifest.find((entry) => entry.dam_path.endsWith('clip.mp4'));
expect(clip?.mime === 'video/mp4', `video must be acquired with its own MIME type, got ${clip?.mime}`);
const clipXml = fs.readFileSync(path.join(repoRoot, damRoot, 'clip.mp4', '.content.xml'), 'utf8');
expect(clipXml.includes('dam:MIMEtype="video/mp4"'), 'the video asset must record its MIME type');
expect(!clipXml.includes('tiff:'), 'tiff image metadata must not be written onto a video asset');

const logo = acquired.manifest.find((entry) => entry.dam_path.endsWith('logo.svg'));
expect(logo.dam_path === `${damPath}/logo.svg`, `manifest must carry the authored DAM path, got ${logo?.dam_path}`);
expect(logo.width === 800 && logo.height === 195, 'intrinsic dimensions from the evidence must reach the manifest');

const assetXml = fs.readFileSync(path.join(repoRoot, damRoot, 'logo.svg', '.content.xml'), 'utf8');
expect(assetXml.includes('jcr:primaryType="dam:Asset"'), 'the asset node must be a dam:Asset');
expect(assetXml.includes('dam:MIMEtype="image/svg+xml"'), 'the MIME type must be recorded');
expect(assetXml.includes('tiff:ImageWidth="{Long}800"'), 'known dimensions must be serialized');
expect(fs.existsSync(path.join(repoRoot, damRoot, 'logo.svg', '_jcr_content', 'renditions', 'original')),
  'the original rendition binary must be written');
expect(fs.readFileSync(path.join(repoRoot, damRoot, 'logo.svg', '_jcr_content', 'renditions', 'original.dir', '.content.xml'), 'utf8')
  .includes('jcr:mimeType="image/svg+xml"'), 'the rendition must declare its MIME type');

// Re-running against a different source must not leave the previous site's assets behind.
const secondDiscovery = {
  source: { final_url: 'https://other.com/page' },
  instances: [{ id: 'inst-001', media: { 1440: [{ tag: 'img', src: 'https://images.test/hero.jpg', alt: 'Hero' }] } }],
};
const rerun = await acquireAssets({ repoRoot, discovery: secondDiscovery, damRoot, damPath, fetchFn: stubFetch });
expect(rerun.status === 'PASS', 'the second acquisition should pass');
expect(!fs.existsSync(path.join(repoRoot, damRoot, 'logo.svg')),
  'assets from the previous source URL must be removed, not merged');
expect(fs.existsSync(path.join(repoRoot, damRoot, 'hero.jpg')), 'the new source assets must be present');

// An unreachable asset fails the run rather than producing a page with a broken reference.
const broken = await acquireAssets({
  repoRoot,
  damRoot,
  damPath,
  discovery: { source: { final_url: 'https://x.test/' }, instances: [{ id: 'inst-001', media: { 1440: [{ tag: 'img', src: 'https://images.test/missing.png' }] } }] },
  fetchFn: stubFetch,
});
expect(broken.status === 'FAIL' && broken.failures[0].reason === 'HTTP 404',
  `an unfetchable asset must fail the phase, got ${JSON.stringify(broken)}`);

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  console.error(`asset acquisition assertions failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('asset acquisition assertions: all passed');
