# Visual Parity Gate

Owns screenshot scoring, comparisons, and bounded remediation. Entry requires accepted Stage 1–3 results, frozen denominators, verified source/target selector maps, deployed URLs, and the same `run_id`. Execute [capture gates](references/capture-gates.md) freshly before EVERY measurement/capture, at the page-state scope they define. Validate source, disabled target, and author target at every runtime breakpoint; measure author page content, not editor chrome.

## Deterministic Runner

Use the bundled [parity runner](tools/parity-runner.mjs) unless this run proves it insufficient; otherwise select another existing project Node.js Playwright/Chromium runner or create one under `<EVIDENCE_DIR>/parity/runner/`. Whichever is used must:

- Consume run-specific selectors, instance IDs, URLs, target modes, and breakpoints; no fixed component list.
- Use `locator.screenshot()` for homologous instance crops, `page.screenshot({ fullPage: true })` for complete documents, and `pixelmatch` with `pngjs` or `sharp` for counts, diff masks, and labeled side-by-side images at BOTH levels.
- Navigate once per (mode, breakpoint) page state and take every instance crop from that one loaded state; re-navigating per instance is waste, not rigor.
- Capture only the requested instance subset when remediation recaptures an affected set, and run independent breakpoint/mode contexts with bounded concurrency.
- Emit machine-readable validation/score records; keep credentials in environment variables and generated files under `<EVIDENCE_DIR>/parity/`.

Preflight one component at EVERY breakpoint in BOTH target modes: selectors/signatures resolve correctly, URLs/viewport/DPR match, fonts/media/geometry are ready, crops are comparable and nonblank, artifacts exist. Repair preflight before scoring.

After preflight and before the full instance sweep, run one diagnostic full-page comparison at the largest required breakpoint in `disabled` mode. A systemic geometry, token, or container failure is far cheaper to fix there than after capturing every instance at every breakpoint in both modes. This ordering is diagnostic only: it never substitutes for, reduces, or pre-satisfies the complete score matrix or the independent final full-page gate below.

Freeze SHA-256 hashes of runner, config, and dependency lockfile after preflight. Necessary changes create a new revision: invalidate old-revision scores, rerun preflight, and recapture affected components/breakpoints/modes. No mixed-revision scores; unaffected artifacts need explicit revalidation/provenance under the new revision. Manual clipping, DOM serialization, and CSS-only comparisons are not screenshot evidence.

Record pixelmatch options (threshold, includeAA, masks/exclusions) in frozen config. Do not relax them to improve a score or because `MODEL`/`THINKING_EFFORT` changed; no masking of required content or mismatches.

## Systemic Alignment Before Scoring

A shared-rule edit consumes one attempt from EVERY component it affects, so remove shared causes before any component holds a failing score.

1. After preflight, diff computed styles and geometry between each mapped source root and its target owner at one required breakpoint.
2. Fix only the shared causes: font stack and loaded faces, base spacing scale, container width and gutters, color tokens, and page-level layout containers.
3. Deploy that alignment once through [Stage 3](03-assets-runtime.md), then begin scoring.

Exactly one alignment batch with one deployment is permitted, and it consumes no attempt because no component has a failing score yet. Anything beyond it is remediation and consumes attempts normally. This pass never substitutes for a comparison, a gate, or a score.

## Exact Checks And Interaction

Verify the live source fingerprint against Stage 1; source drift returns to discovery. Source captures then stay valid for the rest of the run while that fingerprint re-verifies unchanged and the breakpoint, viewport, DPR, pixelmatch configuration, and runner revision are all unchanged, so remediation recaptures the target only; any drift, configuration change, or new runner revision invalidates them and forces a fresh source capture. Map each source instance exactly once to its intended target owner; missing, duplicated, orphaned, wrongly combined/split regions fail. Verify intentional hidden states rather than scoring empty crops.

Record source/target raw rectangles and deltas, full-bleed flags, typography, and exhaustive spacing using capture gates; no relaxed height allowance. Compare ALL frozen roles: exact RGBA colors (Delta E <=3 only for antialiased/compressed raster pixels), backgrounds, borders/radii/shadows/opacity, flex/grid/display/position/overflow/fit/aspect, counts/order/semantics/attributes/behavior. Token declarations and deployed resolved values must agree. Section/CTA background, foreground, border, and radius mismatches are hard failures.

For every source hover/focus/active/transition role, use real pointer/keyboard events; capture before/after computed styles, nested icon transforms, and screenshots. Compare color/background/border/shadow/opacity/transform/decoration. Capture a complete carousel transition or marquee/ticker cycle. Skip hover only when the source gates it off for non-hover input. Verify playback separately per capture gates.

## Screenshot Gate

For EVERY instance, breakpoint, and target mode:

1. Navigate to the exact live `SITE_URL` and deployed AEM page; record final URLs. No local source copy, historical screenshot, mock, or CSS preview. Match viewport/DPR/scale, clear hover, trigger lazy loading, prepare media, freeze motion, and scroll homologous roots equivalently.
2. Save current-run full-page source/target and native-DPR instance locator screenshots. Generate `LIVE SITE` (left) / `AEM` (right) side-by-side and diff mask from those EXACT files.
3. Validate non-empty/non-uniform crops with expected text/media, matching instance IDs/viewport/DPR, and IDENTICAL pixel dimensions. Never resize, stretch, or pad unequal crops; withhold scores and repair geometry.
4. Only after validation record `matchedPixels`, `differingPixels`, `totalPixels`, unrounded `visualMatchRatio = matchedPixels / totalPixels`, and display-only `visualMatchPercent`.

Use `<EVIDENCE_DIR>/parity/evidence/<mode>/` (`disabled`, `author`). Names: `full-<bp>-source.png`, `full-<bp>-target.png`, and `<instance>-<bp>-{source,target,side-by-side,mask}.png`. Keep mode-specific source captures to prevent overwrites.

Each score row MUST cite: instance/breakpoint/mode, source/target final URLs, timestamp, viewport, DPR/scale, runner revision, both screenshot paths, bytes/dimensions/content-validation result, side-by-side, diff mask, readiness evidence, and pixel counts. Invalid/missing fields mean `SCORE WITHHELD — INVALID OR MISSING SCREENSHOT EVIDENCE` (use the video-specific reason when applicable); omit ALL numeric scores. Reject stale/wrong-instance/whitespace-dominated crops and mismatched animation frames. No estimates or hand-picked subsets.

## Independent Full-Page Gate

After the final appearance/behavior deployment and component recaptures, compare complete live `SITE_URL` and deployed AEM authored-page documents at EVERY breakpoint in BOTH modes. Record the AEM editor URL and actual content-frame URL; capture the authored document, never substitute editor chrome or a cropped viewport.

Rerun capture readiness across the entire page, trigger all lazy regions, align scroll/sticky/overlay/media states, then take fresh full-page images. Validate equal native pixel dimensions and full document coverage before independently running pixelmatch over ALL page pixels. No component-average substitute, stitching component crops, resizing, padding, truncation, or hiding regions. Unequal page heights withhold the score and require geometry remediation.

Save `full-<bp>-side-by-side.png` and `full-<bp>-mask.png` beside the source/target pair. Persist `full_page_scores` with the same validation/URL/pixel metadata as component rows, plus final deployment revision and `fullPageVisualMatchRatio`. Require its unrounded ratio strictly `> 0.90`, independently of every component score. Missing/invalid full-page evidence blocks PASS even when all components pass. A new deployment invalidates this final comparison.

Trace page-only failures to existing owning components/containers/shared files and their bounded attempt ledger; never reset retries or create an unbounded page-fix loop. Unresolved full-page failures remain in Stage 5 residual gaps.

## Scores

Use Stage 1 frozen axes and weights; do not redefine denominators here. Instance property score is their weighted sum. Final instance score is the minimum of property/structure, valid screenshot score, authorability, and media/interaction results; hard gates still apply. Type score is its minimum instance, not an average. Record page composites and cross-breakpoint/mode minima with their calculation inputs.

Every raw instance, type minimum, and page composite must meet the router's strict unrounded ratio. Exactly 90% fails. No high average may hide a failing component/axis or missing asset, interaction, authorability, exact property, or geometry check. User rejection invalidates affected evidence.

## Failure-Only LLM Handoff

- Run ALL required comparisons locally; the runner computes scores, never the LLM. Retain native screenshots, full metrics/DOM, and logs on disk. Tool stdout returns compact JSON: status/counts, artifact paths, and active-batch failure rows with instance/breakpoint/mode, failed checks, valid ratio or withheld reason, property/geometry deltas, owning files, and retries remaining.
- Load only failing, withheld, or regressed component side-by-sides and relevant diagnostics/code into model context. Passing images stay on disk unless preflight, validation uncertainty, or user rejection requires review. Do not dump entire DOMs, logs, image base64, or unchanged passing evidence into chat.
- For full-page failure triage, use a diagnostic-only reduced overview and differing-region crops linked to original coordinates. NEVER score these derivatives: full-page scoring still uses unchanged native originals and ALL page pixels.
- This filters LLM input, not coverage or acceptance. Shared fixes still require every affected comparison and the final full-page gate.

## Bounded Remediation Loop

Use the router's per-component cap across the ENTIRE run: Round 1 has three attempts; Round 2 one final attempt. Counters never reset on stage returns, compaction, runner changes, or regressions.

### Each Batch (single procedure for both rounds)

One batch per round covers EVERY component with a current failure whose fixes do not conflict. Opening a batch per component multiplies builds, deploys, and recaptures without improving any gate. Split a round into more than one batch only when two fixes genuinely conflict in the same file region, and record that conflict.

1. Read current `run-state.json` component rows: counters, best/latest scores, runner revision, diagnostics. Capture a live source/target diagnostic pair and persist `deltas` BEFORE edits; refresh after any regression. Wrong/missing selector returns to its Stage 1/2 owner, not speculative CSS.
2. Group non-conflicting fixes by owning layer/module. For EACH changed component, record one falsifiable hypothesis, diagnostic, layer trace (discovery/content/dialog/model/HTL/CSS-token/container-template/behavior/asset), expected movement, cheapest falsifying validation, and files. A shared hypothesis must name the common rule and all affected components. Nonzero width/height deltas take priority over typography/color in attempt 1.
3. Append `BATCH_STARTED` to `remediation_history` with `batch_id`, affected/regression-only components, round/attempt per changed component, hypotheses, diagnostics, and revision. Apply the smallest coherent file set; no unrelated refactors.
4. Run focused checks, then [Stage 3 scoped deployment and runtime sweep](03-assets-runtime.md), once per affected module in dependency order. Recapture fresh source/target evidence for every changed component AND anything potentially affected by shared files.
5. Append `BATCH_FINISHED`: timestamp, changed files, shared validation/build/deploy evidence, and each component's new valid scores (or withheld reason) by breakpoint/mode. Mark a non-improving hypothesis falsified without discarding other components' valid improvements.

Each component whose owning files changed consumes one attempt, including shared-rule edits affecting it; regression-only recaptures consume none. Missing ledger entries invalidate the attempt evidence: repair them BEFORE further edits, never obtain extra attempts by losing a record. Chat reports only active batch decisions/results, not the full ledger.

### Rounds And Termination

- Round 1: passing components become PASS at all breakpoints/modes; the third failed attempt becomes `FAILED-ROUND-1`. After two consecutive failures on the same gap, reassess its owning structure/reuse layer before attempt 3, updating `design-facts`. Return to Stage 1 only if discovery is invalid.
- Once Round 1 is finished for all failures, group `FAILED-ROUND-1` components for one final Round 2 pass addressing each largest remaining structural gap. Then mark PASS or `FAILED-FINAL` independently.
- Stop when every failure is PASS or `FAILED-FINAL`. No Round 3, no reopening `FAILED-FINAL`. Any such row makes Stage 4 FAIL; always proceed to Stage 5.
- External prerequisites unavailable after retry may yield BLOCKED. Local runner/config/selector/evidence defects are FAIL, not external blockers; repair before scoring. Never fabricate percentages to close an invalid row.

## Required Stage Result

Persist the shared envelope with `stage: 04-visual-parity`, Stage 1–3 result IDs, and:

- **outputs:** `readiness_matrix`, `geometry_property_interaction_tables`, `screenshot_and_diff_index`, `per_instance_scores`, `full_page_scores`, `component_minima_and_page_composites`, `remediation_history`, `parity_runner` (path/revision/hashes/preflight).
- **checks:** `all_source_blocks_mapped_once`, `all_geometry_and_properties_pass`, `all_live_and_aem_screenshot_pairs_valid`, `all_screenshot_scores_above_90`, `all_full_page_pairs_valid`, `all_full_page_scores_above_90`, `all_interactions_and_media_pass`, `all_final_minima_and_composites_above_90`.
- **next_stage:** `05-completion-output` for every terminal status.

PASS requires all instances/modes/breakpoints and exact gates, valid current-run screenshots, strict minima/composites, and zero residual gaps.