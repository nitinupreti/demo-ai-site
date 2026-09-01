# Visual Parity Gate

This file owns component scoring, exact checks, screenshots, interaction comparison, anti-gaming rules, and remediation. Run it in the same turn as every appearance/behavior deploy.

## Stage Execution Contract

- Inputs: accepted Stages 1-3 results, frozen denominators, deployed target URLs, and the same `run_id`.
- Execute the full Playwright comparison at every breakpoint for every block/instance. Do not substitute CSS declarations or selected properties for rendered evidence.
- Required outputs: readiness matrix, per-instance geometry/property/interaction tables, full and component screenshots, side-by-side/diff artifacts, scores, remediation history, and final minima/composites.
- Exit gate: all prerequisites pass and every raw instance, component-type minimum, and page composite is strictly above 95% at every breakpoint.

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

1. Use Playwright to navigate one page to the exact live `SITE_URL` and a second page to the deployed AEM disabled URL. Record both final URLs after redirects. A local copy, cached historical image, CSS preview, or authored mock is not a source substitute.
2. In source and target, assert the requested `window.innerWidth`, DPR, `visualViewport.scale`, font/media readiness, and stable homologous component roots; clear hover, trigger lazy loading, freeze animation for static capture, and scroll the roots into equivalent positions.
3. Save full-page source and target screenshots from Playwright in the current run.
4. Save source and target region screenshots for every component instance at identical CSS dimensions and native DPR. Source crop is always the live-site instance; target crop is always the corresponding deployed AEM instance.
5. Produce a labeled side-by-side image with `LIVE SITE` on the left and `AEM` on the right, plus a pixel-diff mask derived from those exact two files.
6. Validate both crops before scoring: non-empty, not mostly uniform/blank, expected component text/media present, matching viewport/DPR, matching homologous instance IDs, and comparable dimensions. Emit URL, timestamp, viewport, DPR, file path, byte size, and content-validation result for each crop.
7. Only after Step 6 passes, record matched pixels, differing pixels, total pixels, and `visualMatchPercent`.

Pixel comparison must use homologous non-blank crops. Reject wrong viewport, empty/mostly background crops, mismatched DPR, stale screenshots, different animation frames, and comparisons dominated by whitespace. Property equality never overrides screenshot failure.

### Score Issuance Gate

- Do not calculate, print, estimate, round, or publish a component score until all required live-site and AEM screenshot artifacts for that component and breakpoint pass screenshot validation.
- Before validation, report `SCORE WITHHELD — INVALID OR MISSING SCREENSHOT EVIDENCE`, never a percentage.
- A component score row must cite the live-site image, AEM image, labeled side-by-side image, diff mask, source/target URLs, viewport, DPR, and pixel counts. Missing any field makes the score invalid and withheld.
- `visualMatchPercent` reflects rendered pixels only after crop validation. The component's final score remains the minimum of visual, property/structure, authorability, and media/interaction results.
- A valid score `<=95%` is `FAIL`; update the owning AEM component layer, deploy, recapture both live and AEM evidence, and recompute. Never mark it passed or reuse the old score.
- A component may be marked `PASS` only when the newly captured valid evidence proves its final score is strictly `>95%` and all prerequisite checks pass.

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

## Required Stage Result

Return the orchestrator's required `stage_result` envelope with:

```yaml
stage_result:
	stage: 04-visual-parity
	run_id: <same run_id>
	status: PASS|FAIL|BLOCKED
	inputs_consumed: [01-source-discovery:<result-id>, 02-component-authoring:<result-id>, 03-assets-runtime:<result-id>]
	outputs:
		readiness_matrix: <artifact>
		geometry_property_interaction_tables: <artifacts>
		screenshot_and_diff_index: <artifact>
		per_instance_scores: <artifact>
		component_minima_and_page_composites: <artifact>
		remediation_history: <artifact>
	checks:
		- {name: all_source_blocks_mapped_once, status: PASS|FAIL, evidence: <artifact>}
		- {name: all_geometry_and_properties_pass, status: PASS|FAIL, evidence: <artifact>}
		- {name: all_live_and_aem_screenshot_pairs_valid, status: PASS|FAIL, evidence: <artifact>}
		- {name: all_screenshot_scores_above_95, status: PASS|FAIL, evidence: <artifact>}
		- {name: all_interactions_and_media_pass, status: PASS|FAIL, evidence: <artifact>}
		- {name: all_final_minima_and_composites_above_95, status: PASS|FAIL, evidence: <artifact>}
	failures: []
	next_stage: 05-completion-output
```

Do not return `PASS` for partial breakpoints, selected components, invalid/blank crops, missing artifacts, exactly 95%, or averaged-away failures. Remediate and rerun this stage until it passes.
