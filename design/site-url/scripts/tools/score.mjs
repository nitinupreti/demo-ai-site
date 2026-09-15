import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

function score(manifestPath) {
  const directory = path.dirname(path.resolve(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.pairs)) {
    throw new Error('Invalid scorer manifest.');
  }
  const results = manifest.pairs.map((pair, index) => {
    const source = PNG.sync.read(fs.readFileSync(path.join(directory, `${index}-source.png`)));
    const target = PNG.sync.read(fs.readFileSync(path.join(directory, `${index}-target.png`)));
    if (!source.width || !source.height || source.width !== target.width || source.height !== target.height) {
      throw new Error(`Pair ${index} has unequal or empty dimensions.`);
    }
    const totalPixels = source.width * source.height;
    if (totalPixels > 100000000) throw new Error('Screenshot exceeds the pixel budget.');
    const difference = new PNG({ width: source.width, height: source.height });
    const differentPixels = pixelmatch(source.data, target.data, difference.data, source.width, source.height, {
      threshold: 0.1,
      includeAA: false,
      diffMask: true,
    });
    fs.writeFileSync(path.join(directory, `${index}-diff.png`), PNG.sync.write(difference));
    return {
      index,
      matched_pixels: totalPixels - differentPixels,
      total_pixels: totalPixels,
      ratio: (totalPixels - differentPixels) / totalPixels,
    };
  });
  fs.writeFileSync(path.join(directory, 'measured.json'), JSON.stringify(results));
}

try {
  if (process.argv.length !== 3) throw new Error('Usage: node score.mjs <manifest.json>');
  score(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}