// Stage 1 coverage/ownership analysis: builds sorted merged y-range coverage from candidate rects,
// flags unclaimed gaps >= 20 CSS px, and emits a source_selector_map skeleton per breakpoint.
import fs from 'fs';
import path from 'path';

const DIR = process.argv[2];
const BREAKPOINTS = (process.argv[3] || '375,768,1440').split(',').map(Number);

for (const bp of BREAKPOINTS) {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, `manifest-${bp}.json`), 'utf8'));
  const pageWidth = manifest.viewport.innerWidth;
  const scrollHeight = manifest.viewport.scrollHeight;

  // Only consider "owner-worthy" candidates: reasonably wide (>=60% page width) OR top-level landmarks/headings.
  const bands = manifest.candidates
    .filter(c => c.rect.height > 0)
    .map(c => ({
      selector: c.selector,
      tag: c.tag,
      classes: c.classes,
      y0: c.rect.y,
      y1: c.rect.y + c.rect.height,
      width: c.rect.width,
      widthRatio: c.rect.width / pageWidth,
      signals: c.signals,
      text: c.text,
    }))
    .filter(b => b.widthRatio >= 0.55 || b.signals.some(s => s.startsWith('landmark') || s.startsWith('heading')))
    .sort((a, b) => a.y0 - b.y0 || (b.y1 - b.y0) - (a.y1 - a.y0));

  // Merge into coverage rows: sample every 20px, find smallest-height owner covering that y with widthRatio>=0.6
  const step = 20;
  const rows = [];
  let cursorOwner = null;
  let rowStart = 0;
  for (let y = 0; y < scrollHeight; y += step) {
    const owners = bands.filter(b => y >= b.y0 - 1 && y < b.y1 + 1 && b.widthRatio >= 0.55);
    owners.sort((a, b) => (a.y1 - a.y0) - (b.y1 - b.y0));
    const owner = owners[0] || null;
    const ownerKey = owner ? owner.selector : 'UNCLAIMED';
    if (ownerKey !== cursorOwner) {
      if (cursorOwner !== null) rows.push({ from: rowStart, to: y, owner: cursorOwner });
      cursorOwner = ownerKey;
      rowStart = y;
    }
  }
  rows.push({ from: rowStart, to: scrollHeight, owner: cursorOwner });

  // merge consecutive rows with same owner (already done) then find gaps
  const gaps = rows.filter(r => r.owner === 'UNCLAIMED' && (r.to - r.from) >= 20);

  fs.writeFileSync(path.join(DIR, `coverage-${bp}.json`), JSON.stringify({ bp, scrollHeight, rows, gaps, bandCount: bands.length }, null, 2));
  console.log(`BP ${bp}: rows=${rows.length} gaps>=20px=${gaps.length} scrollHeight=${scrollHeight}`);
  if (gaps.length) console.log(JSON.stringify(gaps, null, 2));
}
