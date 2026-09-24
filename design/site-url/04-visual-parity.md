# Visual Parity Gate

This file owns component scoring, exact checks, screenshots, interaction comparison, anti-gaming rules, and remediation. Run it in the same migration run as every appearance/behavior deploy.

## MUST — Frozen Parity Runner

`design/site-url/tools/parity.mjs` is the only permitted scorer. Do not select, generate, fork or patch a runner.

```powershell
node design/site-url/tools/parity.mjs --config <EVIDENCE_DIR>/parity/parity-config.json --out <EVIDENCE_DIR>/parity
```

Your only authoring task is the run config, built from Stage 1 source selectors and Stage 2 target selectors:

```jsonc
{
  "run_id": "<RUN_ID>",
  "source_url": "<SITE_URL>",
  "targets": [{ "mode": "disabled", "url": "http://<AEM_HOST>:<AEM_PORT>/<page>.html?wcmmode=disabled" }],
  "breakpoints": [375, 768, 1440],
  "threshold": 0.9,
  "auth": { "username": "admin", "password_env": "AEM_PASSWORD" },
  "components": [{
    "id": "<component-id>",
    "source": { "css": "<stage 1 selector>", "match_index": 0 },
    "target": { "css": "<stage 2 selector>", "match_index": 0 },
    "signature_text": "<first words of the instance>",
    "visibility_by_bp": { "375": true, "768": true, "1440": true }
  }]
}
```

Credentials come from the environment variable named by `password_env`; never write a password into the config. The tool records `runner_revision` as a hash of its own sources plus the config, so a config change invalidates earlier scores and requires recapture.

The runner already enforces, identically on both sides: exact viewport and DPR, forced light colour scheme, fixed locale and timezone, lazy-load and dynamic-injection settle, `document.fonts.ready`, image decode, video decode with a deterministic seek, motion freeze, and three stable-geometry samples 500 ms apart. If a capture fails readiness, every score for that breakpoint is withheld rather than reported.

## MUST — Read The Verdict, Never Restate It

`parity.json` is the single source of truth for scores. Copy values from it; do not recompute, round up, average, or describe a score the tool did not emit. When a score is `WITHHELD`, report `SCORE WITHHELD` with the tool's reason — never a percentage.

## MUST — Diagnose Before Edit

Every Round 1 attempt 1 for every failing component MUST begin with the tool's own deltas for that instance and breakpoint:

- MUST copy the component's `deltas` block from `parity.json` into `remediation_history` before touching any CSS/HTL/model file.
- MUST base attempt 1 edits on the reported deltas. `deltas.hot_regions` names the exact target elements under the differing pixels; `owning_layer_hint` names the layer that owns the failure. Use them instead of plausible-looking values inferred from class names.
- If `deltas.rect.w` or `deltas.rect.h` is non-zero, or the result reports `dimension_mismatch`, attempt 1 MUST address the geometry gap (container/grid/full-bleed) before typography or colour.
- MUST rerun the tool before every subsequent attempt to a component that regressed relative to its previous best score. Consecutive regressions with no refreshed run are treated as unrecorded attempts.
- If either selector returns no element or resolves to the wrong instance, do not edit component code. Correct the owning Stage 1/2 selector artifact, update the run config, and rerun.

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

- Inputs: accepted Stages 1-3 results, frozen denominators, the Stage 1 source selector map from `discovery.json`, the Stage 2 target selector map verified by Stage 3, deployed target URLs, and the same `run_id`.
- Build the parity run config, run `parity.mjs` at every breakpoint for every instance, and read its verdict. Do not substitute CSS declarations or selected properties for rendered evidence.
- Required outputs: `parity/parity.json`, its preflight block, per-instance geometry/property/gate tables, full and component screenshots, side-by-side/diff artifacts, scores, and remediation history.
- Passing gate: all prerequisites pass, and every raw instance, component-type minimum and page composite is strictly above the run's pass ratio at every breakpoint. Structured match gates are advisory and never block. After bounded retries, Stage 4 may terminate with `FAIL`; that terminal result permits Stage 5 reporting but never completion.

## The Pass Ratio Is Per Run

The bar is not a constant. The orchestrator derives it from the reasoning effort the run was given and writes it to `parity-config.json`; `parity.json` echoes it back as `threshold`. Cheap reasoning is for iterating on structure, not for certifying fidelity, so a low-effort run may not claim the same result as a full one.

| Effort | Pass ratio |
|---|---:|
| `max`, `xhigh` | `> 0.90` |
| `high`, model-managed | `> 0.85` |
| `medium` | `> 0.75` |
| `low`, `minimal`, `none` | `> 0.55` |

`--visual-pass-ratio` pins an explicit value and overrides the effort mapping. **Read the threshold from the current run's `parity.json`; never assume a number.** Everywhere this document says "the threshold", it means that value.

## Readiness And Scope

Scoring covers the live source, disabled target, and author target at every required breakpoint. Assert that `discovery.json`'s `source_fingerprint` still matches Stage 1 before trusting a comparison; the runner then enforces identical CSS viewport, DPR/scale, colour scheme, font readiness, media decode, motion state, and stable geometry before capture. Source drift invalidates affected Stage 1 evidence; other readiness failures withhold scores rather than producing them.

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

`parity.mjs` performs every step below at every breakpoint. Your obligation is to confirm the artifacts exist in `parity.json` and to cite them; never substitute a manual capture.

1. One page navigates to the exact live `SITE_URL` and a second to the deployed AEM disabled URL, recording both final URLs after redirects. A local copy, cached historical image, CSS preview, or authored mock is not a source substitute.
2. Both pages assert the requested `window.innerWidth`, DPR, `visualViewport.scale`, font and media readiness, and stable homologous roots; motion is frozen and lazy loading triggered before capture.
3. Full-page source and target screenshots are saved for the current run.
4. Region screenshots are saved for every component instance at native DPR — source crop from the live site, target crop from the deployed AEM instance.
5. A labelled side-by-side image is produced with `LIVE SITE` on the left and `AEM` on the right, plus a pixel-diff mask derived from those exact two files.
6. Both crops are validated before scoring: non-empty, not mostly uniform, matching viewport/DPR, matching homologous instance, and identical pixel dimensions. Unequal crops are never resized, stretched or padded; the authoritative score is withheld, the status is `FAIL`, and an overlap diagnostic plus `dimension_mismatch` is reported so the geometry gap is actionable.
7. Only after validation passes are matched pixels, differing pixels, total pixels and the unrounded `visual_match_ratio` recorded. `visual_match_percent` is derived for display only.

Pixel comparison uses homologous non-blank crops. Wrong viewport, empty crops, mismatched DPR, stale screenshots and different animation frames are rejected by the tool. Property equality never overrides screenshot failure.

### Score Issuance Gate

- Do not calculate, print, estimate, round, or publish a component score until all required live-site and AEM screenshot artifacts for that component and breakpoint pass screenshot validation.
- Before validation, report `SCORE WITHHELD — INVALID OR MISSING SCREENSHOT EVIDENCE`, never a percentage.
- A component score row must cite the live-site image, AEM image, labeled side-by-side image, diff mask, source/target URLs, viewport, DPR, runner revision, and pixel counts. Missing any field makes the score invalid and withheld.
- `visualMatchPercent` reflects rendered pixels only after crop validation. Determine pass/fail from the unrounded ratio (`matchedPixels / totalPixels > threshold`), then round only the displayed percentage. The component's final score remains the minimum of visual, property/structure, authorability, and media/interaction results.
- A valid unrounded ratio `<=` the threshold is `FAIL`; update the owning AEM component layer, deploy, recapture both live and AEM evidence, and recompute. Never mark it passed or reuse the old score.
- A component may be marked `PASS` only when the newly captured valid evidence proves its final score is strictly above the threshold and all prerequisite checks pass.

## Interaction Gate

For every source hover/focus/active/transition role, use real pointer/keyboard events and capture before/after computed styles, nested icon transforms, and screenshots. Compare color, background, border, shadow, opacity, transform, and decoration. Capture one full carousel transition or marquee/ticker animation cycle. Skip hover only when source explicitly gates it off for non-hover input.

## Scores And Threshold

Calculate frozen weighted axis scores from `01-source-discovery.md`. Instance score is the weighted sum; component-type score is its minimum instance, not an average. Final component status is the minimum of:

- weighted property/structure score;
- `visualMatchPercent`;
- authorability score;
- media/interaction prerequisites.

Every raw instance, component-type minimum, and page composite must be strictly above the run's threshold; a ratio exactly equal to it fails. A high page average cannot hide a failed component or axis.

## Structured Match Gates

`parity.mjs` emits a `gates` object per instance. **These gates are advisory: they are recorded for diagnosis and never decide the verdict.** They pair nodes positionally by `tag[ordinal]`, so a single added or removed wrapper misaligns the whole subtree and reports every node after it as a colour and spacing defect. Read them to locate a real defect, not to decide whether one exists.

| Gate | Compared for every text role and layout child | Failure means |
|---|---|---|
| `typography` | `fontFamily` stack, `fontSize`, `fontWeight`, `fontStyle`, `lineHeight`, `letterSpacing`, `wordSpacing`, `textTransform`, `textDecorationLine`, `textAlign`, `whiteSpace` | wrong face, size, weight or leading |
| `color` | font `color`, `backgroundColor`, `backgroundImage`/`Size`/`Position`/`Repeat`, all four border colours, `outlineColor`, `boxShadow`, `textShadow`, `opacity`, `textDecorationColor` | wrong token or hardcoded value |
| `spacing` | all four margins and paddings, `rowGap`/`columnGap`, border widths, `display`, flex/grid properties, and each child's position and size within the component | box-model or layout drift beyond 1 CSS px |
| `images` | resolved source, load state, intrinsic width/height, rendered box, `objectFit`, `objectPosition`, `borderRadius`, `alt` | missing, substituted, unloaded, or re-proportioned image |
| `svg` | `viewBox`, path/shape geometry hash, shape count, `fill`, `stroke`, `color`, `strokeWidth`, rendered box | redrawn, approximated or recoloured inline SVG |
| `glyph_substitutions` | icon-shaped characters in target text that the source does not have | a Unicode glyph used instead of a real icon asset |
| `structure` | direct child element sequence of the component root | regions combined, split or reordered |
| `rendered_fonts` | platform fonts actually rasterised, read over CDP | a declared family that silently fell back |

The tool reports each failure with the owning selector, the property, and both values, so remediation edits the exact declaration that differs rather than guessing. Confirm a reported gate delta against the screenshots before acting on it: a node-pairing shift fabricates deltas on elements that are in fact correct.

## Remediation Loop

The loop is bounded: **4 attempts per failing component** total — 3 consecutive in Round 1, 1 final in Round 2.

**Round 1 — broad batches, capped at 3 attempts per component.**

For each batch of failing components grouped by owning layer/module:

1. Keep each included component FAILED and enumerate its screenshot / geometry / property / interaction / media / authorability / asset gaps.
2. Trace each gap to discovery/content, dialog, model, HTL, CSS/token, container/template, behavior, or asset ownership.
3. Fix all non-conflicting diagnosed gaps in the batch. Run focused validation for every touched component, then scoped-deploy each affected module once per [03-assets-runtime.md](03-assets-runtime.md).
4. Recapture source and target with fresh `locator.screenshot()` for every changed or potentially affected component and rescore only refreshed evidence.
5. Mark each component independently: `PASS` when it crosses the threshold at every breakpoint; otherwise increment only that component's attempt counter.
6. On a component's **3rd** failed Round 1 batch, mark it `FAILED-ROUND-1`. Other components in the same batch continue according to their own counters.

**Round 2 — one final pass.**

After every failing component has consumed Round 1, group the components still marked `FAILED-ROUND-1` by owning layer and run **exactly one** final broad pass:

1. Apply the largest still-open gap identified in Round 1 (structural, not cosmetic).
2. Validate all touched components, scoped-deploy each affected module once, then recapture every changed or potentially affected component with fresh `locator.screenshot()`.
3. Evaluate each component independently. If it crosses the threshold at every breakpoint, mark `PASS`; otherwise mark `FAILED-FINAL` and stop attempting it.

**Termination.** The loop ends when every failing component is either `PASS` or `FAILED-FINAL`. Do not enter a Round 3. Do not re-open a component already at `FAILED-FINAL`. If any component is `FAILED-FINAL`, this stage returns `FAIL`; Stage 5 reports the incomplete run and must not claim completion.

**Terminal status.** Return `BLOCKED` only when an external prerequisite remains unavailable after retry, such as an unreachable source URL or stopped AEM instance. Return `FAIL` for repairable runner/configuration defects, selector mistakes, invalid evidence, or components that reach `FAILED-FINAL`. Never classify a local code or configuration defect as `BLOCKED`.

**Attempt ledger.** Every batch MUST be appended to `remediation_history` with `batch_id`, affected components, shared validation/build/deploy evidence, and timestamp. Each changed component also records round, attempt-in-round, hypothesis, owning layer, files changed, and new `visualMatchPercent` per breakpoint. An unrecorded component attempt is treated as not run.

**Escalation inside Round 1.** If the same gap fails to close on 2 consecutive attempts, do not spend attempt 3 on more CSS tuning. Return to Stage 1 and reassess the component's block boundary, structure, or reuse tier decision; attempt 3 must act on that reassessment. Record the reassessment in the `design-facts` block.

## Anti-Gaming Rules

- A score above the threshold requires raw source/target evidence and valid screenshots.
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
    parity_artifact: <EVIDENCE_DIR>/parity/parity.json
    parity_runner_revision: <runner_revision from parity.json>
    screenshot_and_diff_index: <artifact>
    per_instance_scores: <artifact>
    component_minima_and_page_composites: <artifact>
    remediation_history: <artifact>
  checks:
    - {name: all_source_blocks_mapped_once, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_geometry_and_properties_pass, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_live_and_aem_screenshot_pairs_valid, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_screenshot_scores_above_90, status: PASS|FAIL, evidence: <artifact>}
    - {name: match_gates_advisory, status: INFO, evidence: <parity.json gates>}
    - {name: all_interactions_and_media_pass, status: PASS|FAIL, evidence: <artifact>}
    - {name: all_final_minima_and_composites_above_90, status: PASS|FAIL, evidence: <artifact>}
  failures: []
  next_stage: 05-completion-output
```

Do not return `PASS` for partial breakpoints, selected components, invalid/blank crops, missing artifacts, a ratio exactly equal to the threshold, averaged-away failures, or any `FAILED-FINAL` component. Remediate within the bounded loop, then return the truthful terminal status.