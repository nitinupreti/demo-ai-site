# Visual Parity Gate

This file owns component scoring, exact checks, screenshots, interaction comparison, anti-gaming rules, and remediation. Run it in the same migration run as every appearance/behavior deploy.

## MUST — Deterministic Parity Runner

A permanently frozen harness is not required. Reproducible inputs, capture behavior, and scoring are required. Choose exactly one runner path before the first baseline:

1. an existing project Playwright visual-test runner; or
2. a generated Node.js runner stored under `<EVIDENCE_DIR>/parity/runner/`.

The selected runner MUST:

- consume Stage 1 source instance selectors, Stage 2 target selectors, URLs, and all observed breakpoints from a run-specific config; do not rely on a fixed component list;
- use Playwright/Chromium and `locator.screenshot()` for homologous component-instance crops;
- capture full-page source and target screenshots;
- use `pixelmatch` with `pngjs` or `sharp` for pixel counts, diff masks, and labelled side-by-side images;
- emit the screenshot-validation metadata and score fields required below as machine-readable JSON;
- keep credentials in environment variables, not committed config; and
- write all generated files only under `<EVIDENCE_DIR>/parity/`.

Before accepting the first score, run a preflight against one component at every breakpoint and prove: both selectors resolve to the intended instance, final URLs and viewport/DPR are recorded, fonts and media are ready, crops are non-blank, dimensions are comparable, and all required artifacts exist. If the selected runner cannot pass this preflight, repair it or choose the other permitted runner path before scoring.

After preflight, record SHA-256 hashes for the runner, run config, and dependency lockfile. These files are frozen only for the current baseline/remediation run. A necessary runner or config change creates a new runner revision, invalidates all scores produced by the old revision, and requires recapture of every affected component and breakpoint. Manual clipping, DOM serialization, CSS-only comparison, and scores from mixed runner revisions are invalid.

## MUST — Diagnose Before Edit

Every Round 1 attempt 1 for every failing component MUST begin with a live-DOM diagnostic pair captured by an equivalent command from the selected runner:

- MUST run the selected diagnostic command for the failing instance and breakpoint and copy the resulting `deltas` block into `remediation_history` before touching any CSS/HTL/model file.
- MUST base attempt 1 edits on the reported deltas (`fontFamily`, `fontSize`, `lineHeight`, `padding`, `backgroundColor`, `gridTemplateColumns`, etc.), not on plausible-looking values inferred from class names.
- If the diagnostic reports `deltas.rect.w != 0` or `deltas.rect.h != 0`, attempt 1 MUST address the geometry gap (container/grid/full-bleed) before typography or color.
- MUST run the diagnostic again before every subsequent attempt to a component that regressed relative to its previous best score. Consecutive regressions with no refreshed diagnostic are treated as unrecorded attempts.
- If either selector returns no element or resolves to the wrong instance, do not edit component code. Correct the owning Stage 1/2 selector artifact, create a new runner revision, rerun preflight, and recapture affected scores.

## MUST — Broad Fix Batches (working-set discipline)

The Remediation Loop SHOULD resolve multiple diagnosed component failures in one build/deploy cycle. Form a batch from non-conflicting fixes that share an owning layer or deployable module; do not force one build per component.

- Every component in a batch MUST have current diagnostic evidence and one falsifiable root-cause hypothesis. A shared hypothesis is permitted only when it names the common owning rule and every affected component.
- A batch MAY touch each included component's `_cq_dialog`, HTL, Sling Model, clientlib, authored content, and assets. Keep unrelated components and speculative refactors out.
- Run focused tests for all touched models/components, then build and deploy each affected module exactly once in dependency order. Never run concurrent installs against one AEM instance.
- After deployment, recapture every component changed by the batch plus every component potentially affected by shared container, template, token, or clientlib files. Never hide a regression behind aggregate improvement.
- A batch consumes one retry attempt for each component whose owning files changed; components included only for regression recapture do not consume an attempt.

## MUST — One Hypothesis Per Component

Each component changed in a batch MUST test one falsifiable root-cause hypothesis, such as wrong container geometry, wrong authored structure, wrong typography, or wrong asset behavior.

- Before editing, record the component, hypothesis, diagnostic evidence, owning layer, expected score movement, and cheapest falsifying validation under the batch ID.
- Edit the smallest coherent file set required to test all batch hypotheses. File count does not override correctness; record why cross-file or cross-component edits belong in the same build.
- After editing, run the batch's focused validations, one scoped deployment sequence, and fresh parity capture before starting another batch.
- If one component's expected movement does not occur, mark only that hypothesis falsified; retain valid improvements for other components and use fresh evidence for the next batch.

## MUST — Persist Attempt State

Keep `<EVIDENCE_DIR>/run-state.json` as the source of truth for remediation state. Before each attempt, read and validate the current component row, attempt count, latest scores, runner revision, and latest diagnostic.

- Before editing, append a `BATCH_STARTED` entry with `batch_id`, affected components, per-component round/attempt/hypothesis, owning layers, diagnostic artifacts, expected movements, and runner revision.
- After recapture, append `BATCH_FINISHED` with shared validation/deploy evidence, timestamp, files changed, and per-component scores/status at every breakpoint.
- In chat, report only the active batch, included components, hypotheses, and results. Do not reprint the full history or score matrix; Stage 5 reads the persisted artifacts.
- An attempt missing either state entry is invalid and must not consume a retry slot until its evidence is repaired.

## Stage Execution Contract

- Inputs: accepted Stages 1-3 results, frozen denominators, Stage 1 source selector map, Stage 2 target selector map verified by Stage 3, deployed target URLs, and the same `run_id`.
- Execute the full Playwright comparison at every breakpoint for every block/instance. Do not substitute CSS declarations or selected properties for rendered evidence.
- Required outputs: readiness matrix, per-instance geometry/property/interaction tables, full and component screenshots, side-by-side/diff artifacts, scores, remediation history, and final minima/composites.
- Passing gate: all prerequisites pass and every raw instance, component-type minimum, and page composite is strictly above 90% at every breakpoint. After bounded retries, Stage 4 may terminate with `FAIL`; that terminal result permits Stage 5 reporting but never completion.

## Readiness And Scope

Use real Playwright/Chromium for the live source, disabled target, and author target at every required breakpoint. Assert that the live source fingerprint still matches Stage 1, then assert identical CSS viewport, DPR/scale, font readiness, media decode, motion state, and stable geometry before capture. Source drift invalidates affected Stage 1 evidence; other readiness failures block scoring.

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
4. Save source and target region screenshots for every component instance at native DPR. Source crop is always the live-site instance; target crop is always the corresponding deployed AEM instance.
5. Produce a labeled side-by-side image with `LIVE SITE` on the left and `AEM` on the right, plus a pixel-diff mask derived from those exact two files.
6. Validate both crops before scoring: non-empty, not mostly uniform/blank, expected component text/media present, matching viewport/DPR, matching homologous instance IDs, and identical pixel dimensions. Do not resize, stretch, or pad unequal crops; withhold the score and remediate geometry instead. Emit URL, timestamp, viewport, DPR, file path, byte size, dimensions, and content-validation result for each crop.
7. Only after Step 6 passes, record matched pixels, differing pixels, total pixels, and unrounded `visualMatchRatio`; derive `visualMatchPercent` only for display.

Pixel comparison must use homologous non-blank crops. Reject wrong viewport, empty/mostly background crops, mismatched DPR, stale screenshots, different animation frames, and comparisons dominated by whitespace. Property equality never overrides screenshot failure.

### Score Issuance Gate

- Do not calculate, print, estimate, round, or publish a component score until all required live-site and AEM screenshot artifacts for that component and breakpoint pass screenshot validation.
- Before validation, report `SCORE WITHHELD — INVALID OR MISSING SCREENSHOT EVIDENCE`, never a percentage.
- A component score row must cite the live-site image, AEM image, labeled side-by-side image, diff mask, source/target URLs, viewport, DPR, runner revision, and pixel counts. Missing any field makes the score invalid and withheld.
- `visualMatchPercent` reflects rendered pixels only after crop validation. Determine pass/fail from the unrounded ratio (`matchedPixels / totalPixels > 0.90`), then round only the displayed percentage. The component's final score remains the minimum of visual, property/structure, authorability, and media/interaction results.
- A valid unrounded ratio `<= 0.90` is `FAIL`; update the owning AEM component layer, deploy, recapture both live and AEM evidence, and recompute. Never mark it passed or reuse the old score.
- A component may be marked `PASS` only when the newly captured valid evidence proves its final score is strictly `>90%` and all prerequisite checks pass.

## Interaction Gate

For every source hover/focus/active/transition role, use real pointer/keyboard events and capture before/after computed styles, nested icon transforms, and screenshots. Compare color, background, border, shadow, opacity, transform, and decoration. Capture one full carousel transition or marquee/ticker animation cycle. Skip hover only when source explicitly gates it off for non-hover input.

## Scores And Threshold

Calculate frozen weighted axis scores from `01-source-discovery.md`. Instance score is the weighted sum; component-type score is its minimum instance, not an average. Final component status is the minimum of:

- weighted property/structure score;
- `visualMatchPercent`;
- authorability score;
- media/interaction prerequisites.

Every raw instance, component-type minimum, and page composite must be strictly `>90%`; exactly 90% fails. A high page average cannot hide a failed component or axis.

## Remediation Loop

The loop is bounded: **4 attempts per failing component** total — 3 consecutive in Round 1, 1 final in Round 2.

**Round 1 — broad batches, capped at 3 attempts per component.**

For each batch of failing components grouped by owning layer/module:

1. Keep each included component FAILED and enumerate its screenshot / geometry / property / interaction / media / authorability / asset gaps.
2. Trace each gap to discovery/content, dialog, model, HTL, CSS/token, container/template, behavior, or asset ownership.
3. Fix all non-conflicting diagnosed gaps in the batch. Run focused validation for every touched component, then scoped-deploy each affected module once per [03-assets-runtime.md](03-assets-runtime.md).
4. Recapture source and target with fresh `locator.screenshot()` for every changed or potentially affected component and rescore only refreshed evidence.
5. Mark each component independently: `PASS` when it crosses `>90%` at every breakpoint; otherwise increment only that component's attempt counter.
6. On a component's **3rd** failed Round 1 batch, mark it `FAILED-ROUND-1`. Other components in the same batch continue according to their own counters.

**Round 2 — one final pass.**

After every failing component has consumed Round 1, group the components still marked `FAILED-ROUND-1` by owning layer and run **exactly one** final broad pass:

1. Apply the largest still-open gap identified in Round 1 (structural, not cosmetic).
2. Validate all touched components, scoped-deploy each affected module once, then recapture every changed or potentially affected component with fresh `locator.screenshot()`.
3. Evaluate each component independently. If it crosses `>90%` at every breakpoint, mark `PASS`; otherwise mark `FAILED-FINAL` and stop attempting it.

**Termination.** The loop ends when every failing component is either `PASS` or `FAILED-FINAL`. Do not enter a Round 3. Do not re-open a component already at `FAILED-FINAL`. If any component is `FAILED-FINAL`, this stage returns `FAIL`; Stage 5 reports the incomplete run and must not claim completion.

**Terminal status.** Return `BLOCKED` only when an external prerequisite remains unavailable after retry, such as an unreachable source URL or stopped AEM instance. Return `FAIL` for repairable runner/configuration defects, selector mistakes, invalid evidence, or components that reach `FAILED-FINAL`. Never classify a local code or configuration defect as `BLOCKED`.

**Attempt ledger.** Every batch MUST be appended to `remediation_history` with `batch_id`, affected components, shared validation/build/deploy evidence, and timestamp. Each changed component also records round, attempt-in-round, hypothesis, owning layer, files changed, and new `visualMatchPercent` per breakpoint. An unrecorded component attempt is treated as not run.

**Escalation inside Round 1.** If the same gap fails to close on 2 consecutive attempts, do not spend attempt 3 on more CSS tuning. Return to Stage 1 and reassess the component's block boundary, structure, or reuse tier decision; attempt 3 must act on that reassessment. Record the reassessment in the `design-facts` block.

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
    parity_runner: <path, revision, hashes, preflight artifact>
  checks:
    - {name: all_source_blocks_mapped_once, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_geometry_and_properties_pass, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_live_and_aem_screenshot_pairs_valid, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_screenshot_scores_above_90, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_interactions_and_media_pass, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_final_minima_and_composites_above_90, status: PASS|FAIL, evidence: <artifact>}
  failures: []
  next_stage: 05-completion-output
```

Do not return `PASS` for partial breakpoints, selected components, invalid/blank crops, missing artifacts, exactly 90%, averaged-away failures, or any `FAILED-FINAL` component. Remediate within the bounded loop, then return the truthful terminal status.
