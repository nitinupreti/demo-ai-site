# DESIGN_SOURCE
FIGMA_URL:   ""
SITE_URL:    "https://sg.idtdna.com/page/"
# public URL of a live page to reverse-engineer
DESIGN_FILE: <path to .pdf or .fig — optional>
# Optional companions: DESIGN_SCREENSHOTS_DIR, DESIGN_SVG_DIR, DESIGN_TOKENS_JSON
# Exactly one of FIGMA_URL or SITE_URL must be set (DESIGN_FILE is optional in both).
# If both FIGMA_URL and SITE_URL are set, FIGMA_URL wins (design intent) and SITE_URL is the safety net.
# If none of FIGMA_URL, SITE_URL, or DESIGN_FILE is set, STOP and ask.

# Build every AEM component required to author the page defined in DESIGN_SOURCE

## Goal
Build every reusable AEM as a Cloud Service component (Java Sling Models, HTL, Granite UI Coral 3, BEM CSS, shared design tokens) required to author the page in DESIGN_SOURCE. When authored on a real page with the design's content, the rendered result MUST match the design pixel-for-pixel in both author mode and disabled mode at every design-defined breakpoint.

**SITE_URL scope contract.** In SITE_URL modes, "the site" means the complete rendered document at the configured URL: all main-content sections, every repeated instance, header/navigation, footer, persistent/floating utilities, consent controls, overlays initially visible without user input, and responsive-only variants. Linked destination pages are outside scope unless separately supplied as DESIGN_SOURCE inputs. Nothing visible in the configured source document may be omitted because it is global, shared, third-party-provided, below the fold, repeated, or difficult to model. If a visible external widget cannot legally or technically be reproduced, the gate remains FAILED until the user explicitly removes that widget from scope; exclusions may not be assumed.

**SITE_URL acceptance precedence.** Whenever `SITE_URL` is populated, its running rendered page is a mandatory visual acceptance target even when Figma or a design file supplies implementation intent. Every instance and page score MUST be computed against the live `SITE_URL` at every breakpoint. Figma/design-file evidence may clarify intended assets or states but cannot waive a live-site mismatch. If Figma and SITE_URL materially conflict, STOP with the exact conflicting role/property and ask which source should govern; never silently score only the easier source.

## MANDATORY — no component may be skipped
Every distinct reusable block visible in DESIGN_SOURCE (every section, strip, card cluster, carousel, form, footer, header, rating badge, pricing panel, and any other authored region — INCLUDING those that require interactive JS such as carousels, tabs, accordions, and modals) MUST be delivered as a working authorable component in this run and authored onto the demo page. Deferring any block to "residual gaps", "future work", "out of scope", or a follow-up run is a defect. The `reuse_decisions` YAML block MUST contain one row per Figma block with `tier` and `additions`; the `instance_authoring_map` MUST contain one row per Figma instance; the deployed demo page MUST render EVERY block with 0 SightlyExceptions before the final summary is written. If a block genuinely cannot be built (e.g. an unresolvable Figma node), STOP and ask the user with a screenshot region reference — do NOT silently drop it. The final summary's "residual gaps" section MUST be empty except for items the user has explicitly approved to defer.

## P0 — Design fidelity is non-negotiable
Rendered output MUST match DESIGN_SOURCE for typography (family, weight, size, line-height, letter-spacing, color), color (backgrounds, text, borders, accents, opacity, gradients), backgrounds (page, section, component, per-variant), and look-and-feel (spacing, radii, borders, shadows, iconography, image ratios, alignment, per-instance offsets, interaction states). Verify in BOTH:
1. **Disabled mode** — rendered-DOM check (Step 10) + visual parity (A4/A11).
2. **Author mode** — `/editor.html<demo-page-path>.html`; ignore only editor chrome and empty-state placeholders.

**Iteration on mismatch:** fix at token layer → component CSS layer → redesign component (change HTL/dialog/split) → redeploy → re-verify BOTH modes. Green build + wrong colors/font/background = NOT DONE.

## VISUAL PARITY GATE — MANDATORY, NON-SKIPPABLE, HARD-FAIL
Visual parity verification (Step 10.5 + 10.6) is a **completion-blocking gate**. The run is NOT complete — regardless of any other success signal — until every check in this gate is executed and PASSES. This gate overrides every other exit condition below.

**Quantified pass threshold — MANDATORY > 85% for every instance, every component type, and the full page.** At every design-defined breakpoint, the raw unrounded weighted score for EACH visible source-to-target component INSTANCE MUST be **strictly greater than 85%**. Each component-type score is the MINIMUM of its instance scores, never their average, and MUST be >85%. The full-page composite across all instances at that same breakpoint MUST also be >85%. A score of `85.000%` does NOT pass. Compare raw scores before display rounding; rounding `85.004%` to `85.0%` must not change its pass result, and rounding `84.996%` upward must not create a pass. The gate passes only when the minimum instance score, minimum component-type score, and minimum full-page composite across all breakpoints are each >85%. Any score **≤ 85%** is a **hard fail** and the iteration loop MUST run again (token → component CSS → component structure → redeploy → re-measure). Do NOT declare PASSED on "looks close" — compute every instance score.

**Composite formula (P0 axes, weights sum to 100%):**
- Content parity (headings + section presence + copy) — **25%**
- Typography parity (family / size / weight / line-height / letter-spacing per element) — **25%**
- Color parity (exact computed CSS colors; raster-only ΔE tolerance per the canonical rules below) — **20%**
- Layout geometry (per-block and per-role bounding boxes; per-instance spatial deltas) — **15%**
- Section order (reading order vs source) — **10%**
- Media / interactive fidelity (video vs poster, autoplay, hover / focus states) — **5%**

**Canonical measurement tolerances — use these everywhere; no competing tolerance is allowed:**
- Computed numeric CSS properties and stable bounding-box coordinates/dimensions: absolute delta **≤ 1 CSS px** after the measurement-readiness gate passes.
- Compare nested-role positions relative to their homologous section root: `relativeX = roleRect.x - sectionRect.x`, `relativeY = roleRect.y - sectionRect.y`. Compare section-root page position only in the full-page rhythm/order check with both pages at `scrollY === 0` and the same header/chrome scope. Never compare viewport-absolute `x/y` values captured after arbitrary scrolling.
- Font family, font style, font weight, text transform, display mode, flex/grid axis, item count, role sequence, and interactive behavior class: **exact match**.
- Computed CSS colors: exact resolved RGBA match. ΔE ≤ 3 applies ONLY to raster screenshot pixels affected by anti-aliasing, image compression, or color-profile conversion; it does not excuse a different CSS color value.
- Source declarations/tokens are copied exactly. Browser-computed subpixel values are compared with the numeric tolerance above, not string equality.
- A measurement taken before fonts, media, viewport, and layout are stable is invalid evidence and cannot be scored.

**Per-axis measurement rules:**
- Before inspecting the target, freeze a source-derived `score_manifest` for every visible block instance; assign each a stable `instance_id` from its source reading order and role. The target cannot merge repeated instances, add/remove properties, or mark failures N/A to change a denominator.
- Content denominator = every visible source role, exact text/copy unit, heading, media slot, CTA role, and control in the source-DOM manifest.
- Typography denominator = `{font-family, font-size, font-weight, font-style, line-height, letter-spacing, text-transform}` for every source text role.
- Color denominator = `{color, background-color, background-image/gradient, border-color, opacity, box-shadow}` for every applicable source role.
- Layout denominator = `{relativeX, relativeY, width, height, display, position, padding, margin, border, border-radius, gap, flex-direction, flex-wrap, grid-template-*}` for every mapped source role.
- Section-order denominator = every direct source region in reading order. Media/interaction denominator = media class, asset slot, object-fit/aspect ratio, controls, initial state, and each observed transition/state.
- A property may be N/A only when it is genuinely absent from the source role and that absence is recorded before target inspection. Score each axis 0–100 as matched frozen entries ÷ total frozen entries.
- Compute each per-instance score = weighted sum across the 6 axes independently at each breakpoint. Every instance, including Tier 1 reused instances, repeated siblings, global/shared chrome, and page-level authored regions, MUST score >85% individually; a high average cannot hide one failing instance.
- Compute each component-type score as the minimum score among all its rendered instances at that breakpoint. Compute a full-page composite independently at each breakpoint as the average of every instance score on the rendered page. Report the minimum instance score, minimum component-type score, and minimum full-page composite across breakpoints; all three minima MUST be >85%.
- Emit the per-instance table, component-type minima table, breakpoint page composites, and all three cross-breakpoint minima at the top of the Final summary. A summary missing any table/minimum is a defect.

**Report the scores explicitly.** The gate status line MUST include all three minima: `VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations — minimum instance <score>% — minimum component type <score>% — minimum page composite <score>% (required >85%)`. A "PASSED" line without all three numeric minima is a defect.

## Strict per-component parity check — MANDATORY (anti-gaming enforcement)
Visual parity MUST be verified for EVERY visible component instance that appears in the complete source and demo documents — not just one row per component type, not just the hero, not just first-fold blocks, and not just components the agent thinks are "obviously right". Every source instance gets exactly one target mapping, its own measurement, its own row in the score table, and its own iteration result. The following anti-gaming rules apply to EVERY instance, EVERY iteration, and cannot be waived:

**Rule 1 — No score above 90 without a captured measurement.** For each of the six axes on each visible instance, the score cell in the per-instance table MUST cite the source value AND the rendered value that were compared. Example:
> hero typography: 100 — source heading measured `<size>px <weight> <family> <color> letter-spacing <value>`; rendered heading measured `<size>px <weight> <family> <color> letter-spacing <value>`.

A score of 100 without a captured pair of computed-style objects is a defect. A score of 100 based on "reasonable defaults" or "I assumed the design used…" is a defect.

**Rule 2 — Missing images / icons / logos = automatic zero on Media axis.** If a block has an `img` slot on the source and the demo page renders the slot without an authored DAM asset (or with a broken/404 asset), the Media axis for that block scores **0**, no exceptions. The gate reruns until every image slot is populated with a DAM-hosted asset.

**Rule 3 — CTAs must match role, not just color.** A source CTA that is a text link (`<a>` with no background, brand-blue color, no border) is a different role from a filled button (rectangular fill, elevated padding, uppercase). Rendering a filled button where the source uses a text link (or vice versa) is a **Layout-axis score cap of 60** on that block, regardless of typography match. Fix the CSS class role, not the color.

**Rule 4 — Background zones must match the source's band composition.** If the source paints a full-bleed band with `background-image` or a strong contrasting color, the demo page MUST paint the same band. Rendering the same content on a plain white/surface background when the source uses a full-bleed image or dark zone caps the block's **Color axis at 60** and its **Layout axis at 70**, regardless of typography match.

**Rule 5 — Body font token must be verified in the running browser.** After deploy, the parity-gate script MUST evaluate `getComputedStyle(document.body).fontFamily` and confirm it starts with the source's primary font family. A fallback stack that starts with `Helvetica Neue`, `system-ui`, or `Arial` when the source uses a licensed / Google / self-hosted font is a **Typography-axis cap of 70** across every block, because it affects every element on the page. The fix is at the tokens or shared frontend variables layer, not per-component CSS.

**Rule 6 — Icons must be the actual designed glyphs.** If the source uses a specific SVG per item (product icon, partner logo, newsletter mark), rendering a placeholder generic shape caps the block's **Content axis at 80** and Media axis at 60. Download the real SVG, upload to DAM, author it on the instance.

**Rule 7 — Full-page composite >85% is necessary but NOT sufficient.** Every individual INSTANCE MUST score >85% at EVERY breakpoint, and every component-type minimum MUST therefore also be >85%. A run where the page composite is 92% but one repeated card, global component, or other instance scores 85% or less is a **hard fail**. Tier 1 reuse, first-fold prominence, duplication, or a high score at another breakpoint cannot waive this rule. Every failing instance gets an iteration result; shared implementation fixes must be revalidated against all instances.

**Rule 8 — First run of the gate on any given deploy MUST use anti-hallucination measurement.** The agent MUST run a Playwright `page.evaluate` snippet that returns raw computed-style objects for each per-block root + at least the block's heading + primary CTA + primary image. The returned JSON is the evidence for that iteration's score table. Substituting "based on inspecting the CSS I wrote, the values should be…" for a live measurement is a defect.

**Rule 9 — The user's rejection is authoritative.** If the user says "many of the other components apart from the first are not matching" (or equivalent structural / color / image callouts), the score claimed in the prior turn was wrong. The agent MUST immediately re-run the strict measurement pass, publish an honest lowered score, and iterate — NOT rationalise the previous score with different weights.

**Rule 10 — A score ≤85% triggers mandatory SITE_URL revalidation, repair, AEM redeployment, and remeasurement.** For every failing instance/breakpoint: reopen or reload the configured `SITE_URL`; rerun measurement readiness; capture a FRESH complete source-section DOM/style/asset/state manifest; identify the exact failed frozen score entries; update tokens → CSS → HTL/dialog/model/content/assets as required; run focused tests and package validation; install the affected bundle/content/clientlib packages into the AEM instance; reconcile live repository JSON and sibling order; verify deployed semantic wrappers and asset reachability; reopen disabled AND author modes; rerun checks 0–19 at ALL breakpoints; and recompute every instance, component-type, and page score. Do not merely rescore unchanged evidence or redeploy unchanged code. A full-page failure with all instances individually passing still requires page-rhythm/order reconciliation, redeployment, and a fresh page composite. Repeat this loop until all raw scores are >85% or a genuine external blocker makes further execution impossible.

**Rule 11 — A target component may not be compared with only a convenient subset of a source section.** Before decomposition, capture the nearest source section boundary that owns the section heading and record every visible sibling region inside it. Assign every source region to exactly one target component or to an explicit parent-plus-children composition. The parity unit remains the ENTIRE source section: if the source combines a featured panel, supporting rail, controls, or other unequal sibling roles, the target must preserve that combined composition. Splitting those roles into separate target components is allowed only when they are authored together under one parent and the gate compares their UNION against the complete source section. A missing or separately scored sibling region is a **hard fail**, regardless of composite score.

**Rule 12 — Classify responsive and interactive behavior from evidence at every breakpoint.** For each source section, record whether it is a static grid, asymmetric feature-plus-rail, horizontal scroller, or carousel at each tested width, together with visible item count, item order, overflow/clipping, controls, pagination, and initial active state. The target MUST use the same behavior class at that breakpoint. Do not infer a carousel from repeated content, and do not replace an asymmetric source composition with equal cards. The semantic component name and JS contract MUST agree with the observed classification: if no breakpoint behaves as a carousel, do not name the component `carousel`, generate carousel controls, or add carousel JS. For interactive states, capture and compare the initial state and one complete next/previous transition. A behavior-class, role-cardinality, naming-contract, or control-state mismatch is a **hard fail**.

**Rule 13 — Measurement readiness is a prerequisite, not an axis that can lose points.** Before capturing a DOM manifest, screenshot, or score on BOTH source and target: assert `window.innerWidth` equals the requested viewport width; record `devicePixelRatio` and `visualViewport.scale`; await `document.fonts.ready`, then call `document.fonts.check()` for every non-system family actually used by a measured role and require `true`; force relevant lazy images to eager and trigger observed IntersectionObserver/scroll loading for the measurement pass; wait until every visible `<img>` is `complete && naturalWidth > 0` and every `<video>` has `readyState >= 2`. Validate CSS background/font/media responses through Playwright network events or direct HEAD→GET, not a page-context `fetch` that can fail solely because of CORS. Inject measurement-only CSS that disables animations, transitions, and smooth scrolling, then require no relevant network activity and unchanged tracked-role bounding boxes across two samples at least 500 ms apart. Run interactive-state checks separately with native motion restored. A zero-height media slot, failed source asset, wrong actual viewport width, unresolved primary font, or continuously shifting layout invalidates the capture and **hard-fails the gate**; never treat collapsed media geometry or a fallback font as design intent.

**Rule 14 — Score the deployed DOM, never the authored HTL or local CSS in its place.** After AEM rendering and rewriting, recapture every mapped role and verify its tag name, parent/child relationship, sibling order, and required attributes. A navigation role that was authored as `<a>` MUST still be an `<a>` with a non-empty `href`; a trigger MUST still be a `<button>`; a media wrapper and card wrapper MUST still exist. If link checking, URL rewriting, sanitization, or HTL conditions strip/unwrap a role, the block is a **hard fail** even when its child text remains visible. Fix the authored URL or rendering contract, then redeploy and recapture.

**Rule 15 — Reconcile source content, live repository content, and rendered order after every deploy.** Fetch the live repository JSON for the authored page region and assert expected resource types, properties, child names, child cardinality, and sibling order before opening the visual gate. Checked-in XML and BUILD SUCCESS are not proof that merge-mode content reached the repository. When update, creation, deletion, or reorder is required, perform an explicit content-package update or authenticated Sling operation, then read the live JSON again. For Sling POST child creation, post to the parent's wildcard child endpoint with an explicit child name; never post creation properties directly to the parent resource, which mutates the parent. Verify the parent resource type after the operation. Runtime DOM reading order MUST also match the live repository order and DESIGN_SOURCE.

**Rule 16 — Extracted assets must be reproducibly deployable.** A successful one-off upload from a temporary or ignored folder is not a completed asset deliverable. Store each required asset in a project-owned deployable source location, or provide a tracked deterministic asset manifest/installer when repository policy excludes binaries. Record source URL, local source path, DAM path, MIME type, and byte size. Verify the built package or deterministic installer can populate a clean environment, then verify deployed media with GET (or HEAD with a GET fallback when `Content-Length` is omitted) plus browser decode (`naturalWidth > 0` for images). Local DAM presence alone cannot pass this rule.

**The following are NOT valid substitutes for the visual parity gate and MUST NOT be treated as "done":**
- Zero `SightlyException` in the rendered HTML
- Every BEM `cmp-*` class appears in the rendered HTML
- `mvn install` reports BUILD SUCCESS
- All unit tests pass
- The bundle is Active
- The user answered a scoping question that did not explicitly waive visual parity
- Missing DAM assets, missing licensed fonts, or any other "the images/fonts aren't uploaded yet" excuse
- Author mode "looks right"
- Any subset of the checks above in combination

**Every one of these gate checks MUST be executed, in order, before writing the Final summary:**
0. **Measurement-readiness preflight.** Execute Rule 13 on both pages and emit the actual viewport width, DPR, font readiness, decoded media count, failed media list, and layout-stability result. Any failure blocks checks 1–19 and scoring.
1. **Open both pages in a real browser** (headless or headed Playwright/Chromium) at every design-defined breakpoint (default 375, 768, 1440; add any wider frame observed). Loading DESIGN_SOURCE and the rendered demo page in the same session is mandatory — no "based on the HTML I can guess it looks like…" substitutes.
2. **Screenshot pair per breakpoint** — target + rendered, saved side-by-side. Screenshots are evidence artefacts, not decoration.
3. **Computed-style diff per breakpoint** for every component's root + at least 2 nested elements: `font-family`, `font-weight`, `font-size`, `line-height`, `letter-spacing`, `color`, `background-color`, `background-image`, `padding`, `margin`, `border`, `border-radius`, `box-shadow`, `gap`. Apply the canonical measurement tolerances; any larger delta is a **hard fail** and MUST be iterated (Step 10.7).
4. **Token audit** — enumerate every project-owned custom property declared by the shared tokens clientlib from the running page's `:root` and confirm its resolved value matches the local declaration. Mismatch = stale-clientlib defect: purge and reinstall.
5. **Stale-clientlib check** — for every category the page loads, fetch the deployed `.css` file and grep for any BEM class matching this component's namespace that is NOT in the local source. Any hit is a leaked pre-existing rule and MUST be deleted from AEM before continuing (see "Content-package gotcha").
6. **Cascade origin check** — for each component's root heading + CTA element, use the Chrome DevTools Protocol matched-styles API when available; otherwise use `element.matches` plus stylesheet enumeration to identify rules contributing to computed `color`, `font-family`, and `background`. Catch cross-origin stylesheet `SecurityError`: record the stylesheet URL and final computed values instead of inventing rule data. Cross-origin source CSS may use this evidence fallback; every project-owned target stylesheet MUST remain inspectable. If target rule origin is a stale clientlib, a Core Component override, or an unexpected embed, resolve it before continuing.
7. **Base-check result.** Checks 0–6 must all pass before the domain checks continue; do not iterate or score from a partial base-check result.
8–16. **Media and structural checks.** Execute checks 8–10 in the Media-fidelity contract and checks 11–16 in the Structural-parity contract below, in numeric order, before continuing.
17. **Deployed-role preservation.** Execute Rule 14 for every role in every block. Emit authored role → deployed tag/parent/attributes pairs. Missing or rewritten roles = FAIL.
18. **Live repository reconciliation.** Execute Rule 15 and emit expected vs live resource type, child cardinality, and sibling order for every authored block. Any mismatch = FAIL before visual scoring.
19. **Asset reproducibility.** Execute Rule 16 and emit the asset manifest plus clean-environment deployment method. Temporary-only or manually uploaded-only assets = FAIL.
20. **Mandatory remediation loop.** Execute Rule 10 for every score ≤85%. After 3 unsuccessful CSS-level attempts on the same gap, CSS tweaking MUST stop, but remediation MUST NOT stop: discard the current local hypothesis, recapture the fresh SITE_URL section, revisit ownership/role mapping/content model, make a structural or authoring redesign, redeploy to AEM, and rerun checks 0–19. Iteration count is never permission to declare done. Escalate only when a concrete external blocker requires user input (for example inaccessible source media, conflicting source authorities, or unavailable AEM); include exact evidence and mark the gate DEFERRED, never PASSED.

**Explicit blockers — the gate is NOT PASSED and the run is NOT DONE if any of the following is true:**
- No screenshot pair was captured in this run
- Any computed style differs from the design by more than the tolerance in check 3
- Any token custom property in the running page differs from the source
- Any deployed clientlib contains BEM rules that aren't in the source
- The browser was not opened (Playwright/Chromium never launched)
- The DESIGN_SOURCE URL was never actually fetched into a browser session in this run
- Source or target fonts/media/layout did not pass measurement readiness
- The deployed DOM lost or rewrote a required semantic/structural role
- Live repository content or sibling order differs from authored source content
- Required assets exist only as one-off local uploads with no reproducible deployment path
- The user did not receive at least one side-by-side screenshot in the response

**"User waived deploy" is NOT a waiver of visual parity.** Deploy skipping only defers checks 0–19 until a running AEM is available; it does NOT delete them. On the very next turn where a running AEM exists, the gate MUST be executed before any other work continues. Report gate status explicitly at the top of every Final summary: `VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations — minimum instance <score>% — minimum component type <score>% — minimum page composite <score>% (required >85%)` OR `VISUAL PARITY GATE: DEFERRED (reason: no running AEM) — MUST RUN on next turn`. Anything else is a defect.

**"Missing DAM assets" is NOT a waiver of visual parity.** Text-only, layout-only, token-only, and interactive-state parity checks (typography, color, spacing, radii, shadows, cascade origin, hover/focus states, initial states) MUST still run and pass; missing assets only excuse the per-image pixel diff, not the surrounding chrome. If assets are missing, download them from DESIGN_SOURCE (Mode D/E/F) or from the Figma export (Mode A/C/F) and upload to the DAM as part of this run — do NOT defer.

## Structural parity contract — MANDATORY (per-block DOM + geometry + role mapping)
Computed-style matching on your own selectors is NOT enough. You can pass every hex / font / spacing check while still shipping a component whose block-level composition looks nothing like DESIGN_SOURCE — because you compared your selectors against themselves, not against what the source actually rendered. This class of miss is a **hard fail**.

**Before component decomposition, create a source-section ownership manifest:**
- Start at each visible section heading (or the nearest semantic section/landmark when no heading exists) and capture the nearest ancestor that owns all visually grouped content beneath that heading. Record its bounding box, direct visual regions, region order, region count, and each region's role signature such as `featured`, `supporting-list`, `card`, `media`, `controls`, or `pagination`.
- Produce a coverage map from every source region to its target owner. Coverage MUST be exactly once: no omitted source region, no source region claimed by multiple target components, and no target region without a source counterpart.
- Preserve heterogeneous composition. A source with one large featured item plus three smaller supporting items has two distinct layout roles and four content roles; it is NOT equivalent to three equal cards. Role type, cardinality, relative prominence, and adjacency are structural facts, not optional styling.
- Capture screenshot pairs using homologous boundaries: complete source section versus complete target section/composition at the same viewport and state. A crop of only the matching-looking subset is invalid evidence.

**Per-block, before writing HTL/CSS:**
- **Enumerate the source's rendered DOM for THIS block.** In the parity-gate browser session, walk the DOM tree of the corresponding region on DESIGN_SOURCE and record every visible element: `tagName`, `textContent` (first 60 chars), `className`, `getBoundingClientRect` (x, y, width, height), and the full computed style set (Media-fidelity + typography + color + geometry). Save this as the **source-DOM manifest** for the block. Do NOT skip this step because "I saw the screenshot".
- **Role map every source element to a target element.** Every visible node in the source-DOM manifest MUST map to an element you plan to render, playing the **same visual role**: a heading is a heading, a stat sentence is one sentence node, a fixed-width rectangular button is a fixed-width rectangular button. If the source has one italic-serif 38px sentence integrating "91%" and the body copy, do NOT split it into a small colored number + separate small body copy. If the source has full-width white rectangular buttons stacked vertically, do NOT ship small oval rounded pills in a row.
- **Copy geometry, not just palette.** For each mapped element record the SOURCE's `width`, `height`, `padding`, `margin`, `border-radius`, `display`, `flex-direction`, `grid-template-*`, `gap` and set them (via token OR literal in a scoped modifier) on the target. Byte-for-byte per A19. A `172px` fixed-width button is `172px`, not "roughly pill-shaped".
- **Zone/band composition.** If the source paints two adjacent full-bleed bands with different backgrounds (e.g. cloud stat zone + navy schools zone), the target MUST also render two adjacent full-bleed bands with the same two backgrounds. Squashing both zones into one flat block on a single background is a defect even if every hex matches.
- **Typography hierarchy per element.** The heading, stat, prompt, label, and pill each have a distinct role. Their font (family, size, weight, style — including `font-style: italic`, `font-variant`, `text-transform`), letter-spacing, and line-height MUST be copied per-element from the source, not "derived from a general typography scale". A stat rendered as a 38px italic navy serif-scale sentence and a stat rendered as a 40px bright red bold display number are two different components.

**Structural-parity gate checks (add to Step 10.5 as checks 11 / 12 / 13):**
- **Check 11 — source-DOM manifest exists.** For every Tier-4 (new) or Tier-2/3 (extended) component in the run, a source-DOM manifest MUST be captured and attached inline in the parity-gate output (or the reasoning trail). No manifest = gate FAIL.
- **Check 12 — role-map completeness.** Every element in the manifest MUST have exactly one corresponding element in the demo page's rendered DOM for that block. Missing roles (e.g. "AU has an italic navy stat sentence, mine has none") and orphan roles (e.g. "mine has a decorative red left-border card, AU has no such thing") are both FAIL.
- **Check 13 — bounding-box parity.** For each mapped element, source and target section-relative `x/y` plus absolute `width/height` MUST each be within the canonical **1 CSS px** tolerance at the same breakpoint, AND the flex/grid axis MUST match (row vs column, wrap vs no-wrap). Section-root page `y` is checked separately with both pages at `scrollY === 0`. Larger delta = FAIL and MUST iterate (change HTL structure OR CSS layout OR container width, not just tweak font-size).
- **Check 14 — source-section ownership coverage.** The source-section ownership manifest and coverage map MUST account for every direct visual region exactly once. Compare the complete target composition against the complete source section, even when implementation ownership spans multiple target components. Partial-section scoring or screenshot crops = gate FAIL.
- **Check 15 — composition signature and cardinality.** At each breakpoint compare region count, role sequence, visible item count, relative size class (`featured`, `supporting`, `equal`), and adjacency. Any missing role, extra role, equalized heterogeneous role, or changed featured/supporting hierarchy = gate FAIL and forces HTL/content-model redesign before CSS iteration.
- **Check 16 — responsive behavior/state matrix.** At each breakpoint record and compare layout behavior (`static-grid`, `feature-plus-rail`, `horizontal-scroll`, `carousel`), overflow, controls, pagination, initial active item, and the result of next/previous actions when present. A target carousel where the source is static, a static target where the source scrolls, or controls/state that differ = gate FAIL.

**Anti-pattern list — call these out by name if they appear in your review:**
- "The tokens match" ≠ "the layout matches". Token parity is necessary but insufficient.
- "The BEM classes are all present" ≠ "the block structure matches". Presence of a class is not proof of role match.
- "The section background hex matches" ≠ "the section composition matches". Two zones vs one zone is a structural difference.
- Substituting a semantically similar but visually different pattern (rounded oval pills ↔ rectangular buttons, colored callout number ↔ integrated italic sentence, split image+card ↔ full-width text link) without an explicit callout in the reuse decision is a defect.

## Media-fidelity contract — MANDATORY (video, audio, motion, animation)
If a block in DESIGN_SOURCE renders **video**, **audio**, **inline motion** (looping MP4/WebM, animated WebP/GIF, Lottie/JSON animation, autoplaying `<canvas>` demo, live embed like Vimeo/YouTube/Wistia, live SVG animation, or any element with `autoplay` / `loop` / `<source type="video/…">` / `<video>` / `<audio>`), the built demo page's matching block MUST render the SAME class of media — NOT a static image substitute.

**Non-negotiable rules:**
- **Same media class.** Video block → `<video>` with a real playable source. Audio block → `<audio>`. Lottie/JSON motion → the actual `.lottie` / `.json` payload driving a real player. Live embed → the same embed URL (or a locally hosted copy of the underlying video). Substituting a still image, poster-only, first-frame screenshot, or "we'll add it later" placeholder is a **defect**.
- **Fetch and host the real asset.** Download the actual media file from DESIGN_SOURCE (the `<source>` `src`, `data-src`, `poster` companion `.mp4`, or the CDN URL the embed loads) using `curl.exe --ssl-no-revoke` or Playwright network capture. Upload to `/content/dam/<project>/design/` via `curl -F "file=@<path>;type=<mime>" .../<folder>.createasset.html`. Verify `HTTP 200`, correct MIME, and non-zero bytes with HEAD; when HEAD omits `Content-Length`, use GET and count the response bytes. For images, also decode in the browser and require `naturalWidth > 0`.
- **Author the DAM path, not the CDN.** The demo page's `videoSrc` / `audioSrc` / motion property MUST point at `/content/dam/<project>/design/<file>`. Remote CDN URLs, `about:blank`, and empty strings are all defects.
- **Autoplay + loop + muted, cross-browser.** For background video the component MUST render `<video autoplay muted loop playsinline>` AND the accompanying JS MUST explicitly call `video.play()` on `loadeddata` (with a `.catch()` that flips the paused-state ARIA + class). Chromium's autoplay policy silently pauses `<video autoplay muted>` in a non-trivial number of contexts — the JS fallback is required.
- **Poster stays a companion, never the substitute.** A `poster="…"` fallback image is allowed IN ADDITION to the video, never INSTEAD of it. Poster URL points at a DAM asset too.
- **Interactive controls preserved.** If the source shows a Pause / Play / Mute / caption control, the built component MUST expose the same control with the same visual affordance and the same keyboard/screen-reader semantics. A Pause button that never actually pauses (because the video never starts) is a defect.
- **Reduced-motion respected.** Component CSS MUST include a `@media (prefers-reduced-motion: reduce)` rule that pauses looping video / hides autoplay motion / falls back to the poster. Verify at least one breakpoint of the visual parity gate under this preference.

**Visual parity gate — media check (adds to Step 10.5 checks 1–6):**
- **Check 8 — media reachability.** For every media-carrying block, verify `HTTP 200`, correct MIME, and non-zero bytes. Use HEAD first and GET as the required fallback when `Content-Length` is absent or zero. For images require successful browser decode with `complete === true`, `naturalWidth > 0`, and `naturalHeight > 0`. Missing, empty, undecodable, or 404 media = gate FAIL.
- **Check 9 — media playback probe.** In the parity-gate browser session, for every `<video>` on the rendered page, evaluate `{ paused, currentTime, readyState, duration, error }`. Required: `paused === false`, `currentTime > 0` after 3 s, `readyState >= 3`, `error === null`. Any failure = gate FAIL and MUST iterate (autoplay policy fix, MIME fix, DAM path fix, dispatcher/proxy fix).
- **Check 10 — video-vs-poster confusion.** If DESIGN_SOURCE has a video and the demo page renders only an `<img>` (or a `<video>` whose `currentSrc` is empty/404), that is a **hard fail** even if every other computed style matches — this is the exact class of defect the media-fidelity contract exists to prevent. Fix by downloading + hosting the real media, not by ignoring the check.

## Input modes
| Set                                        | Mode | Source of truth                                                    |
| ------------------------------------------ | ---- | ------------------------------------------------------------------ |
| FIGMA_URL only                             | A    | Figma MCP tools                                                    |
| DESIGN_FILE only (PDF; not `.fig`)         | B    | Local parser (PDF text/geometry/images)                            |
| FIGMA_URL + DESIGN_FILE                    | C    | Figma MCP wins; PDF is safety net                                  |
| SITE_URL only                              | D    | Live-page scrape: rendered DOM + computed styles + screenshots     |
| SITE_URL + DESIGN_FILE                     | E    | SITE_URL wins; PDF is safety net                                   |
| SITE_URL + FIGMA_URL (± DESIGN_FILE)       | F    | FIGMA_URL wins (design intent); SITE_URL/PDF are safety nets       |
| Neither / `.fig` without URL / no PDF/site | —    | STOP and ask                                                       |

All modes feed the SAME downstream pipeline (Steps 1 → 10). Every rule below that says "DESIGN_SOURCE" applies to whichever mode is active — the source of truth just swaps.

## Mandatory skills / tools
Read `.agents/skills/` first and follow each SKILL.md whose stated domain overlaps the task. In particular:
- **`create-component`** — sole owner of new-component scaffolding, dialog authoring, HTL, Sling Model + tests, per-component clientlib, and Core Component extension patterns. Invoke ONCE per Tier-4 (new) component and for Tier-2/3 (extensions) — pass the reuse decision as input. Do not paraphrase its mechanical details in this prompt.
- **`ensure-agents-md`** — run FIRST if `AGENTS.md` is missing.
- **`code-assessment`** — invoke on all generated Java/OSGi/Maven before declaring done.
- **`migration`, `dispatcher`, `aem-workflow`, `content-distribution`, `aem-rde`** — load on-demand when relevant.

**Figma MCP (Mode A/C/F)** — load `/figma-design-to-code` skill, then call in order per top-level frame:
`get_metadata` → `get_design_context` → `get_variable_defs` → `get_screenshot` → `download_assets`. Treat responses as a REFERENCE to adapt to the project's tokens/components, not final code.

**Figma URL parsing:** `figma.com/design/:fileKey/:fileName?node-id=1-2` → fileKey=`:fileKey`, nodeId=`1:2` (dash→colon). `branch/:branchKey/…` → use branchKey as fileKey. `/board/` = FigJam (use `get_figjam`); `/slides/` = Slides (STOP and ask); `/make/` = Make.

**Live-site scrape (Mode D/E/F)** — treat the rendered page as the design brief. Auto-crawl only `SITE_URL` and same-origin sub-resources. A design-critical image, video, font, stylesheet, poster, or motion payload may also be fetched from an alternate origin ONLY when its exact URL is directly referenced by the rendered DOM, computed CSS, or captured page network traffic. Fetch that exact resource only; do not crawl its origin or forward source-page cookies/credentials. Record the source URL and origin in the asset manifest. Do NOT crawl other pages, submit forms, exfiltrate cookies/analytics IDs, or inspect unrelated third-party embeds. Per target page:
- Open with a headless browser (Playwright: `open_browser_page`, `screenshot_page`, `read_page`, `run_playwright_code`).
- Run the measurement-readiness preflight before every capture. Set the viewport, then assert the actual `window.innerWidth`; record DPR/scale; verify each used font with `document.fonts.check()`; await decoded media; disable motion only for the static measurement pass; and wait for network plus layout quiescence. If any source image/media fails, retry the exact directly referenced source URL under the origin policy above or STOP with the exact failed URL — do not measure its collapsed box.
- Capture full-page screenshots at every design-defined breakpoint (default: mobile 375, tablet 768, desktop 1440; add any wider frame observed).
- Extract the rendered DOM per candidate block and its computed styles: `font-family`, `font-weight`, `font-size`, `line-height`, `letter-spacing`, `color`, `background-color`/`background-image`, `padding`, `margin`, `border`, `border-radius`, `box-shadow`, `gap`, `grid-template-*`, `flex-*`, `aspect-ratio`, `object-fit`. Record raw values byte-for-byte (A19 — no rounding).
- Enumerate media assets (`<img>`, `<picture>`, `<video>`, CSS `background-image`, inline/symbol SVG). Download to a local scratch folder for later DAM upload (Rules).
- **Video / audio / motion enumeration (Media-fidelity contract).** For every `<video>` on DESIGN_SOURCE also capture: every `<source>` `src`, `type`, `data-src`, the parent element's `autoplay` / `loop` / `muted` / `playsinline` / `poster` attributes, and the CDN URL of the actual video file (from `video.currentSrc` after the video decides which source to load). For live embeds (Vimeo/YouTube/Wistia) capture the underlying video URL when the embed exposes it; when it doesn't, download the highest-quality poster + the embed URL and record both. For Lottie/JSON motion capture the payload URL. Download all of these to the local scratch folder in the same discovery pass — they are Step 9 DAM uploads, not "future work".
- Extract page metadata (`<title>`, meta description, canonical, OG tags) for the demo page's page properties.
- Record copy verbatim per section for `instance_authoring_map`.
- Derive design tokens (Step 3) from the set of UNIQUE values across the captured computed styles — repeated color/font/spacing values become tokens; one-off values do not.

**Site URL parsing:** any `http(s)://` URL is valid. Navigation/crawling remains same-origin; only directly referenced design-critical resources qualify for the exact-URL alternate-origin exception above. If `SITE_URL` returns a login wall, geo-block, JS-only shell that never resolves, or robots-disallowed path, STOP and ask.

## Rules
- **DESIGN_SOURCE is source of truth.** When design and existing code disagree, design wins. No assumed styling, no invented variants (A3).
- **Reuse before create** (see Step 1.5). Tier order: (1) reuse project component as-is; (2) extend project component via `sling:resourceSuperType`; (3) extend Core Component; (4) create new. Duplicating a component is a defect. Same conceptual block + different look → **`style` (theme) variant on the SAME component**, NOT a sibling or new-prefixed component. Extension naming (only for true structural variants that can't be theme-switched): `<parent>-<qualifier>`.
- **Reuse must not disturb authors.** Any extension of an existing component MUST be additive and MUST NOT bloat the dialog, break existing authored instances, or change the pre-change default rendering. See the **Author-experience preservation contract**.
- **Generic component names — non-negotiable (A25).** Every component folder / Sling Model / clientlib category / BEM class MUST use a semantic kebab-case name that describes the *block role*, never the design, brand, campaign, or source Figma file. FORBIDDEN: any prefix or suffix derived from a brand, product, campaign, design-system nickname, Figma file slug, page name, version tag, or the project itself — for example `<brand>-hero`, `<design-key>-header`, `<slug>-footer`, `<name>-v2`, `<project-prefix>-cards`. ALLOWED names describe the role only: `hero`, `header`, `footer`, `services`, `destinations`, `steps`, `testimonials`, `logos`, `subscribe`, `pricing`, `faq`, `contact-form`, `rating-strip`, `portfolio`, etc. If discovery (Step 0) finds any existing branded/prefixed component, Step 1.5 MUST rename it to the generic role name (folder + `<Name>Model.java` + clientlib category + BEM classes + every `sling:resourceType` in authored content) BEFORE proceeding — this rename is part of the run, not deferred. Different designs of the same block coexist via `style` variant, never via prefix.
- **Reuse templates and policies.** Never create a new template unless page structure demands it. Add components to existing policy `allowedComponents`, don't fork policy trees.
- **Exact values (A19):** copy hex, px, weights, line-heights, letter-spacing byte-for-byte from Figma. No rounding, no scale-snapping.
- **No hardcoded literals** in component CSS — reference tokens. Add a shared token if the design needs a new value.
- **BEM:** `.cmp-<name>__<el>--<mod>`. Vanilla CSS in existing clientlib structure. No new build tooling.
- **Assets on DAM** — upload every extracted image to `/content/dam/<project>/design/`. No remote/temporary URLs.
- **Media assets = full class.** Every `<video>`, `<audio>`, `.lottie`, `.json` motion payload, and animated `.webp` / `.gif` observed in DESIGN_SOURCE MUST be downloaded and uploaded to `/content/dam/<project>/design/` alongside the images (see the **Media-fidelity contract**). Static-image substitutes are defects.
- **Icons = inline SVG with `currentColor` (A7/A21).** Never substitute Unicode/emoji (`→`, `★`, `✓`, etc.) for a designed glyph.
- **No image `filter:` effects** (grayscale, opacity, blend) unless the design shows them (A16).
- **i18n static labels** via `${'…' @ i18n}`.
- **Empty-state placeholder** for every component when `!model.hasContent && wcmmode.edit`.
- **Never modify** `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or `templates/*/initial|structure` (add policies only).
- Ask ONLY if DESIGN_SOURCE is missing/unreadable or a specific node can't be resolved; otherwise proceed autonomously.

## Parallelism — run independent work concurrently
Where work is independent, issue it in a SINGLE tool-call block (agent) or a SINGLE PowerShell command with parallel jobs (shell). Never batch calls that require an ID/path/output from an earlier call; execute those in dependency waves. Sequential execution of independent work is a defect, but parallelizing dependent calls is also a defect.

**Discovery (Step 0)** — execute these dependency waves:
- Wave 1, one parallel tool block: read `AGENTS.md`, `CLAUDE.md`, `README.md`, `.aem-skills-config.yaml`; list `.agents/skills/`, `apps/<project>/components/`, templates, and policies.
- Wave 2, Mode A/C/F: call Figma tools in their required sequence when an output feeds the next call; parallelize only calls whose required file/node IDs are already known and independent.
- Wave 2, Mode D/E/F: open `SITE_URL` first. After the page ID exists, capture independent breakpoint/source facts in the minimum safe dependency waves; do not call screenshot/read/evaluate before the page exists. Asset downloads may run in parallel only after exact URLs are enumerated.

**Scaffolding (Step 4)** — one batched call emits every file for EVERY Tier-4 / Tier-2 / Tier-3 component AND the shared tokens clientlib together. Do not scaffold components one at a time — each is independent of the others.

**Sample content (Step 9)** — every component's `_jcr_content/...` node under the demo page is written in the same batched call as the component files, or immediately after in a second batched call.

**Build (Step 10.1–10.2)** — one multi-threaded Maven invocation that skips the modules that don't change during component work:
```
mvn -T 1C install -PautoInstallSinglePackage -DskipTests -pl all,core,ui.apps,ui.apps.structure,ui.config,ui.content -am
```
`-T 1C` = one thread per CPU core. Keep FileVault validation enabled; validation errors block deployment. The selected reactor may still build required dependency modules through `-am`. Run `mvn -pl core test` BEFORE this invocation so a red model test aborts before deploy.

**Verify (Step 10.3–10.6)** — ONE parallel fetch + ONE batched grep:
```powershell
$base = 'http://localhost:4502'
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$headers = @{ Authorization="Basic $auth"; Referer="$base/" }
$page = '<demo-page-path>'
$proj = '<project>'
$components = @('hero','service-cards','faq','contact-form')   # per run
$urls = [ordered]@{
  disabled = "$base$page.html?wcmmode=disabled"
  editor   = "$base/editor.html$page.html"
  siteCss  = "$base/etc.clientlibs/$proj/clientlibs/clientlib-site.css"
  tokenCss = "$base/etc.clientlibs/$proj/clientlibs/clientlib-tokens.css"
}
foreach ($c in $components) { $urls["cl-$c"] = "$base/etc.clientlibs/$proj/components/$c/clientlibs/clientlib-$c.css" }

if ($PSVersionTable.PSVersion.Major -ge 7) {
  $results = $urls.GetEnumerator() | ForEach-Object -Parallel {
    try {
      $r = Invoke-WebRequest -Uri $_.Value -Headers $using:headers -UseBasicParsing -ErrorAction Stop
      [pscustomobject]@{Name=$_.Key; Status=[int]$r.StatusCode; Body=$r.Content}
    } catch { [pscustomobject]@{Name=$_.Key; Status=0; Body=''} }
  } -ThrottleLimit 8
} else {
  $jobs = foreach ($entry in $urls.GetEnumerator()) {
    Start-Job -ScriptBlock {
      param($name, $url, $requestHeaders)
      try {
        $r = Invoke-WebRequest -Uri $url -Headers $requestHeaders -UseBasicParsing -ErrorAction Stop
        [pscustomobject]@{Name=$name; Status=[int]$r.StatusCode; Body=$r.Content}
      } catch { [pscustomobject]@{Name=$name; Status=0; Body=''} }
    } -ArgumentList $entry.Key, $entry.Value, $headers
  }
  $results = $jobs | Wait-Job | Receive-Job
  $jobs | Remove-Job
}

# One batched grep sweep across every body:
$disabled = ($results | ? Name -eq 'disabled').Body
foreach ($cls in @('cmp-hero','cmp-service-cards','cmp-faq','cmp-contact-form')) {
  $n = ([regex]::Matches($disabled, [regex]::Escape($cls))).Count
  "{0,-30} {1}" -f $cls, $n
}
# Also assert: variant modifier counts, SightlyException count == 0, every clientlib Status == 200.
```
Expected wall-clock: 5–8 s for a full page.

## Dialog authoring contract (atomic-intent)
- One authoring concept → one field. Merge fields that always change together; keep independent ones separate.
- Every enumerated field has a sensible default. Required fields: `required="{Boolean}true"`. Non-obvious fields: `fieldDescription`.
- **Color-like properties** offer a curated palette + `"other"` option that reveals a free-form hex textfield via `cq-dialog-dropdown-showhide`.
- **Repeating elements** → `granite/ui/components/coral/foundation/form/multifield` with `composite="{Boolean}true"`.
- **Image sources** → `pathfield` with `rootPath="/content/dam"`.
- **Body copy that spans multiple sentences / has emphasis (A8)** → `richtext`, not `textfield`. HTL renders with `context='html'`.
- **Tabs:** content → Properties; visual choices (color, alignment, density, side, offset, gutter) → Style.
- **Direction vs. Amount:** if side (`left|right`) and magnitude (`none|sm|md|lg`) vary independently, they are two fields. Direction → `justify-content` / `grid-template-areas`; amount → scoped CSS custom property.

## Sling Model contract
- `@Model(adaptables = Resource.class, defaultInjectionStrategy = OPTIONAL)`.
- `@ValueMapValue` per dialog field with `@Default` matching dialog defaults.
- Multifield → `@ChildResource List<ChildItemModel>`; child exposes `hasContent()`; filter empty items in `@PostConstruct`.
- Expose `getBackgroundStyle()` returning `"background-color: <hex>;"` ONLY when color=`"other"` AND hex is non-blank; else `null`.
- Expose `isHasContent()` for the empty-state guard.

## HTL contract
- Root: `<section class="cmp-<name> cmp-<name>--<enum1>-${model.enum1} ..." style="${model.backgroundStyle @ context='styleString'}">`.
- Context annotations always: `attribute`, `uri`, `styleString`, `html`.
- Include per-component clientlib via `data-sly-use.clientlib` + `clientlib.css @ categories='<category>'`.
- Guard optional blocks with `data-sly-test`.

**HTL iteration rule (prevents an entire bug class):**
- `data-sly-list` on a CONTAINER (`<ul>`, `<ol>`, `<tbody>`, `<div class="…__list">`) — host once, children N times.
- `data-sly-repeat` on the PER-ITEM element (`<li>`, `<article>`, `<tr>`, `<figure>`) — element itself repeated N times.
- If CSS/JS needs one DOM node per item, use `data-sly-repeat` on the element OR `data-sly-list` on its container — never `data-sly-list` on the per-item element itself (that renders ONE host containing all children and silently breaks accordions/tabs/carousels).

## Interactive-component contract (accordion, tabs, carousel, modal)
- JS hook via `data-cmp-is="<name>"` (NOT the BEM class).
- Scope every query to the component root; never `document.querySelectorAll`.
- Idempotent init via `data-cmp-initialized`.
- Multiple instances on one page must not interfere.
- Initial state matches the design frame — encoded at render time in class list AND ARIA attrs (`aria-expanded` / `aria-selected` / `aria-current`), not solely in JS.
- Semantic HTML: `<button type="button">` for triggers; `role="tabpanel"` / `role="region"` + `aria-labelledby` on panels.
- IIFE + `DOMContentLoaded`. No inline handlers, no globals.
- Load via per-component clientlib (`js.txt` + `js/<name>.js`), same category as the CSS.
- Smoke test after deploy: rendered item count == `getItems().size()`; JS URL returns 200; grep for `data-cmp-is` and the toggle class.

## Style-variant contract (multi-design reuse) — MANDATORY when a shared block appears in more than one design
When the same conceptual block (hero, header, footer, services, …) exists in a second design with a different look, do NOT create a second component. Extend the existing generic one:
- **Model:** add `@ValueMapValue @Default(values = "<style-key-a>") private String style;` and a `getStyle()`. Value keys are short, kebab-case, role-neutral labels chosen by the run (e.g. `style-a`, `style-b`, `default`, `alt`) — never derived from a brand, product, campaign, or Figma file slug.
- **Model fields:** superset both designs. Fields used by only one style keep sensible `@Default`s and are guarded in HTL by `data-sly-test="${model.style == '<key>'}"`. Multifield children may also carry a per-item `style` field when the same list renders differently between designs. Before adding ANY new field, exhaust reuse of existing semantically-equivalent slots (see Author-experience preservation contract).
- **Dialog:** add a `Design Style` select at the top of the Style tab with all supported keys and a `selected` default matching the first design; **hide style-specific fields with `cq-dialog-dropdown-showhide` off the Design Style select** so authors only see fields that apply to the chosen style; only when showhide is impractical (e.g. shared containers), label design-specific fields with a `(<style-key>)` suffix in `fieldLabel`; use `fieldDescription` when the intent isn't obvious. Never make a new style-specific field required.
- **HTL:** the root element carries **both** `cmp-<name>` and `cmp-<name>--style-${model.style @ context='attribute'}`. Structure that differs between designs lives inside sibling `<sly data-sly-test="${model.style == '<key>'}">` blocks — never in JS, never selected at render by CSS alone.
- **CSS:** each style's rules are scoped under `.cmp-<name>--style-<key>` selectors (or land in a separate `<name>-<key>.css` file added to the same `css.txt`). Never redefine base `.cmp-<name>__…` rules to switch look; add a modifier scope instead.
- **Tokens:** design-specific tokens are declared under a design-scoped `:root` block (e.g. `--<style-key>-*`) in the shared tokens clientlib and consumed only inside that style's scoped selectors. Do NOT put design-specific values in the site-wide `body,html` block.
- **Site clientlib global resets:** never write `[class^="cmp-"]` selectors that would bleed into AEM Core Components. Scope resets either to an explicit list of this project's block roots (`.cmp-hero, .cmp-header, …`) or to a `--style-<key>` modifier.
- **Authoring:** each authored instance sets `style="<key>"` explicitly (or omits it to accept the model default). The `instance_authoring_map` records the `style` value per instance.
- **Reuse decision row:** when the shared block already exists in the project, Step 1.5 records it as Tier 2 with `additions: ["style variant '<key>'", "<style-key>-only field 1", …]` and the `gap` states "new design theme; same conceptual block, extended via `style` variant". Creating a second component (Tier 4) with a duplicate concept is a defect.

## Author-experience preservation contract — MANDATORY on every reuse (Tier 1/2/3)
Extending an existing component must feel invisible to authors of pre-existing content. Enforce every rule below:
- **Additive only.** Never remove or rename an existing dialog field, model getter, BEM class, style option, resource-type node name, or property key. Downstream authored content depends on them. Renaming = migration work the run does not own.
- **Reuse dialog slots aggressively.** Before adding a new field, map the design's data to existing fields with a semantically equivalent role: `image` covers photo / portrait / illustration / hero visual; `tagline` covers eyebrow / kicker / label; `description` covers subhead / lede / body copy; `ctaLabel` + `ctaLink` cover any single primary CTA; `backgroundImage` covers any full-bleed image. Only introduce a new field when NO existing slot can carry the value without conflicting with another style.
- **Every new field is optional.** New fields MUST have a sensible `@Default` in the model AND MUST NOT set `required="{Boolean}true"` in the dialog. The component MUST render acceptably when the new field is blank.
- **Style-scoped visibility.** Hide style-specific fields from the dialog when they don't apply, using `cq-dialog-dropdown-showhide` bound to the Design Style select. The author sees only what's relevant to the chosen style. Fallback (only if showhide isn't possible for that field's container): suffix `fieldLabel` with `(<style-key>)`.
- **Preserve the shipped default.** The Design Style select's `selected="{Boolean}true"` MUST stay on the pre-change default option. Never demote or re-order existing options such that a previously authored instance switches look.
- **Zero regression on existing instances.** Every previously authored instance (any style value, including empty/default) MUST render within the canonical parity tolerances at every breakpoint after the change. Discover and render EVERY pre-existing page that uses the component alongside the new page, then diff the output — HTML, computed styles on the root and two nested elements, and screenshots.
- **No new required steps.** Do not add mandatory dialog tabs, mandatory container structure, mandatory clientlib includes, or mandatory policy changes to the existing component. Existing pages must open in the editor without new validation errors.
- **Author-facing labels stay generic.** Style option `text` values describe the visual role or layout ("Split + Illustration", "Full-bleed", "Centered"), never a brand, product, campaign, page name, or Figma file slug. The internal `value` key follows the same rule (see A25 / generic-name enforcement).
- **Don't fork templates or policies to expose a variant.** The new style must appear wherever the component is already allowed. Do not create a new template solely to host it; do not fork the policy tree.
- **Interactive contracts survive.** The `data-cmp-is` hook, `data-cmp-initialized` guard, ARIA state, and any keyboard handlers MUST continue to work for existing instances with no code changes on the author's side.
- **Editor-mode verification.** Load `/editor.html<pre-existing-page>.html` for every pre-existing page that hosts the component, open the component's dialog, and confirm: (a) the dialog opens with no console errors, (b) previously authored values populate the same fields, (c) no orphan fields are visible for the current style, (d) the empty-state placeholder still fires when appropriate.

Any violation of the above blocks the run — fix the extension, not the audit.

## Per-instance spatial-authoring rule
For every visual delta between sibling instances (alternating offset, variable side gutter, section padding, alignment, vertical stagger, column-order swap):
- Dialog field: select with token-named options (`none / sm / md / lg`) or numeric, sensible default matching the most common Figma instance.
- Sling Model: `@ValueMapValue` + `@Default` + getter.
- HTL: `cmp-<name>--<field>-${model.<field> @ context='attribute'}`.
- CSS: modifier class sets a scoped CSS custom property; layout reads that variable. Tablet/mobile media queries reset the variables to a centered default.
- Sample content authors each sibling instance with the EXACT per-instance values shown in the design.

## CSS contract
- One CSS file per component under `ui.apps/.../clientlibs/clientlib-<name>/css/`.
- One selector per modifier class — don't stack unrelated concerns.
- "Card hugs one side": use `justify-content: flex-start | flex-end` (or grid `justify-self`), NOT margins/translates. Card `max-width` = `calc(var(--<project>-container-max) - var(--<project>-space-N))`.
- "Image other side": swap `grid-template-areas` or `flex-direction: row-reverse` in the modifier class.
- Tablet ≤1024px collapses side-by-side to stacked+centered; mobile ≤640px reduces padding. Use design-frame widths if multiple exist.
- **A15 — proportional inner container.** If the design frame's usable content width is materially smaller than the project container-max, cap the component's inner container to a shared narrower token FIRST — before adjusting `justify-content` / `gap` / margins — otherwise `space-between` / `flex-wrap` / `1fr` distribute unbounded remaining space and siblings drift apart visually.

## Page-level styles (A9)
Body background, base font-family/color/size/line-height, section vertical rhythm, default link color and focus-outline live on the site clientlib (`body` or `.das-page` wrapper), NOT per component. If a component's CSS repeats a `body`-level style, move it to the site clientlib.

## Web-font loading (A6)
Recording a font family as a token is not enough. For every non-system font in DESIGN_SOURCE, wire an `@font-face` (self-hosted `.woff2` under `clientlib-tokens/fonts/`) OR licensed CDN `<link>` in the tokens clientlib. `font-display: swap`. Ship only the weights the design uses. Verify computed `font-family` in the browser matches the token.

## Image rendering (A10)
For every image slot: `aspect-ratio: <w> / <h>` from the design, `object-fit: cover | contain` per intent, wrapper `overflow: hidden` when the design shows rounded media corners.

## Accessibility floor (A12)
Enforced even when the design is silent: `:focus-visible` ring, 44×44 CSS px hit-targets on mobile, WCAG 2.1 AA contrast (≥4.5:1 body, ≥3:1 large), semantic landmarks, heading order, `<button>` for actions, `<a>` for navigation, meaningful `alt` (empty for decorative). If the design's contrast fails AA, adjust the color token to the nearest compliant value and flag in the Final summary.

## Unit-test contract
JUnit 5 + wcm.io AEM Mocks, `AppAemContext.newAemContext()`, one test class per component:
- `defaultsWhenEmpty` — empty resource; assert defaults, `getBackgroundStyle() == null`, multifield empty, `isHasContent()` matches empty expectation.
- `configuredFully` — every field set including color=`"other"` + valid hex + populated multifield; assert every getter and `getBackgroundStyle() == "background-color: <hex>;"`.

Run `mvn -pl core test -Dtest=<ModelName>Test` before deploying.

## Content-package gotcha
`ui.content` typically uses `mode="merge"` — it may preserve stale properties, skip nested recreation beneath modified ancestors, and leave newly recreated nodes at the end of sibling order. Before deployment, classify every intended content change as create / update / delete / reorder and choose an operation that owns that change. After deployment, fetch live repository JSON and verify the exact resource type, properties, child names/count, and order; package XML is not evidence of live state. If reconciliation is needed, use an explicit update-capable package operation or authenticated Sling POST with CSRF. Create a child through the parent's wildcard child endpoint with an explicit child name; posting child properties to the parent resource mutates the parent. Reorder explicitly, then re-read both parent and child JSON and confirm the parent resource type remains unchanged. Never assume delete + merge reinstall recreated the subtree.

## Step 0 — Discover
- Read `AGENTS.md`, `CLAUDE.md`, `README.md` → build command, module layout, package prefix, component group, clientlib naming, content root.
- List `.agents/skills/` and record each SKILL.md `name` + `description`.
- Inventory `ui.apps/.../apps/<project>/components/`: for each, capture folder, `jcr:title`, `componentGroup`, `sling:resourceSuperType`, top-level dialog tabs/fields. Note Core Components already in use.
- Inventory `conf/<project>/settings/wcm/templates/` and `.../policies/`.
- Determine mode (A/B/C/D/E/F).
  - Mode A/C/F: parse Figma URL → fetch Figma via the tool sequence above and pull assets to a local scratch folder.
  - Mode B/C/E: parse DESIGN_FILE (page count, per-page text/fonts/colors/geometry/embedded images).
  - Mode D/E/F: parse SITE_URL → open in headless browser, capture per-breakpoint screenshots, rendered DOM, computed styles, and download every design-critical same-origin or directly referenced alternate-origin asset allowed by the live-site origin policy to a local scratch folder.
- Record raw values; do not paraphrase.

## Step 1 — Decompose the design
Per distinct reusable block: semantic kebab-case name, variants/modifiers (→ dialog selects), author-editable fields, interactive state and initial/active behavior, repeating children (→ composite multifield + child model).

## Step 1.5 — Reuse-first decision (MANDATORY before Step 4)
Pick the highest tier that satisfies the design without loss of fidelity:

| Tier | Meaning                    | Emit                                                                                             |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| 1    | Reuse project component    | Sample content only; optionally one dialog option overlay via Sling Resource Merger.             |
| 2    | Extend project component   | `.content.xml` with `sling:resourceSuperType`, delta dialog overlay, delegating model.           |
| 3    | Extend Core Component      | Same mechanics via `@Self @Via(type = ResourceSuperType.class)` + `implements ComponentExporter`.|
| 4    | Create new                 | Full deliverable via `create-component` skill.                                                   |

Tier 4 requires the `gap` string to rule out tiers 1–3 explicitly. Same-fields-different-look → variant select on ONE component. Different fields/structure → sibling extension via `sling:resourceSuperType`, named `<parent>-<qualifier>`. Two components in the same group with >80% dialog overlap = defect.

**Author-facing disambiguation.** When a base + sibling extension coexist: distinct `jcr:title` and `jcr:description`, both listed in the policy's `allowedComponents` in order (base first), distinct `cq:icon` where possible.

Emit the decision as a `design-facts` YAML block **inline in the response** (do not create a file):
```yaml
reuse_decisions:
  - design_block: "<name>"
    tier: 1 | 2 | 3 | 4
    reuse_target: "<project>/components/<name>" | "core/wcm/components/<name>/vN/<name>" | null
    gap: "<one-line justification if tier > 1, else 'none'>"
    additions: ["<delta dialog field>", "<delta variant>", "<delta CSS modifier>"]
template_decision:
  reuse_template: "<template-name>" | null
  new_template_gap: "<justification if new>"
policy_decisions:
  - policy_path: "<existing-policy-path>"
    additions: ["<resource-type added to allowedComponents>"]
instance_authoring_map:
  - design_instance: "<Figma frame label OR site DOM selector / section heading>"
    resource_type: "<project>/components/<name>"
    parent_path: "<content path under the template's editable region>"
    node_name: "<unique node name — e.g. teaser_hero>"
    dialog_values:
      style: "hero"
      title: "<exact copy from Figma or SITE_URL>"
      # ...every non-default field from that instance
```
Rules: one row per source instance in reading order (Figma frame in Mode A/C/F; rendered section in Mode D/E); `resource_type` MUST match `reuse_target` or a Tier-4 new component (no orphans); same resource_type + different dialog values = correct outcome for "same component, different look"; `node_name` hints at the variant, never `_1` / `_2`.

## Step 2 — Extract design facts
Per component: outer container width, page gutter (per instance), section padding, internal gaps, per-element padding/margin, radius/border/shadow, per-text-style font (family/weight/size/line-height/letter-spacing/color), background/text/border/accent color hex, icon dimensions, image aspect ratios, hover/focus/active states, responsive intent. Cross-check ambiguous geometry against the matching artefact: Mode A/C/F → Figma PNG; Mode B/C/E → DESIGN_FILE embedded image; Mode D/E → the per-breakpoint SITE_URL screenshot + computed-style capture (the computed style is authoritative when Figma is absent). **Per-instance spatial deltas** across N sibling instances = dialog fields (per the spatial-authoring rule).

## Step 3 — Shared design tokens
Create or update the shared tokens clientlib. If DESIGN_TOKENS_JSON exists, map 1:1 to CSS custom properties. Otherwise derive tokens from Step 2 repeated values. Add tokens for every unique value including spatial-offset tokens.

## Step 4 — Realise blocks via reuse tier
- **Tier 1:** no code — only sample content in Step 9 (plus optional dialog overlay).
- **Tier 2/3:** invoke `create-component` with the parent as `sling:resourceSuperType`; emit ONLY delta files (dialog overlay, delta model, optional CSS modifier). Do NOT re-emit parent HTL/dialog/model/clientlib.
- **Tier 4:** invoke `create-component` in full with the spec (name, group, dialog fields with types / required / defaults / descriptions, variants including spatial fields and color `other` / hex, Properties / Style tabs, tokens, breakpoints, interactive behavior). Per-component clientlib depends on the shared tokens clientlib.

## Step 5 — CSS parity
Apply design values via tokens. For every component that renders multiple times: diff the N instances (offset, stagger, alignment, side margin, column order, gutter) and confirm dialog field + BEM modifier + CSS custom property + layout property reading it. Confirm tablet/mobile media queries reset per-instance vars to the centered default.

## Step 6 — HTL structural validation
Apply the HTL iteration rule for every multifield/list. Every per-item element that JS/CSS addresses individually carries `data-index="${itemList.index}"`. After Step 9, verify rendered DOM has N sibling per-item elements.

## Step 7 — Interaction correctness
Scope queries to root; on state change clear siblings first; support multiple instances; `data-cmp-initialized` guard; first item active on load; ARIA reflects state at render.

## Step 8 — Clientlibs
Every per-component clientlib depends on the shared tokens clientlib. Site-level wiring (embed OR HTL include) delivers all styling on any page.

## Step 9 — Author the demo page
Under the project's content root, create a sample page. Reuse the best-matching existing template. Drop components in the design's reading order, populated with the design's copy and images. Upload every extracted image to `/content/dam/<project>/design/`. When the design shows N sibling instances with alternating variants/offsets, author those EXACT per-instance values in the same order. Author under the template's editable region path (inner responsive-grid container, NOT the page root). If schema changed on already-authored nodes, apply the content-package gotcha recovery.

## Step 10 — Build, install, verify
1. `mvn -pl core clean test` — green before deploying.
2. Local install (`mvn install -PautoInstallSinglePackage -DskipTests` or equivalent). BUILD SUCCESS with 0 analyser warnings.
3. **Fetch demo page** with `?wcmmode=disabled`, Basic auth `admin:admin`, `Referer` header. Verify in ONE batched grep pass:
   - Every component's BEM root class appears.
   - List-driven components: per-item element count == authored multifield size.
   - Stateful components: exactly ONE per-item element carries the initial `--active` modifier + matching `aria-selected="true"`.
   - Each per-instance spatial variant modifier class count matches DESIGN_SOURCE.
   - `other`+hex color instances emit inline `style="background-color: #…"` on the root.
   - Zero `SightlyException`.
    - Every expected semantic wrapper survives deployed rendering (`a[href]`, `button`, media/card wrappers, parent-child relationships).
    - Rendered component order matches DESIGN_SOURCE and live repository sibling order.
4. **Fetch deployed clientlib CSS** for each per-component clientlib and confirm modifier rules are present (defends against stale-cache).
5. **Visual parity (A4/A11) — RUN THE VISUAL PARITY GATE.** This is not optional and not a "when you have time" step. Execute every check in the *VISUAL PARITY GATE — MANDATORY, NON-SKIPPABLE, HARD-FAIL* section above, in order, at every design-defined breakpoint. Measurement readiness + side-by-side screenshots + computed-style diff + token audit + stale-clientlib check + cascade-origin check + **media reachability (check 8) + media playback probe (check 9) + video-vs-poster confusion (check 10) per the Media-fidelity contract** + **source-DOM manifest (check 11) + role-map completeness (check 12) + bounding-box parity (check 13) + source ownership/cardinality/behavior (checks 14–16) + deployed-role preservation (check 17) + live repository reconciliation (check 18) + asset reproducibility (check 19)**. Passing checks 1–4 above does NOT release you from this step.
6. **Author-mode parity (A17).** Load `/editor.html<demo-page-path>.html` and verify computed `font-family`, `background-color`, `color`, gradients / shadows / borders / radii match the design at every breakpoint. Ignore only editor chrome and empty-state placeholders.
7. Iterate on any mismatch: token → CSS → dialog option → component redesign → content/repository reconciliation. For every score ≤85%, reload SITE_URL, refresh source evidence, change the failing implementation, redeploy to AEM, and rerun the complete gate. After 3 CSS-level attempts, move to structural/content-model redesign; do not stop remediation because an attempt count was reached. Escalate only for a concrete external blocker requiring user input, with a screenshot pair and a specific A/B question.
8. **Gate status line — MANDATORY.** Before writing the Final summary, emit exactly one of:
    - `VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations — minimum instance <score>% — minimum component type <score>% — minimum page composite <score>% (required >85%)`
   - `VISUAL PARITY GATE: DEFERRED (reason: <exact reason>) — MUST RUN on next turn`
    `VISUAL PARITY GATE: FAILED — <specific delta> — revalidating SITE_URL and redeploying` is an INTERIM progress status only and MUST NOT appear as the terminal Final summary. Any Final summary written without PASSED or a genuine-blocker DEFERRED line is a defect.

## Deliverables per block
| Tier | Files                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Sample authored content only. Optional dialog overlay via merger. No new component files.                                            |
| 2/3  | `.content.xml` (with `sling:resourceSuperType`), delta `_cq_dialog/.content.xml`, delegating `<Name>Model.java`, delta CSS/JS if any, `<Name>ModelTest.java` (delta getters), sample content per variant. |
| 4    | Full: `.content.xml`, `_cq_dialog/.content.xml` (Properties + Style), `<component>.html`, `<Name>Model.java` + child models, `clientlib-<name>/` (`.content.xml`, `css.txt`, `css/*.css`, optional `js.txt`, `js/*.js`), `<Name>ModelTest.java` (`defaultsWhenEmpty` + `configuredFully`), sample content per variant, resource type added to existing policy `allowedComponents`. |

## Final summary
Include: skills loaded from `.agents/skills/`; Step 0 inventories; reuse-decision table (tier + gap + additions per block); component decomposition; skills invoked (must match tiers 2/3/4); design inputs consumed; tokens created / updated; per-component file paths (tier 1 says "no new files (reused <parent>)"); template + policy decisions; HTL iteration audit; per-instance spatial-field audit; unit-test results; rendered-DOM check results; deployed-clientlib check results; interaction guards applied; demo page path; build status; residual gaps.

**Evidence per component (A22):** screenshot pair (design + rendered) at every breakpoint, computed-style excerpt from DevTools/Playwright (`font-family`, `font-weight`, `font-size`, `line-height`, `background-color`, `color`, `padding`, `border-radius`, `box-shadow` on root and 2–3 nested elements), cross-referenced to the `design-facts` block. Apply the canonical measurement tolerances; larger deltas fail and must iterate. If browser tooling unavailable, substitute rendered HTML + clientlib CSS excerpts + manual measurement callouts and state so explicitly, and mark the visual gate DEFERRED rather than PASSED.

## Discipline (do these on EVERY iteration)
- **Exact values (A19):** copy hex / px / weight / line-height / letter-spacing byte-for-byte. No rounding.
- **Figma auto-layout → CSS (A20):** direction → `flex-direction`; item spacing → `gap`; main-axis alignment → `justify-content`; cross-axis → `align-items`; sizing (Hug / Fill / Fixed) → intrinsic / `flex: 1` / explicit px; wrap → `flex-wrap`. Absolute children → `position: absolute` on child + `relative` on parent.
- **`design-facts` block (A18)** posted inline before writing code and updated before every iteration. Every CSS/HTL/dialog line traces to a row in the current block.
- **Additive changes (A5):** add a new token / dialog option / BEM modifier rather than mutating existing ones. Downstream authored content depends on them.
- **Unclassifiable elements (A13):** STOP and ask with a screenshot region reference. Never substitute a lookalike Core Component.
- **Reuse enforcement (A24):** every design block has a `reuse_decisions` row with tier + gap. Tier 4 requires the gap to rule out 1–3. Extension diff must contain only declared `additions`. No new policy tree without a new template.
- **Generic-name enforcement (A25):** before Step 4, grep the target project for any component folder / model / clientlib category / BEM class whose name contains a brand, product, campaign, design-system nickname, Figma file slug, page name, or version tag as a prefix or suffix (i.e. anything other than the pure block role name). Rename each to the generic role name in the same run. A component named after a design, brand, or source file is a defect — the correct outcome is a single generic component with a `style` variant per design. Same conceptual block authored twice under different prefixes = duplication defect.