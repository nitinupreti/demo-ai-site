# AEM Page Migration

## Inputs

```yaml
SITE_URL: "https://www.notion.com/customers/cursor"
# Optional: TARGET_PAGE_PATH, BREAKPOINTS, EVIDENCE_DIR
```

`SITE_URL` is a required runtime input supplied by the standalone launcher or the caller. Never edit this file to set a run-specific URL. The resolved URL must be readable or STOP with the failing URL and browser/network evidence.

## Canonical Run Contract

These values control every stage. A stage file may add detail but MUST NOT weaken or override them.

```yaml
required_breakpoints: [375, 768, 1440] # unless BREAKPOINTS explicitly replaces them
visual_pass_ratio: from-run             # parity.json.threshold; set by effort or --visual-pass-ratio
match_gates: [typography, color, spacing, images, svg, glyph_substitutions, structure] # advisory only
max_attempts_per_component: 4          # Round 1: 3; Round 2: 1
default_evidence_dir: design/scratch/migration-<run_id>
completion_requires: [stage_01_pass, stage_02_pass, stage_03_pass, stage_04_pass, no_residual_gaps]
```

The target is AEM as a Cloud Service components — Sling Models, HTL, Coral 3 dialogs, client libraries and authored content. This is not an Edge Delivery Services project; never produce EDS blocks, `blocks/` folders, or document-authored markup.

## MUST — Frozen Tools Own Evidence And Scores

Two checked-in tools are the only valid producers of source evidence and visual scores. Read their output; never reimplement, replace, edit, estimate or round it.

| Purpose | Command | Artifact |
|---|---|---|
| Source capture (Stage 1) | `node design/site-url/tools/discover.mjs --url <SITE_URL> --out <EVIDENCE_DIR>/discovery --breakpoints <BREAKPOINTS> --run-id <RUN_ID>` | `discovery/discovery.json` + full-page PNGs |
| Visual parity (Stage 4) | `node design/site-url/tools/parity.mjs --config <EVIDENCE_DIR>/parity/parity-config.json --out <EVIDENCE_DIR>/parity` | `parity/parity.json` + crops, masks, side-by-side PNGs |

Install their dependencies once with `npm install` inside `design/site-url/tools` when `node_modules` is absent. Both tools exit non-zero on failure. Modifying anything under `design/site-url/tools/` to relax a gate invalidates the run.

`run_id` is supplied by the launcher. `EVIDENCE_DIR/run-state.json` is owned by the launcher: read it for run inputs, never write to it. Each stage writes its envelope to `EVIDENCE_DIR/stages/<stage-id>.json`; the launcher validates the envelope, stamps timing, and records the verdict. An envelope claiming `PASS` while any check is `FAIL`, or carrying a different `run_id`, is recorded as `FAIL`.

## MUST — Decoded Video And Stable Geometry Gate

This gate applies to every visible or component-owned `<video>` at every required breakpoint on the live source, disabled target, and author target. Run it before Stage 1 freezes source geometry and again immediately before every Stage 4 geometry measurement or screenshot. Earlier readiness evidence cannot be reused because lazy-loading and responsive video state may change.

0. Classify each source media instance before implementation. Record whether it is an inline MP4/video, image, animated image, background video, embed, or poster; record the rendered element tag, source URL and MIME type, `autoplay`, `loop`, `muted`, `playsInline`, `preload`, `controls`, `poster`, lazy-load trigger, visibility behavior, `object-fit`, `object-position`, intrinsic dimensions, and responsive aspect ratio. An inline MP4 MUST remain a real `<video>` backed by an authored DAM video path. Never replace it with an `<img>`, poster-only element, CSS background, canvas capture, screenshot, or static first frame.
1. Scroll the owning component root into view and trigger its real lazy-loading path. Await `loadedmetadata` and `loadeddata`/`canplay`, then require a non-empty `currentSrc`, no failed media request, `readyState >= HTMLMediaElement.HAVE_CURRENT_DATA` (`2`), and `videoWidth > 0` / `videoHeight > 0`.
2. Pause source and target at the same deterministic comparable time (use `0.01s` or the first common seekable time unless discovery requires another state), await `seeked`, then await one presented frame with `requestVideoFrameCallback`. If that API is unavailable, require `readyState >= 2` and await two `requestAnimationFrame` callbacks after seeking.
3. Only after the decoded frame is presented, measure the component root, media wrapper, video, and caption. Sample their rectangles three times at least 500 ms apart and require x/y/width/height deltas no greater than 1 CSS px. Run motion-freeze CSS only after this frame-readiness step.
4. If post-decode dimensions differ from a poster, skeleton, blank frame, intrinsic fallback, or other pre-decode placeholder, discard every earlier geometry value and screenshot for that component. Recapture using only the stable post-decode state; never tune AEM CSS to placeholder geometry.
5. Reject blank or mostly uniform video crops, poster-only substitutions for a source video, `readyState < 2`, zero intrinsic dimensions, failed seeks, missing frame-presentation evidence, or unstable post-decode rectangles. Report `SCORE WITHHELD — VIDEO NOT DECODED OR GEOMETRY UNSTABLE`; do not calculate a visual percentage.
6. Persist per-video readiness evidence for source and target: component/instance ID, selector, final page URL, `currentSrc`, HTTP result, `readyState`, `networkState`, intrinsic width/height, selected `currentTime`, seek result, frame-callback result, pre-decode rectangle, post-decode rectangle samples, and screenshot path. A component score without this evidence is invalid.
7. When AEM is intended to reproduce the exact source video, compare the source and DAM asset byte length and SHA-256 when both resources are accessible. A mismatch must be explained and validated as an intentional transcode; otherwise it is an asset failure.
8. Validate playback behavior separately from static-frame parity. When the source plays automatically or while visible, the target MUST do the same without user interaction: sample `currentTime`, wait at least one second, and require `paused === false`, `readyState >= 2`, and a time delta of at least `0.5s`. Verify pause/resume, looping, controls, reduced-motion behavior, and off-screen behavior whenever the source implements them. A `<video>` element frozen at `0s` is a failure even if its first frame resembles an image.
9. For side-by-side screenshots, require source and target to use the same viewport, decoded asset, intrinsic dimensions, `object-fit`, `object-position`, and deterministic `currentTime`. Capture the complete media-with-caption root, not only the outer box. The screenshot must visibly include the video frame, rounded container, border/shadow, and caption.
10. Browser automation running in a hidden tab may suppress autoplay or intersection events. Do not treat that suppression as source behavior. Trigger the source's natural scroll/visibility path in an active context; if the environment still prevents playback, record the limitation, use an explicit `video.play()` only to capture a matched frame, and keep the behavioral check unresolved rather than approving a static placeholder.

## MUST — Exact Assets, Icons, Typography, And Spacing Gate

This gate applies to every visible component and responsive state. A page MUST NOT pass Stage 1, Stage 4, or completion while any item below is missing, approximated, or unverified.

1. **Logos and branded artwork:** Inventory every visible logo, wordmark, brand mark, badge, and branded illustration as an asset. Reuse the exact source asset when legally and technically available, preserve its intrinsic view box/aspect ratio, store it in DAM, expose it through an authored asset-path field, and verify successful loading plus rendered width/height at every breakpoint. Never replace branded artwork with typed letters, styled text, CSS borders, emoji, a generic icon, or a hand-drawn approximation.
2. **Icons are separate elements:** Inventory every caret, chevron, arrow, close control, menu control, play control, globe, and other icon independently from adjacent text. Use the source SVG/image or a verified project icon-library equivalent. Render it as an SVG/image/icon component with an explicit box and accessibility treatment. Never append Unicode glyphs such as `⌄`, `▼`, `→`, `×`, or `▶` to authored labels as a visual substitute. Authored labels MUST contain text only.
3. **Typography is computed, not inferred:** For every distinct text role in every component, capture and compare the final computed `font-family`, loaded font face, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `word-spacing`, `font-style`, `font-kerning`, `font-feature-settings`, `font-variation-settings`, `font-synthesis`, `text-rendering`, `text-wrap`, `-webkit-font-smoothing`, text transform, and color. Require `document.fonts.check(...)` for each custom face/weight actually used and compare line-by-line text rectangles for representative copy. A matching CSS family declaration does not pass when the requested font failed to load, a fallback rendered instead, glyph metrics differ, line breaks differ, or any text-rendering property differs.
4. **Box-model spacing is exhaustive:** For every component root and each layout-defining child, capture source and target `x`, `y`, `width`, `height`, margin, padding, row/column gap, alignment, and positioning at every required breakpoint. Compare component-to-component vertical gaps as well as internal spacing. The absolute geometry delta MUST be no greater than 1 CSS px unless a documented browser rounding difference is demonstrated.
5. **Responsive widths use the correct containing block:** Distinguish `%` from `vw` and account for scrollbar width. Full-bleed components MUST match the source content viewport without creating negative offsets or horizontal overflow. Record `innerWidth`, `documentElement.clientWidth`, and `scrollWidth` with each geometry capture.
6. **No partial visual sign-off:** Typography-only, asset-only, or component-root screenshots cannot establish page parity. Completion requires the per-component measurements above, side-by-side locator screenshots, a full-page screenshot at every breakpoint, zero unintended overlap/overflow, and explicit assertions that all expected logos and icons loaded and rendered.
7. **Failure behavior:** Any missing logo, substituted glyph, unloaded font, unmeasured text role, spacing delta over 1 CSS px, stale authored value, or unexplained asset mismatch is `FAIL`. Return to the owning discovery, authoring, asset, or CSS layer; remediate and recapture before reporting completion.

## Objective

Reproduce the complete visible source document as reusable, authorable AEM as a Cloud Service components: global chrome, all main regions, headless/decorative bands, responsive-only variants, overlays, consent UI, floating utilities, and interactions. Linked pages are out of scope unless supplied separately.

Deliver Sling Models, HTL, Coral 3 dialogs, BEM CSS, shared tokens, clientlibs, focused tests, deployable assets, policy updates, and a populated demo page. Validate disabled and author modes at every observed breakpoint (default `375`, `768`, `1440`). A successful build is not completion; the Visual Parity Gate controls completion.

## Stage Router

The successful path executes these five stages in strict sequential order using their exact reference files. Each stage owns its detailed rules; read its file when that stage becomes active, not all references up front.

1. **Source discovery and coverage** — [01-source-discovery.md](01-source-discovery.md). Complete and freeze source evidence before inspecting the target.
2. **Reuse, component implementation, and authoring** — [02-component-authoring.md](02-component-authoring.md). Component Coverage Gate is a precondition for Stage 3.
3. **Assets, build, deployment, and runtime checks** — [03-assets-runtime.md](03-assets-runtime.md).
4. **Visual parity and remediation** — [04-visual-parity.md](04-visual-parity.md). MUST run after every deploy affecting appearance or behavior. Owns the frozen parity runner, the Side-by-Side Locator Screenshot rule, and the Remediation Loop.
5. **Completion report** — [05-completion-output.md](05-completion-output.md). Read only when preparing the final response.

If a later stage exposes missing or stale evidence, return to the owning stage, refresh that evidence, and continue. Never compensate for missing discovery or content by tuning CSS.

## MUST — Stage Discipline

- MUST execute stages in order and enter a downstream stage only after its prerequisites exist. There is no fast path or combined stage on a successful run.
- MUST end every executed stage with its required `stage_result` envelope and persist that envelope in `run-state.json`. A stage without its envelope is treated as not run.
- MUST NOT parallelize stages with each other. Independent reads/downloads inside a single stage may run in parallel; dependent stages never may.
- A remediable `FAIL` in Stages 1–3 stays in its owning stage until fixed. An external `BLOCKED` result ends the run without fabricating downstream results. Stage 4 always hands its terminal `PASS`, `FAIL`, or `BLOCKED` result to Stage 5 for truthful reporting.
- A request naming one component may enter Stage 4 directly only when valid Stage 1/2/3 results for the same `run_id` already exist. Otherwise execute the prerequisite stages first.
- If a later stage exposes stale or missing evidence, return only to the owning stage, refresh affected downstream artifacts, and continue. Restart Stage 1 only when source discovery or its frozen denominators are invalid.

## MUST — Bounded Remediation Retry (Stage 4)

The Remediation Loop MUST NOT run without an upper bound. Every failing component is capped at a total of **four attempts** across the whole run: three consecutive attempts in Round 1, and one final attempt in Round 2.

- **Round 1 — broad fix batches, capped at 3 per component.** Group failing components by shared owning layer or deployable module, record one falsifiable hypothesis per component (or one shared hypothesis naming every affected component), and apply all non-conflicting fixes before one focused validation and one scoped deployment sequence. Recapture every component changed or potentially affected by shared files. A batch consumes one attempt only for each component whose owning files changed. Components crossing the pass ratio at every breakpoint become `PASS`; after a component's third failed batch, mark it `FAILED-ROUND-1`.
- **Round 2 — one final broad pass.** Group all `FAILED-ROUND-1` components by owning layer, apply each component's largest remaining structural gap, then run one validation/deployment sequence and recapture every affected component. If a component crosses the pass ratio at every breakpoint, mark it `PASS`; otherwise mark it `FAILED-FINAL` and stop attempting it.
- **Termination.** The Remediation Loop ends when every failing component is either `PASS` or `FAILED-FINAL`. Do not enter a Round 3. Do not re-open a component already at `FAILED-FINAL`.
- **Stage 5 authorization under bounded retry.** Always run Stage 5 after Stage 4 terminates. Stage 5 emits `status: COMPLETE` only when Stage 4 passed with no `FAILED-FINAL` components. Otherwise it emits `status: FAIL` and lists every `FAILED-FINAL` row in `residual_gaps` with: component, breakpoint(s), final `visualMatchPercent`, owning-layer trace, evidence paths, and the reason further remediation was not viable within four attempts. Never restart Stage 1 solely because the bounded retry was exhausted.
- **Attempt ledger.** Every batch MUST have a `batch_id`, shared build/deploy evidence, and affected-component list. Every component changed in that batch MUST also have its own Round 1/2 attempt entry with hypothesis, owning layer, files changed, and new `visualMatchPercent` per breakpoint. Unrecorded component attempts are treated as not run.

## Non-Negotiable Rules

- `MUST`, `FAIL`, and `STOP` are completion-blocking. STOP only for unreadable/missing sources, conflicting authorities, unresolved external blockers, or explicit user input requirements. Other failures require in-turn remediation.
- No visible block may be omitted, including headless blocks such as marquees, tickers, announcement bars, background-media strips, and overlays.
- Global chrome (site header, footer, announcement/utility bars, mega-menu overlays) is authored in Experience Fragments and referenced from the template structure by `fragmentVariationPath`. Chrome authored directly into a page or template is a failure.
- Every business-editable value must be authored. Do not hardcode copy, links, assets, item counts, or visual choices unless the component contract explicitly permits it.
- Every color role uses a curated token select with `other`; choosing `other` reveals a validated custom-hex field. Models sanitize custom values and HTL exposes them only through protected CSS custom properties.
- Author DAM paths, never remote or temporary URLs. Preserve media class: video remains video, animation remains animation, and a poster is not a substitute.
- Use the frozen tools for live source and target evidence. Property equality alone cannot establish visual parity.
- Every component instance, component-type minimum, and page composite must be strictly above the run's pass ratio at every required breakpoint; a ratio exactly equal to it fails. The ratio is not a constant — the orchestrator derives it from the run's reasoning effort (`max`/`xhigh` 0.90, `high` and model-managed 0.85, `medium` 0.75, `low`/`minimal`/`none` 0.55) unless `--visual-pass-ratio` pins it. Read it from the current run's `parity.json.threshold`; never assume a number.
- A percentage above the threshold decides the verdict. The structured match gates — typography, colour, spacing, inline images, inline SVG, glyph substitutions and structure — are advisory diagnostics that locate a defect but never fail an instance on their own, because they pair nodes positionally and one added or removed wrapper fabricates a delta on every node after it.
- A component passes only when exhaustive source coverage, geometry, property, screenshot, interaction/media, and authorability checks all pass.
- User rejection invalidates the affected evidence and score; recapture and remediate.
- Never modify generated/vendor paths: `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or template `initial`/`structure` trees.

## Required Project Workflows

1. Read `AGENTS.md`, `CLAUDE.md`, and `.aem-skills-config.yaml` when present.
2. Use `create-component` for every Tier 2/3/4 component. Run `code-assessment` on generated Java/OSGi/Maven code before completion.
3. Inspect only `SITE_URL` and exact resources referenced by its DOM, CSS, or captured network traffic. Do not crawl linked pages, submit forms, forward cookies, or inspect unrelated embeds.
4. Use the frozen tools above for every capture and every score. They already enforce identical viewport, colour scheme, locale, font readiness, media decode and motion state on both sides; a hand-rolled runner does not and is not permitted.
5. Keep an inline `design-facts` block current throughout implementation:

```yaml
reuse_decisions:
  - design_block: <generic-role>
    tier: 1|2|3|4
    reuse_target: <resource-type>|null
    gap: none|<why higher reuse tiers fail>
    additions: [<exact deltas>]
template_decision:
  reuse_template: <name>|null
  new_template_gap: none|<reason>
policy_decisions:
  - policy_path: <path>
    additions: [<resource-types>]
instance_authoring_map:
  - design_instance: <source selector/heading/rect>
    resource_type: <resource-type>
    parent_path: <editable-container>
    node_name: <semantic-unique-name>
    dialog_values: {<all non-default authored values>}
```

Every implementation and remediation change must trace to this block.

## Execution Discipline

- Run discovery before target inspection so target implementation cannot bias source denominators.
- Parallelize independent reads/downloads only; do not parallelize dependent stages.
- After the first implementation edit, run the cheapest focused executable validation before further edits.
- Keep FileVault validation enabled. Reconcile checked-in content with live repository JSON after deployment because merge-mode packages may preserve stale properties or order.
- Do not emit `status: COMPLETE` with missing evidence, unclaimed source regions, failed component rows, or residual gaps.
- A Stage 4 `FAIL` verdict enters the bounded Remediation Loop in [04-visual-parity.md](04-visual-parity.md). Continue until every component's minimum is strictly above the run's pass ratio at every breakpoint or every failing component reaches `FAILED-FINAL`; then run Stage 5 with the truthful terminal status.