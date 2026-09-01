# Visual Parity Gate

This file owns component scoring, exact checks, screenshots, interaction comparison, anti-gaming rules, and remediation. Run it in the same turn as every appearance/behavior deploy.

## Readiness And Scope

Use real Playwright/Chromium for the frozen source, disabled target, and author target at every required breakpoint. Assert identical CSS viewport, DPR/scale, font readiness, media decode, motion state, and stable geometry before capture. Invalid readiness blocks scoring.

Every source instance maps exactly once to a target owner. Missing, duplicated, orphaned, or structurally combined/split regions fail.

## Exact Geometry Gate

For every component root and repeated child instance, collect source and target `getBoundingClientRect()` in the same turn:

| Component/instance | Breakpoint | Source x/w/h | Target x/w/h | Deltas | Full-bleed flags | Status |
|---|---:|---|---|---|---|---|

PASS requires x and width within 1 CSS px, height within 8 CSS px, and matching full-bleed status. A full-bleed source cannot be container-clamped. On failure, fix the owning component/container/grid/XF/template layer, redeploy, and remeasure. After three failed CSS attempts, reassess structure rather than adding hacks.

## Exact Property Gate

Compare raw source and target values for every frozen role:

- all typography metrics, family/style/weight/transform;
- all color properties as exact RGBA (Delta E <=3 only for antialiased/compressed raster pixels);
- backgrounds, borders, radius, opacity, shadow;
- spacing, display/position, flex/grid, overflow, aspect and fit;
- item counts, role order, semantics, attributes, and behavior class.

Section and CTA background/foreground/border/radius mismatches are hard failures. Token declarations and deployed resolved token/role values must all agree.

## Screenshot Gate

At every breakpoint:

1. In source and target, clear hover, trigger lazy loading, freeze animation for static capture, and scroll the homologous component root into view.
2. Save full-page source and target screenshots.
3. Save source and target region screenshots for every component instance at identical CSS dimensions and native DPR.
4. Produce labeled side-by-side images and pixel-diff masks.
5. Record matched pixels, differing pixels, total pixels, and `visualMatchPercent`.

Pixel comparison must use homologous non-blank crops. Reject wrong viewport, empty/mostly background crops, mismatched DPR, stale screenshots, different animation frames, and comparisons dominated by whitespace. Property equality never overrides screenshot failure.

## Interaction Gate

For every source hover/focus/active/transition role, use real pointer/keyboard events and capture before/after computed styles, nested icon transforms, and screenshots. Compare color, background, border, shadow, opacity, transform, and decoration. Capture one full carousel transition or marquee/ticker animation cycle. Skip hover only when source explicitly gates it off for non-hover input.

## Scores And Threshold

Calculate frozen weighted axis scores from `01-source-discovery.md`. Instance score is the weighted sum; component-type score is its minimum instance, not an average. Final component status is the minimum of:

- weighted property/structure score;
- `visualMatchPercent`;
- authorability score;
- media/interaction prerequisites.

Every raw instance, component-type minimum, and page composite must be strictly `>95%`; exactly 95% fails. A high page average cannot hide a failed component or axis.

## Remediation Loop

For each failed component:

1. Keep it FAILED and enumerate screenshot/property gaps.
2. Trace each gap to discovery/content, dialog, model, HTL, CSS/token, container/template, behavior, or asset ownership.
3. Fix the owning layer, run focused validation, deploy, and reconcile live repository/DOM/assets.
4. Recapture source and target in fresh/bypass-cache conditions and rescore only refreshed evidence.
5. Repeat until strictly above 95%. After three failed attempts on one gap, recapture source and redesign the component structure.

## Anti-Gaming Rules

- A score above 90 requires raw source/target evidence and valid screenshots.
- Missing/broken/un-authored assets, semantic-role substitutions, wrong full-bleed zones, incorrect body font, and missing interactions apply their prescribed hard failures/caps.
- Do not score a hand-picked subset of properties, blank crops, whitespace, authored CSS declarations without computed evidence, or stale captures.
- User rejection invalidates prior affected scores and evidence.
