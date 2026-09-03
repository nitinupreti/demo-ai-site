// Crop per-block regions from full-page source/target PNGs, then diff.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const bp = '1440';
const dir = __dirname;

const srcFull = PNG.sync.read(fs.readFileSync(path.join(dir, `full-${bp}-source.png`)));
const tgtFull = PNG.sync.read(fs.readFileSync(path.join(dir, `full-${bp}-target.png`)));
const srcScale = srcFull.width / 1440;
const tgtScale = tgtFull.width / 1440;
function savePng(p, png) { fs.writeFileSync(p, PNG.sync.write(png)); }

const rectPairs = {
  'hero':                { source: {x:0, y:139.6, w:1440, h:1216.4}, target: {x:0, y:115.7, w:1440, h:561.6} },
  'service-list':        { source: {x:0, y:1356,  w:1440, h:556},    target: {x:0, y:677.3, w:1440, h:722} },
  'marquee':             { source: {x:0, y:1912,  w:1440, h:244},    target: {x:0, y:1399.3,w:1440, h:160} },
  'featured-case-study': { source: {x:0, y:2156,  w:1440, h:1043},   target: {x:0, y:1559.3,w:1440, h:641.4} },
  'case-study-grid':     { source: {x:0, y:3199,  w:1440, h:570},    target: {x:0, y:2200.6,w:1440, h:1111.7} },
  'partners':            { source: {x:0, y:3769.6,w:1440, h:729.1},  target: {x:0, y:3312.3,w:1440, h:1262} },
  'industries':          { source: {x:0, y:4498.75,w:1440,h:1042},   target: {x:0, y:4574.3,w:1440, h:1300} },
  'insights':            { source: {x:0, y:5540.75,w:1440,h:1069.6}, target: {x:0, y:5874.3,w:1440, h:824} },
  'footer-cta':          { source: {x:0, y:6610.35,w:1440,h:380.8},  target: {x:0, y:6698.3,w:1440, h:404} },
};

function crop(full, r, scale) {
  const x = Math.max(0, Math.round(r.x * scale));
  const y = Math.max(0, Math.round(r.y * scale));
  const w = Math.min(full.width - x, Math.round(r.w * scale));
  const h = Math.min(full.height - y, Math.round(r.h * scale));
  const out = new PNG({ width: w, height: h });
  for (let yy = 0; yy < h; yy++) {
    const src = ((y + yy) * full.width + x) << 2;
    const dst = (yy * w) << 2;
    full.data.copy(out.data, dst, src, src + (w << 2));
  }
  return out;
}

// Top-align and clip both crops to the same height (min of the two), same width (resize width only).
function alignPair(a, b) {
  const h = Math.min(a.height, b.height);
  const w = a.width;
  function topClip(png, targetW, targetH) {
    if (png.width === targetW && png.height === targetH) return png;
    const out = new PNG({ width: targetW, height: targetH });
    if (png.width === targetW) {
      for (let y = 0; y < targetH; y++) {
        const src = (y * png.width) << 2;
        const dst = (y * targetW) << 2;
        png.data.copy(out.data, dst, src, src + (targetW << 2));
      }
      return out;
    }
    // width mismatch: nearest-neighbor resize width only (rare after crop from full-page)
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const sx = Math.min(png.width - 1, Math.floor(x * png.width / targetW));
        const si = (png.width * y + sx) << 2;
        const di = (targetW * y + x) << 2;
        out.data[di]   = png.data[si];
        out.data[di+1] = png.data[si+1];
        out.data[di+2] = png.data[si+2];
        out.data[di+3] = png.data[si+3];
      }
    }
    return out;
  }
  return [topClip(a, w, h), topClip(b, w, h)];
}

// Normalise b onto a's dimensions (a is the reference).
function normaliseTo(a, b) {
  if (a.width === b.width && a.height === b.height) return b;
  const out = new PNG({ width: a.width, height: a.height });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i]=255; out.data[i+1]=255; out.data[i+2]=255; out.data[i+3]=255; }
  // Nearest-neighbor scale
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const sx = Math.min(b.width - 1, Math.floor(x * b.width / a.width));
      const sy = Math.min(b.height - 1, Math.floor(y * b.height / a.height));
      const si = (b.width * sy + sx) << 2;
      const di = (a.width * y + x) << 2;
      out.data[di]   = b.data[si];
      out.data[di+1] = b.data[si+1];
      out.data[di+2] = b.data[si+2];
      out.data[di+3] = b.data[si+3];
    }
  }
  return out;
}

function sideBySide(a, b, label1='LIVE SITE', label2='AEM') {
  const gap = 20;
  const bannerH = 32;
  const out = new PNG({ width: a.width * 2 + gap, height: a.height + bannerH });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i]=245; out.data[i+1]=245; out.data[i+2]=245; out.data[i+3]=255; }
  function blit(src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const si = (src.width * y + x) << 2;
        const di = (out.width * (y + dy) + (x + dx)) << 2;
        out.data[di]   = src.data[si];
        out.data[di+1] = src.data[si+1];
        out.data[di+2] = src.data[si+2];
        out.data[di+3] = src.data[si+3];
      }
    }
  }
  blit(a, 0, bannerH);
  blit(b, a.width + gap, bannerH);
  return out;
}

const summary = [];
for (const [id, spec] of Object.entries(rectPairs)) {
  const srcClipRaw = crop(srcFull, spec.source, srcScale);
  const tgtClipRaw = crop(tgtFull, spec.target, tgtScale);
  // Align by top: same width (nearest-neighbor resize width only), min height.
  const [srcClip, tgtClip] = alignPair(srcClipRaw, tgtClipRaw);
  fs.writeFileSync(path.join(dir, `${id}-${bp}-source.png`), PNG.sync.write(srcClip));
  fs.writeFileSync(path.join(dir, `${id}-${bp}-target.png`), PNG.sync.write(tgtClip));
  const diff = new PNG({ width: srcClip.width, height: srcClip.height });
  const numDiff = pixelmatch(srcClip.data, tgtClip.data, diff.data, srcClip.width, srcClip.height, {
    threshold: 0.15, includeAA: false, diffColor: [255,0,0], alpha: 0.4
  });
  const total = srcClip.width * srcClip.height;
  const matched = total - numDiff;
  const pct = (100 * matched / total);
  savePng(path.join(dir, `${id}-${bp}-mask.png`), diff);
  const sbs = sideBySide(srcClip, tgtClip);
  savePng(path.join(dir, `${id}-${bp}-side-by-side.png`), sbs);
  summary.push({ id, w: srcClip.width, h: srcClip.height, matched, differing: numDiff, total, visualMatchPercent: +pct.toFixed(3) });
}
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(dir, `parity-${bp}.json`), JSON.stringify(summary, null, 2));
