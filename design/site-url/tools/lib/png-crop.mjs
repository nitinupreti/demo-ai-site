/** Crops of the frozen full-page source screenshots; lives beside pngjs so the orchestrator needs no install. */
import fs from 'node:fs';

import { PNG } from 'pngjs';

// A crop is a reference image for an agent, not evidence; a very tall section is shown from the top.
const MAX_CROP_HEIGHT = 4000;

export function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

/** The part of `image` under `rect`, clamped to the image; null when nothing of it is on the image. */
export function cropPng(image, rect) {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.min(image.width - x, Math.ceil(rect.w));
  const height = Math.min(image.height - y, Math.ceil(rect.h), MAX_CROP_HEIGHT);
  if (!(width > 0) || !(height > 0)) return null;
  const out = new PNG({ width, height });
  PNG.bitblt(image, out, x, y, width, height, 0, 0);
  return PNG.sync.write(out);
}
