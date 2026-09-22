/**
 * Deterministic asset acquisition. Every image the frozen evidence recorded is downloaded,
 * verified and written as a `dam:Asset`, so the authored page references real DAM paths
 * instead of the source CDN. No model is involved.
 *
 * The DAM root is cleared before writing: when the source URL changes, the previous site's
 * binaries must not survive into the new run.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { escapeJcrValue } from './jcr-xml.mjs';

// Output must be byte-stable across runs, so serialized timestamps cannot come from the clock.
const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
};

// `iframe` is an embed, not a file we can fetch; everything else carries a downloadable source.
const MEDIA_TAGS = new Set(['img', 'video', 'source']);

/** CDN resizers wrap the real file in a `url` parameter; the original is what belongs in the DAM. */
function unwrapProxy(rawUrl, depth = 0) {
  try {
    const parsed = new URL(rawUrl);
    const inner = parsed.searchParams.get('url');
    if (depth >= 3 || !inner) return parsed.toString();
    // The wrapped value is often site-relative, so resolve it against the proxy itself.
    const resolved = new URL(inner, parsed).toString();
    return resolved === parsed.toString() ? resolved : unwrapProxy(resolved, depth + 1);
  } catch {
    return null;
  }
}

export function collectAssetUrls(discovery) {
  const base = discovery.source?.final_url;
  const byUrl = new Map();

  const add = (raw, instanceId, { alt = '', intrinsic = null } = {}) => {
    if (!raw) return;
    let absolute;
    try {
      absolute = new URL(raw, base).toString();
    } catch {
      return;
    }
    const url = unwrapProxy(absolute);
    if (!url) return;

    if (!byUrl.has(url)) byUrl.set(url, { url, alt: '', intrinsic: null, instances: [] });
    const record = byUrl.get(url);
    if (!record.instances.includes(instanceId)) record.instances.push(instanceId);
    if (!record.intrinsic && intrinsic?.width) record.intrinsic = intrinsic;
    if (!record.alt && alt) record.alt = alt;
  };

  for (const instance of discovery.instances || []) {
    for (const entries of Object.values(instance.media || {})) {
      for (const entry of entries || []) {
        if (!MEDIA_TAGS.has(entry.tag)) continue;
        add(entry.src, instance.id, { alt: entry.alt, intrinsic: entry.intrinsic });
        // A poster is a still image of its own, with none of the video's metadata.
        add(entry.poster, instance.id);
      }
    }
  }

  return [...byUrl.values()];
}

export function assetNameFor(url, mime, taken = new Set()) {
  let last = 'asset';
  try {
    last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'asset');
  } catch { /* keep the fallback */ }

  const fromName = last.includes('.') ? last.split('.').pop().toLowerCase() : '';
  const extension = EXTENSION_BY_MIME[mime] || (/^[a-z0-9]{2,5}$/.test(fromName) ? fromName : 'bin');
  const stem = last.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';

  let candidate = `${stem}.${extension}`;
  if (taken.has(candidate)) {
    candidate = `${stem}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)}.${extension}`;
  }
  taken.add(candidate);
  return candidate;
}

function assetXml({ mime, sha1, size, title, width, height }) {
  // tiff:* describes a raster image; it has no meaning on a video asset.
  const dimensions = mime.startsWith('image/') && Number.isFinite(width) && Number.isFinite(height)
    ? `\n            tiff:ImageLength="{Long}${Math.round(height)}"\n            tiff:ImageWidth="{Long}${Math.round(width)}"`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:dam="http://www.day.com/dam/1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="dam:Asset">
    <jcr:content
        jcr:primaryType="dam:AssetContent"
        jcr:lastModified="{Date}${FIXED_TIMESTAMP}"
        jcr:lastModifiedBy="admin">
        <metadata
            jcr:primaryType="nt:unstructured"
            jcr:mixinTypes="[cq:Taggable]"
            dam:MIMEtype="${mime}"
            dam:sha1="${sha1}"
            dam:size="{Long}${size}"
            dc:format="${mime}"
            dc:title="${escapeJcrValue(title)}"${dimensions}/>
        <related jcr:primaryType="nt:unstructured"/>
    </jcr:content>
</jcr:root>
`;
}

function renditionXml(mime) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="nt:file">
    <jcr:content
        jcr:primaryType="nt:resource"
        jcr:mimeType="${mime}"
        jcr:lastModified="{Date}${FIXED_TIMESTAMP}"/>
</jcr:root>
`;
}

export function writeAsset({ assetsDir, name, bytes, mime, title, width, height }) {
  const assetDir = path.join(assetsDir, name);
  const renditions = path.join(assetDir, '_jcr_content', 'renditions');
  fs.mkdirSync(path.join(renditions, 'original.dir'), { recursive: true });

  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
  const contentPath = path.join(assetDir, '.content.xml');
  const originalPath = path.join(renditions, 'original');
  const rendititionPath = path.join(renditions, 'original.dir', '.content.xml');

  fs.writeFileSync(contentPath, assetXml({ mime, sha1, size: bytes.length, title, width, height }), 'utf8');
  fs.writeFileSync(originalPath, bytes);
  fs.writeFileSync(rendititionPath, renditionXml(mime), 'utf8');

  return { sha1, written: [contentPath, originalPath, rendititionPath] };
}

function mimeFor(response, url) {
  const header = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (header.startsWith('image/') || header.startsWith('video/')) return header;
  const extension = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  return Object.entries(EXTENSION_BY_MIME).find(([, value]) => value === extension)?.[0] || null;
}

/**
 * FileVault refuses to package a node no filter root covers, so the DAM folder this run writes
 * must be declared. The path is computed, never authored, so the filter entry is too.
 * Inserted before any ancestor root, which may carry excludes that would otherwise win.
 */
export function ensureFilterRoot({ repoRoot, filterPath, damPath }) {
  const absolute = path.join(repoRoot, filterPath);
  if (!fs.existsSync(absolute)) return null;
  const contents = fs.readFileSync(absolute, 'utf8');
  if (contents.includes(`<filter root="${damPath}"`)) return null;

  const entry = `    <filter root="${damPath}"/>`;
  const eol = contents.includes('\r\n') ? '\r\n' : '\n';
  const lines = contents.split(/\r?\n/);
  const ancestor = lines.findIndex((line) => {
    const match = line.match(/<filter\s+root="([^"]+)"/);
    return match && damPath.startsWith(`${match[1]}/`);
  });
  const at = ancestor >= 0 ? ancestor : lines.findIndex((line) => line.includes('</workspaceFilter>'));
  if (at < 0) return null;

  lines.splice(at, 0, entry);
  fs.writeFileSync(absolute, lines.join(eol), 'utf8');
  return filterPath;
}

/**
 * Downloads every discovered image into `damRoot`, replacing whatever was there before.
 * Returns a manifest mapping each source URL to the DAM path workers must author.
 */
export async function acquireAssets({
  repoRoot, discovery, damRoot, damPath, fetchFn = fetch,
}) {
  const requested = collectAssetUrls(discovery);
  const assetsDir = path.join(repoRoot, damRoot);
  const failures = [];
  const manifest = [];
  const written = [];
  const taken = new Set();

  // A previous source URL must not leave orphans behind.
  fs.rmSync(assetsDir, { recursive: true, force: true });
  if (!requested.length) return { status: 'PASS', manifest, written, failures };
  fs.mkdirSync(assetsDir, { recursive: true });

  for (const record of requested) {
    try {
      const response = await fetchFn(record.url, { redirect: 'follow' });
      if (!response.ok) {
        failures.push({ url: record.url, reason: `HTTP ${response.status}` });
        continue;
      }
      const mime = mimeFor(response, record.url);
      if (!mime) {
        failures.push({ url: record.url, reason: 'response is neither an image nor a video' });
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) {
        failures.push({ url: record.url, reason: 'empty response body' });
        continue;
      }

      const name = assetNameFor(record.url, mime, taken);
      const { sha1, written: files } = writeAsset({
        assetsDir,
        name,
        bytes,
        mime,
        title: record.alt || name,
        width: record.intrinsic?.width,
        height: record.intrinsic?.height,
      });

      written.push(...files.map((file) => path.relative(repoRoot, file).replaceAll('\\', '/')));
      manifest.push({
        source_url: record.url,
        dam_path: `${damPath}/${name}`,
        mime,
        sha1,
        bytes: bytes.length,
        alt: record.alt,
        width: record.intrinsic?.width ?? null,
        height: record.intrinsic?.height ?? null,
        instances: record.instances,
      });
    } catch (error) {
      failures.push({ url: record.url, reason: error.message });
    }
  }

  return { status: failures.length ? 'FAIL' : 'PASS', manifest, written, failures };
}
