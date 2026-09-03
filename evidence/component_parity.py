"""Fast, generic component-level visual parity for any source and target URLs."""

from __future__ import annotations

import argparse
import base64
import csv
import json
import math
import pathlib
import re
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import urlsplit

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import Browser, BrowserContext, Page, Route, sync_playwright

DEFAULT_BREAKPOINTS = (1440, 768, 375)
ROLE_PATTERN = (
    r"section|block|band|strip|bar|hero|feature|service|offering|case|result|"
    r"partner|industr|insight|footer|header|cta|promo|carousel|ticker|marquee|"
    r"gallery|cards?|stories|video|media|article|navigation"
)

DISCOVER_SCRIPT = rf"""
({{selector, minHeight, minWidthRatio}}) => {{
  const rolePattern = /{ROLE_PATTERN}/i;
  const viewportWidth = window.innerWidth;
  const scrollY = window.scrollY;
  const documentHeight = document.documentElement.scrollHeight;
  const roots = Array.from(new Set([
    document.querySelector('header, [role="banner"]'),
    document.querySelector('main, [role="main"]'),
    document.querySelector('footer, [role="contentinfo"]'),
    document.body
  ].filter(Boolean)));
  const elements = selector
    ? Array.from(document.querySelectorAll(selector))
    : roots.flatMap(root => [root, ...root.querySelectorAll('*')]);

  const depth = el => {{
    let value = 0;
    while (el && el.parentElement) {{ value += 1; el = el.parentElement; }}
    return value;
  }};
  const family = el => {{
    const values = [
      el.getAttribute('data-cmp-is') || '',
      el.getAttribute('data-component') || '',
      el.getAttribute('data-testid') || '',
      typeof el.className === 'string' ? el.className : ''
    ].join(' ');
    const match = values.match(rolePattern);
    return match ? match[0].toLowerCase() : '';
  }};
  const heading = el => {{
    const node = el.matches('h1,h2,h3,h4,h5,h6') ? el : el.querySelector('h1,h2,h3,h4,h5,h6');
    return node ? (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  }};
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000);

  const raw = [];
  for (const el of elements) {{
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < viewportWidth * minWidthRatio || rect.height < minHeight) continue;
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const semantic = /^(HEADER|FOOTER|SECTION|ARTICLE|NAV|ASIDE|FIGURE|FORM|DIALOG)$/.test(el.tagName);
    const cmp = Boolean(el.getAttribute('data-cmp-is')) || Array.from(el.classList).some(c => c.startsWith('cmp-'));
    const attrs = Boolean(el.getAttribute('data-component') || el.getAttribute('data-testid'));
    const classMatch = rolePattern.test(typeof el.className === 'string' ? el.className : '');
    const direct = el.parentElement && roots.includes(el.parentElement);
    if (!selector && !(semantic || cmp || attrs || classMatch || direct)) continue;
    const absoluteY = rect.y + scrollY;
    if (absoluteY + rect.height <= 0 || absoluteY >= documentHeight) continue;
    raw.push({{
      el,
      tag: el.tagName.toLowerCase(),
      className: Array.from(el.classList).slice(0, 5).join(' '),
      family: family(el),
      heading: heading(el),
      text: text(el),
      x: Math.max(0, rect.x),
      y: absoluteY,
      width: Math.min(viewportWidth, rect.width),
      height: rect.height,
      depth: depth(el),
      rank: (cmp ? 10 : 0) + (semantic ? 7 : 0) + (attrs ? 5 : 0) + (classMatch ? 3 : 0) + (direct ? 2 : 0)
    }});
  }}

  raw.sort((a, b) => b.rank - a.rank || a.depth - b.depth || a.height - b.height);
  const exact = [];
  for (const candidate of raw) {{
    const duplicate = exact.some(existing =>
      Math.abs(existing.x - candidate.x) < 2 && Math.abs(existing.y - candidate.y) < 2 &&
      Math.abs(existing.width - candidate.width) < 2 && Math.abs(existing.height - candidate.height) < 2
    );
    if (!duplicate) exact.push(candidate);
  }}

  const selected = exact.filter(candidate => {{
    if (candidate.height > documentHeight * 0.8 && !/^(header|footer)$/.test(candidate.tag)) return false;
        const preferredSameFamily = exact.find(other =>
            other !== candidate && other.family && other.family === candidate.family &&
            (other.el.contains(candidate.el) || candidate.el.contains(other.el)) &&
            Math.max(other.height, candidate.height) <= Math.min(other.height, candidate.height) * 4 &&
            (other.rank > candidate.rank || (other.rank === candidate.rank && other.depth < candidate.depth))
    );
        if (preferredSameFamily) return false;
    const innerFamilies = new Set(exact.filter(other =>
      other !== candidate && other.family && other.family !== candidate.family && candidate.el.contains(other.el)
    ).map(other => other.family));
    if (innerFamilies.size >= 2 && !candidate.el.getAttribute('data-cmp-is')) return false;
    return true;
  }});

  selected.sort((a, b) => a.y - b.y || a.x - b.x);
  const output = [];
  for (const candidate of selected) {{
    const overlaps = output.find(existing => {{
      const intersection = Math.max(0, Math.min(existing.y + existing.height, candidate.y + candidate.height) - Math.max(existing.y, candidate.y));
      return intersection / Math.min(existing.height, candidate.height) > 0.92;
    }});
    if (overlaps && (overlaps.family === candidate.family || Math.abs(overlaps.y - candidate.y) < 12)) continue;
    output.push(candidate);
  }}
    const withoutNestedInternals = output.filter(candidate => !output.some(outer =>
        outer !== candidate && outer.el.contains(candidate.el) &&
        outer.y <= candidate.y + 2 && outer.y + outer.height >= candidate.y + candidate.height - 2 &&
        (!candidate.text || outer.text.includes(candidate.text.slice(0, Math.min(180, candidate.text.length))))
    ));
    const merged = [];
    for (const candidate of withoutNestedInternals) {{
        const previous = merged[merged.length - 1];
        const gap = previous ? candidate.y - (previous.y + previous.height) : Infinity;
        const prefixOf = (item) => {{
            const first = (item.className || '').split(/\s+/)[0] || '';
            const match = first.match(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*/i);
            return match ? match[0].toLowerCase() : '';
        }};
        const samePrefix = previous ? prefixOf(previous) === prefixOf(candidate) : false;
        if (previous && previous.family && previous.family === candidate.family && (samePrefix || previous.family !== 'footer') && gap >= -2 && gap <= 40) {{
            const bottom = Math.max(previous.y + previous.height, candidate.y + candidate.height);
            previous.x = Math.min(previous.x, candidate.x);
            previous.y = Math.min(previous.y, candidate.y);
            previous.width = Math.max(previous.width, candidate.width);
            previous.height = bottom - previous.y;
            previous.heading = previous.heading || candidate.heading;
            previous.text = [previous.text, candidate.text].filter(Boolean).join(' ');
            continue;
        }}
        merged.push(candidate);
    }}
  return {{
    url: location.href,
    viewportWidth,
    viewportHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    documentHeight,
    blocks: merged.map((item, index) => ({{
      index,
      tag: item.tag,
      className: item.className,
      family: item.family,
      heading: item.heading,
      text: item.text,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height
    }}))
  }};
}}
"""

PREPARE_SCRIPT = """
async ({scrollDelay, maxScrollMs, mediaTimeoutMs}) => {
  const timeout = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  if (document.fonts) await Promise.race([document.fonts.ready.catch(() => {}), timeout(mediaTimeoutMs)]);
  const started = performance.now();
  const step = Math.max(500, window.innerHeight - 120);
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await timeout(scrollDelay);
    if (performance.now() - started > maxScrollMs) break;
  }
  window.scrollTo(0, 0);
  const images = Array.from(document.images).filter(img => {
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  await Promise.race([
    Promise.allSettled(images.map(img => img.complete ? img.decode().catch(() => {}) : new Promise(resolve => {
      img.addEventListener('load', resolve, {once: true});
      img.addEventListener('error', resolve, {once: true});
    }))),
    timeout(mediaTimeoutMs)
  ]);
  document.querySelectorAll('[data-component-parity-freeze]').forEach(node => node.remove());
  const style = document.createElement('style');
  style.setAttribute('data-component-parity-freeze', '');
  style.textContent = [
    '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}',
    '[class*="animate-in"],[class*="AnimateIn"],[class*="fade-in"],[class*="FadeIn"],[data-animate],[data-inview]{opacity:1!important;transform:none!important;visibility:visible!important;filter:none!important;clip-path:none!important}'
  ].join('\\n');
  document.head.appendChild(style);
  await timeout(200);
}
"""

TRACKER_PATTERN = re.compile(
    r"google-analytics|googletagmanager|doubleclick|hotjar|clarity\.ms|segment\.io|"
    r"facebook\.net|newrelic|datadog|amplitude|mixpanel|optimizely|analytics",
    re.IGNORECASE,
)


@dataclass
class Block:
    index: int
    tag: str
    className: str
    family: str
    heading: str
    text: str
    x: float
    y: float
    width: float
    height: float


@dataclass
class Manifest:
    requested_url: str
    final_url: str
    breakpoint: int
    viewport_width: int
    viewport_height: int
    dpr: float
    document_height: float
    screenshot: str
    captured_at: float
    blocks: list[Block]

    def to_json(self) -> dict[str, Any]:
        value = asdict(self)
        value["blocks"] = [asdict(block) for block in self.blocks]
        return value

    @classmethod
    def from_path(cls, path: pathlib.Path) -> "Manifest":
        value = json.loads(path.read_text(encoding="utf-8"))
        value["blocks"] = [Block(**block) for block in value["blocks"]]
        return cls(**value)


def parse_breakpoints(value: str) -> list[int]:
    values = [int(item.strip()) for item in value.split(",") if item.strip()]
    if not values or any(item <= 0 for item in values):
        raise argparse.ArgumentTypeError("breakpoints must be positive comma-separated integers")
    return values


def origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def route_request(route: Route, auth_origin: str | None, auth_header: str | None, block_trackers: bool) -> None:
    request = route.request
    if block_trackers and TRACKER_PATTERN.search(request.url):
        route.abort()
        return
    if auth_origin and auth_header and request.url.startswith(auth_origin):
        headers = dict(request.headers)
        headers["authorization"] = auth_header
        route.continue_(headers=headers)
        return
    route.continue_()


def new_context(browser: Browser, viewport: int, target_url: str | None, auth: tuple[str, str] | None, block_trackers: bool) -> BrowserContext:
    context = browser.new_context(
        viewport={"width": viewport, "height": 900},
        device_scale_factor=1,
        ignore_https_errors=True,
        reduced_motion="reduce",
    )
    auth_origin = origin(target_url) if target_url and auth else None
    auth_header = None
    if auth:
        token = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
        auth_header = f"Basic {token}"
    context.route("**/*", lambda route: route_request(route, auth_origin, auth_header, block_trackers))
    return context


def capture(
    page: Page,
    requested_url: str,
    breakpoint: int,
    label: str,
    out_dir: pathlib.Path,
    selector: str | None,
    navigation_timeout_ms: int,
    settle_ms: int,
    min_height: int,
    min_width_ratio: float,
) -> Manifest:
    page.set_viewport_size({"width": breakpoint, "height": 900})
    page.goto(requested_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
    if settle_ms:
        page.wait_for_timeout(settle_ms)
    page.evaluate(PREPARE_SCRIPT, {"scrollDelay": 35, "maxScrollMs": 2500, "mediaTimeoutMs": 3500})
    raw = page.evaluate(
        DISCOVER_SCRIPT,
        {"selector": selector or "", "minHeight": min_height, "minWidthRatio": min_width_ratio},
    )
    screenshot_path = out_dir / f"{label}-full-{breakpoint}.png"
    page.screenshot(path=str(screenshot_path), full_page=True, animations="disabled", timeout=30000)
    manifest = Manifest(
        requested_url=requested_url,
        final_url=raw["url"],
        breakpoint=breakpoint,
        viewport_width=raw["viewportWidth"],
        viewport_height=raw["viewportHeight"],
        dpr=raw["dpr"],
        document_height=raw["documentHeight"],
        screenshot=str(screenshot_path),
        captured_at=time.time(),
        blocks=[Block(**item) for item in raw["blocks"]],
    )
    manifest_path = out_dir / f"{label}-manifest-{breakpoint}.json"
    manifest_path.write_text(json.dumps(manifest.to_json(), indent=2), encoding="utf-8")
    print(f"[capture] {label} {breakpoint}px: {len(manifest.blocks)} blocks, {manifest.document_height:.0f}px page")
    return manifest


def cached_manifest(out_dir: pathlib.Path, label: str, breakpoint: int, requested_url: str) -> Manifest | None:
    path = out_dir / f"{label}-manifest-{breakpoint}.json"
    if not path.exists():
        return None
    manifest = Manifest.from_path(path)
    if manifest.requested_url != requested_url or manifest.viewport_width != breakpoint:
        return None
    if not pathlib.Path(manifest.screenshot).exists():
        return None
    return manifest


def tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", value.lower()))


def overlap_score(left: str, right: str) -> float:
    a, b = tokens(left), tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def block_similarity(source: Block, target: Block, source_height: float, target_height: float) -> float:
    text_score = overlap_score(source.text, target.text)
    heading_score = overlap_score(source.heading, target.heading)
    family_score = overlap_score(source.family + " " + source.className, target.family + " " + target.className)
    source_center = (source.y + source.height / 2) / max(1.0, source_height)
    target_center = (target.y + target.height / 2) / max(1.0, target_height)
    position_score = max(0.0, 1.0 - abs(source_center - target_center) * 2.5)
    if not source.text.strip() or not target.text.strip():
        return 0.45 * family_score + 0.55 * position_score
    return 0.50 * text_score + 0.25 * heading_score + 0.10 * family_score + 0.15 * position_score


def align_blocks(source: Manifest, target: Manifest) -> tuple[list[tuple[int, int, float]], list[int], list[int]]:
    rows, cols = len(source.blocks), len(target.blocks)
    skip_penalty = -0.10
    dp = np.zeros((rows + 1, cols + 1), dtype=np.float64)
    move = np.zeros((rows + 1, cols + 1), dtype=np.int8)
    for i in range(1, rows + 1):
        dp[i, 0] = i * skip_penalty
        move[i, 0] = 1
    for j in range(1, cols + 1):
        dp[0, j] = j * skip_penalty
        move[0, j] = 2
    similarities = np.zeros((rows, cols), dtype=np.float64)
    for i, source_block in enumerate(source.blocks):
        for j, target_block in enumerate(target.blocks):
            similarities[i, j] = block_similarity(source_block, target_block, source.document_height, target.document_height)
    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            similarity = similarities[i - 1, j - 1]
            match = dp[i - 1, j - 1] + similarity - 0.18
            skip_source = dp[i - 1, j] + skip_penalty
            skip_target = dp[i, j - 1] + skip_penalty
            options = (match, skip_source, skip_target)
            choice = int(np.argmax(options))
            dp[i, j] = options[choice]
            move[i, j] = choice
    pairs: list[tuple[int, int, float]] = []
    used_source: set[int] = set()
    used_target: set[int] = set()
    i, j = rows, cols
    while i or j:
        direction = move[i, j]
        if i and j and direction == 0:
            similarity = float(similarities[i - 1, j - 1])
            if similarity >= 0.15:
                pairs.append((i - 1, j - 1, similarity))
                used_source.add(i - 1)
                used_target.add(j - 1)
            i -= 1
            j -= 1
        elif i and (not j or direction == 1):
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs, [i for i in range(rows) if i not in used_source], [j for j in range(cols) if j not in used_target]


def slug(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (normalized[:64] or fallback).rstrip("-")


def block_label(block: Block, index: int) -> str:
    source = block.heading or block.family or block.className or block.tag
    return f"{index:02d}-{slug(source, 'block')}"


def load_image(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)


def crop(image: np.ndarray, block: Block, viewport_width: int) -> np.ndarray:
    scale = image.shape[1] / max(1, viewport_width)
    x = max(0, int(round(block.x * scale)))
    y = max(0, int(round(block.y * scale)))
    width = max(1, min(image.shape[1] - x, int(round(block.width * scale))))
    height = max(1, min(image.shape[0] - y, int(round(block.height * scale))))
    return image[y:y + height, x:x + width]


def common_canvas(source: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    height = max(source.shape[0], target.shape[0])
    width = max(source.shape[1], target.shape[1])
    source_canvas = np.full((height, width, 4), 255, dtype=np.uint8)
    target_canvas = np.full((height, width, 4), 255, dtype=np.uint8)
    source_canvas[:source.shape[0], :source.shape[1]] = source
    target_canvas[:target.shape[0], :target.shape[1]] = target
    return source_canvas, target_canvas


def perceptual_diff(source: np.ndarray, target: np.ndarray, threshold: float) -> tuple[np.ndarray, int]:
    source_rgb = source[..., :3].astype(np.float32)
    target_rgb = target[..., :3].astype(np.float32)
    delta = source_rgb - target_rgb
    y = 0.29889531 * delta[..., 0] + 0.58662247 * delta[..., 1] + 0.11448223 * delta[..., 2]
    i = 0.59597799 * delta[..., 0] - 0.27417610 * delta[..., 1] - 0.32180189 * delta[..., 2]
    q = 0.21147017 * delta[..., 0] - 0.52261711 * delta[..., 1] + 0.31114694 * delta[..., 2]
    color_delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
    changed = color_delta > 35215.0 * threshold * threshold
    mask = np.full_like(source, 255)
    mask[..., :3] = np.where(changed[..., None], np.array([255, 0, 0], dtype=np.uint8), source[..., :3])
    mask[..., 3] = 255
    return mask, int(changed.sum())


def geometry_score(source: Block, target: Block) -> float:
    width = min(source.width, target.width) / max(source.width, target.width, 1.0)
    height = min(source.height, target.height) / max(source.height, target.height, 1.0)
    x_delta = abs(source.x - target.x) / max(source.width, target.width, 1.0)
    x = max(0.0, 1.0 - x_delta)
    return 100.0 * (0.35 * width + 0.50 * height + 0.15 * x)


def save_image(image: np.ndarray, path: pathlib.Path) -> None:
    Image.fromarray(image, "RGBA").save(path, optimize=True)


def side_by_side(source: np.ndarray, target: np.ndarray) -> Image.Image:
    banner_height, gap = 28, 12
    height = max(source.shape[0], target.shape[0]) + banner_height
    width = source.shape[1] + target.shape[1] + gap
    image = Image.new("RGBA", (width, height), (245, 245, 245, 255))
    image.paste(Image.fromarray(source, "RGBA"), (0, banner_height))
    image.paste(Image.fromarray(target, "RGBA"), (source.shape[1] + gap, banner_height))
    draw = ImageDraw.Draw(image)
    draw.text((8, 7), "LIVE SITE", fill=(20, 20, 20, 255))
    draw.text((source.shape[1] + gap + 8, 7), "TARGET", fill=(20, 20, 20, 255))
    return image


def compare(source: Manifest, target: Manifest, out_dir: pathlib.Path, threshold: float, pass_threshold: float) -> list[dict[str, Any]]:
    source_image = load_image(source.screenshot)
    target_image = load_image(target.screenshot)
    pairs, unpaired_source, unpaired_target = align_blocks(source, target)
    rows: list[dict[str, Any]] = []
    for pair_index, (source_index, target_index, confidence) in enumerate(pairs):
        source_block = source.blocks[source_index]
        target_block = target.blocks[target_index]
        label = block_label(source_block, pair_index)
        source_crop = crop(source_image, source_block, source.viewport_width)
        target_crop = crop(target_image, target_block, target.viewport_width)
        source_canvas, target_canvas = common_canvas(source_crop, target_crop)
        mask, differing = perceptual_diff(source_canvas, target_canvas, threshold)
        total = int(source_canvas.shape[0] * source_canvas.shape[1])
        pixel_score = 100.0 * (total - differing) / total
        layout_score = geometry_score(source_block, target_block)
        final_score = min(pixel_score, layout_score)
        prefix = out_dir / f"{label}-{source.breakpoint}"
        save_image(source_canvas, prefix.with_name(prefix.name + "-source.png"))
        save_image(target_canvas, prefix.with_name(prefix.name + "-target.png"))
        save_image(mask, prefix.with_name(prefix.name + "-mask.png"))
        side_by_side(source_canvas, target_canvas).save(prefix.with_name(prefix.name + "-side-by-side.png"), optimize=True)
        rows.append({
            "breakpoint": source.breakpoint,
            "label": label,
            "sourceIndex": source_index,
            "targetIndex": target_index,
            "sourceHeading": source_block.heading,
            "targetHeading": target_block.heading,
            "matchConfidence": round(confidence * 100, 3),
            "pixelScore": round(pixel_score, 3),
            "geometryScore": round(layout_score, 3),
            "finalScore": round(final_score, 3),
            "status": "PASS" if final_score > pass_threshold else "FAIL",
            "matchedPixels": total - differing,
            "differingPixels": differing,
            "totalPixels": total,
            "sourceScreenshot": str(prefix.with_name(prefix.name + "-source.png")),
            "targetScreenshot": str(prefix.with_name(prefix.name + "-target.png")),
            "sideBySide": str(prefix.with_name(prefix.name + "-side-by-side.png")),
            "diffMask": str(prefix.with_name(prefix.name + "-mask.png")),
        })
    for index in unpaired_source:
        block = source.blocks[index]
        rows.append({"breakpoint": source.breakpoint, "label": block_label(block, index), "sourceIndex": index, "status": "FAIL", "reason": "unpaired-source", "finalScore": 0.0})
    for index in unpaired_target:
        block = target.blocks[index]
        rows.append({"breakpoint": target.breakpoint, "label": block_label(block, index), "targetIndex": index, "status": "FAIL", "reason": "unpaired-target", "finalScore": 0.0})
    return rows


def write_reports(rows: list[dict[str, Any]], out_dir: pathlib.Path, pass_threshold: float) -> None:
    (out_dir / "component-parity.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    fields = ["breakpoint", "label", "sourceIndex", "targetIndex", "matchConfidence", "pixelScore", "geometryScore", "finalScore", "status", "reason"]
    with (out_dir / "component-parity.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print("\nBP     Score   Pixel  Layout  Status  Component")
    print("-----  ------  -----  ------  ------  ---------")
    for row in sorted(rows, key=lambda item: (item["breakpoint"], item.get("sourceIndex", math.inf), item.get("targetIndex", math.inf))):
        print(f"{row['breakpoint']:>5}  {row.get('finalScore', 0):>6.2f}  {row.get('pixelScore', 0):>5.1f}  {row.get('geometryScore', 0):>6.1f}  {row['status']:^6}  {row['label']}")
    print("\nBreakpoint minima")
    for breakpoint in sorted({row["breakpoint"] for row in rows}):
        subset = [row["finalScore"] for row in rows if row["breakpoint"] == breakpoint]
        minimum = min(subset) if subset else 0.0
        status = "PASS" if minimum > pass_threshold else "FAIL"
        print(f"{breakpoint}: {minimum:.3f}% {status} ({len(subset)} rows)")


def parse_auth(value: str | None) -> tuple[str, str] | None:
    if not value:
        return None
    if ":" not in value:
        raise argparse.ArgumentTypeError("target auth must be user:password")
    return tuple(value.split(":", 1))  # type: ignore[return-value]


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--target-auth", "--auth", dest="target_auth", default=None)
    parser.add_argument("--breakpoints", type=parse_breakpoints, default=list(DEFAULT_BREAKPOINTS))
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("evidence"))
    parser.add_argument("--source-selector", default=None, help="Optional CSS selector for source component roots.")
    parser.add_argument("--target-selector", default=None, help="Optional CSS selector for target component roots.")
    parser.add_argument("--refresh-source", action="store_true", help="Ignore frozen source screenshots/manifests.")
    parser.add_argument("--navigation-timeout-ms", type=int, default=45000)
    parser.add_argument("--settle-ms", type=int, default=600)
    parser.add_argument("--min-height", type=int, default=80)
    parser.add_argument("--min-width-ratio", type=float, default=0.55)
    parser.add_argument("--pixel-threshold", type=float, default=0.10)
    parser.add_argument("--pass-threshold", type=float, default=92.0)
    parser.add_argument("--allow-trackers", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = arguments()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    target_auth = parse_auth(args.target_auth)
    source_manifests: dict[int, Manifest] = {}
    target_manifests: dict[int, Manifest] = {}
    started = time.perf_counter()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        source_context = new_context(browser, args.breakpoints[0], None, None, not args.allow_trackers)
        target_context = new_context(browser, args.breakpoints[0], args.target, target_auth, not args.allow_trackers)
        source_page = source_context.new_page()
        target_page = target_context.new_page()
        for breakpoint in args.breakpoints:
            cached = None if args.refresh_source else cached_manifest(out_dir, "source", breakpoint, args.source)
            if cached:
                source_manifests[breakpoint] = cached
                print(f"[cache] source {breakpoint}px: {len(cached.blocks)} frozen blocks")
            else:
                source_manifests[breakpoint] = capture(
                    source_page, args.source, breakpoint, "source", out_dir, args.source_selector,
                    args.navigation_timeout_ms, args.settle_ms, args.min_height, args.min_width_ratio,
                )
            target_manifests[breakpoint] = capture(
                target_page, args.target, breakpoint, "target", out_dir, args.target_selector,
                args.navigation_timeout_ms, args.settle_ms, args.min_height, args.min_width_ratio,
            )
        source_context.close()
        target_context.close()
        browser.close()

    rows: list[dict[str, Any]] = []
    for breakpoint in args.breakpoints:
        rows.extend(compare(source_manifests[breakpoint], target_manifests[breakpoint], out_dir, args.pixel_threshold, args.pass_threshold))
    write_reports(rows, out_dir, args.pass_threshold)
    print(f"\nCompleted in {time.perf_counter() - started:.2f}s; reports: {out_dir / 'component-parity.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
