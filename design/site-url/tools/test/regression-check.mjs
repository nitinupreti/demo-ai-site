/**
 * Regression tool: capture a page before and after with the real browser, then the comparison
 * cases on synthetic screenshots (unchanged, changed pixels, changed size, no baseline).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PNG } from 'pngjs';

import { comparePair } from '../regression.mjs';

const toolsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-check-'));
const run = (args) => spawnSync(process.execPath, [path.join(toolsDir, 'regression.mjs'), ...args], {
  encoding: 'utf8', windowsHide: true,
});
const png = (width, height, paint = () => [255, 255, 255, 255]) => {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = a;
    }
  }
  return PNG.sync.write(image);
};

// 1. Capture: the same static page twice is unchanged.
const page = path.join(sandbox, 'page.html');
fs.writeFileSync(page, '<!doctype html><html><body style="margin:0;font:16px Arial">'
  + '<header style="height:80px;background:#123">Header</header><main style="height:400px">Body</main></body></html>');
const captureDir = path.join(sandbox, 'capture');
const config = path.join(sandbox, 'config.json');
fs.writeFileSync(config, JSON.stringify({ pages: [{ id: 'static', url: pathToFileURL(page).href }], breakpoints: [375, 1440] }));
for (const label of ['before', 'after']) {
  const result = run(['--config', config, '--out', captureDir, '--label', label]);
  expect(result.status === 0, `capture ${label} exited ${result.status}: ${result.stderr}`);
}
const before = JSON.parse(fs.readFileSync(path.join(captureDir, 'before', 'capture.json'), 'utf8'));
expect(before.captures.length === 2 && before.captures.every((entry) => entry.file && fs.existsSync(path.join(captureDir, 'before', entry.file))),
  `every page and width must be captured, got ${JSON.stringify(before.captures)}`);
run(['--compare', '--out', captureDir]);
const same = JSON.parse(fs.readFileSync(path.join(captureDir, 'regression.json'), 'utf8'));
expect(same.status === 'PASS' && same.pages.every((entry) => entry.status === 'UNCHANGED'),
  `an unchanged page must compare UNCHANGED, got ${JSON.stringify(same.pages.map((entry) => entry.status))}`);

// 2. Comparison cases on synthetic captures.
const compareDir = path.join(sandbox, 'compare');
const shot = (label, name, bytes) => {
  fs.mkdirSync(path.join(compareDir, label), { recursive: true });
  fs.writeFileSync(path.join(compareDir, label, name), bytes);
  return name;
};
const white = png(40, 40);
const striped = png(40, 40, (x, y) => (y < 8 ? [200, 0, 0, 255] : [255, 255, 255, 255]));
const captures = (label, entries) => fs.writeFileSync(path.join(compareDir, label, 'capture.json'), JSON.stringify({ label, captures: entries }));
shot('before', 'a-375.png', white);
shot('after', 'a-375.png', white);
shot('before', 'b-375.png', white);
shot('after', 'b-375.png', striped);
shot('before', 'c-375.png', white);
shot('after', 'c-375.png', png(40, 60));
shot('after', 'd-375.png', white);
captures('before', [
  { page: 'a', url: 'http://x/a', width: 375, file: 'a-375.png' },
  { page: 'b', url: 'http://x/b', width: 375, file: 'b-375.png' },
  { page: 'c', url: 'http://x/c', width: 375, file: 'c-375.png' },
  { page: 'd', url: 'http://x/d', width: 375, file: null, error: 'net::ERR_CONNECTION_REFUSED' },
]);
captures('after', ['a', 'b', 'c', 'd'].map((id) => ({ page: id, url: `http://x/${id}`, width: 375, file: `${id}-375.png` })));
run(['--compare', '--out', compareDir]);
const compared = JSON.parse(fs.readFileSync(path.join(compareDir, 'regression.json'), 'utf8'));
const status = Object.fromEntries(compared.pages.map((entry) => [entry.page, entry]));
expect(compared.status === 'CHANGED', `any changed page makes the run CHANGED, got ${compared.status}`);
expect(status.a?.status === 'UNCHANGED' && status.a.ratio === 1, 'identical captures are unchanged');
expect(status.b?.status === 'CHANGED' && status.b.ratio < 0.999 && fs.existsSync(path.join(compareDir, status.b.mask)),
  `changed pixels are CHANGED with a mask, got ${JSON.stringify(status.b)}`);
expect(status.c?.status === 'CHANGED' && status.c.ratio === null && /40x40 -> 40x60/.test(status.c.reason),
  `a size change is CHANGED and says so, got ${JSON.stringify(status.c)}`);
expect(status.d?.status === 'UNMEASURED' && status.d.reason.includes('ERR_CONNECTION_REFUSED'),
  `a missing baseline is UNMEASURED with its reason, got ${JSON.stringify(status.d)}`);
expect(comparePair(path.join(compareDir, 'before', 'a-375.png'), path.join(compareDir, 'after', 'a-375.png')).status === 'UNCHANGED',
  'comparePair is usable on its own');

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('regression tool assertions: all passed');
}
