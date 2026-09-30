/**
 * Everything a worker needs, written into its own workspace: its instances' slice of discovery,
 * the token vocabulary, its assets with the inline SVG files, and a crop of each instance at each
 * breakpoint. In real runs workers otherwise spent their first turns locating a 700 KB evidence
 * file, parsing it with throwaway scripts, reading other agents' logs for token names and
 * re-scraping the live site for copy and icons.
 */
import fs from 'node:fs';
import path from 'node:path';

export const INPUTS_DIR = '.migration';

/** The discovery records of these instances only, plus what the whole page shares. */
export function evidenceSlice(discovery, instanceIds) {
  const wanted = new Set(instanceIds);
  return {
    source: { final_url: discovery.source?.final_url || null, generated_at: discovery.generated_at || null },
    breakpoints: discovery.breakpoints || [],
    fonts_rendered: discovery.fonts?.loaded || [],
    instances: (discovery.instances || []).filter((instance) => wanted.has(instance.id)),
  };
}

/**
 * One crop per instance and breakpoint, cut once from the frozen full-page screenshots discovery
 * took. Missing pngjs or a screenshot only means no crops: they are a reference, never a gate.
 */
export async function prepareCrops({ discovery, discoveryDir, outDir, renderer }) {
  const crops = {};
  let cropping;
  try {
    cropping = await import('../tools/lib/png-crop.mjs');
  } catch (error) {
    renderer?.warn(`source crops skipped: ${error.message.split('\n')[0]}`);
    return crops;
  }
  fs.mkdirSync(outDir, { recursive: true });
  // Rects are CSS pixels; the screenshot is device pixels.
  const scale = Number(discovery.dpr) || 1;
  for (const width of discovery.breakpoints || []) {
    const shot = discovery.screenshots?.[width];
    const shotPath = shot ? path.join(discoveryDir, shot) : null;
    if (!shotPath || !fs.existsSync(shotPath)) continue;
    const image = cropping.readPng(shotPath);
    for (const instance of discovery.instances || []) {
      const rect = instance.rect?.[width];
      if (!rect) continue;
      const bytes = cropping.cropPng(image, {
        x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale,
      });
      if (!bytes) continue;
      const file = path.join(outDir, `${instance.id}-${width}.png`);
      fs.writeFileSync(file, bytes);
      (crops[instance.id] ||= {})[width] = file;
    }
  }
  return crops;
}

/** Writes `.migration/` into a workspace and returns the absolute paths the task block names. */
export function writeComponentInputs({
  workspaceRoot, component, discovery, assets = [], tokens = null, fonts = null, crops = {},
}) {
  const dir = path.join(workspaceRoot, INPUTS_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const evidencePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidenceSlice(discovery, component.instances), null, 2)}\n`, 'utf8');

  const svgDir = path.join(dir, 'svg');
  const ownAssets = assets.map((entry) => {
    if (!entry.local_file || !fs.existsSync(entry.local_file)) return entry;
    fs.mkdirSync(svgDir, { recursive: true });
    const copy = path.join(svgDir, path.basename(entry.dam_path));
    fs.copyFileSync(entry.local_file, copy);
    return { ...entry, local_file: copy };
  });
  const assetsPath = path.join(dir, 'assets.json');
  fs.writeFileSync(assetsPath, `${JSON.stringify(ownAssets, null, 2)}\n`, 'utf8');

  let tokensPath = null;
  if (tokens) {
    tokensPath = path.join(dir, 'tokens.json');
    fs.writeFileSync(tokensPath, `${JSON.stringify({ ...tokens, fonts: fonts?.families || [] }, null, 2)}\n`, 'utf8');
  }

  const cropDir = path.join(dir, 'source');
  const copied = [];
  for (const instance of component.instances) {
    for (const [width, file] of Object.entries(crops[instance] || {})) {
      fs.mkdirSync(cropDir, { recursive: true });
      const copy = path.join(cropDir, `${instance}-${width}.png`);
      fs.copyFileSync(file, copy);
      copied.push(copy);
    }
  }

  return {
    dir, evidence: evidencePath, assets: assetsPath, tokens: tokensPath, source_crops: copied, assets_list: ownAssets,
  };
}
