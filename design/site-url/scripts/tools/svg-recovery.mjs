import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { chromium } from './browser.mjs';

async function verify(inputPath) {
  const directory = path.dirname(path.resolve(inputPath));
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const source = PNG.sync.read(fs.readFileSync(path.join(directory, 'source.png')));
  if (input.schema_version !== 1 || input.width !== source.width || input.height !== source.height
      || !source.width || !source.height || source.width * source.height > 16000000) {
    throw new Error('Invalid SVG recovery dimensions.');
  }
  const payload = fs.readFileSync(path.join(directory, 'candidate.svg'));
  const browser = await chromium.launch({ headless: true, timeout: 0 });
  try {
    const page = await browser.newPage({ viewport: { width: source.width, height: source.height }, deviceScaleFactor: 1 });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"></head><body style="margin:0"><img id="candidate" style="display:block"></body></html>');
    await page.evaluate(async ({ background, width, height, encoded }) => {
      document.body.style.backgroundColor = background || 'white';
      const image = document.querySelector('#candidate');
      image.width = width;
      image.height = height;
      image.src = `data:image/svg+xml;base64,${encoded}`;
      await image.decode();
    }, { ...input, encoded: payload.toString('base64') });
    const rendered = await page.screenshot({ path: path.join(directory, 'candidate.png') });
    const target = PNG.sync.read(rendered);
    if (target.width !== source.width || target.height !== source.height) throw new Error('Recovered SVG dimensions changed.');
    const difference = new PNG({ width: source.width, height: source.height });
    const mismatched = pixelmatch(source.data, target.data, difference.data, source.width, source.height, {
      threshold: 0.1, includeAA: true, diffMask: true,
    });
    fs.writeFileSync(path.join(directory, 'diff.png'), PNG.sync.write(difference));
    const total = source.width * source.height;
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({
      total_pixels: total, matched_pixels: total - mismatched, ratio: (total - mismatched) / total,
      source_image: path.join(directory, 'source.png'), target_image: path.join(directory, 'candidate.png'),
      diff_image: path.join(directory, 'diff.png'),
    }));
  } finally {
    await browser.close();
  }
}

try {
  if (process.argv.length !== 3) throw new Error('Usage: node svg-recovery.mjs <input.json>');
  await verify(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}