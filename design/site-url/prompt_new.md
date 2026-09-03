# AEM Page Migration

## Inputs

```yaml
SITE_URL: "https://www.omnicomglobalsolutions.com"
# Optional: TARGET_PAGE_PATH, BREAKPOINTS, EVIDENCE_DIR
```

`SITE_URL` must be readable or STOP with the failing URL and browser/network evidence.

## Objective

Reproduce the complete visible source document as reusable, authorable AEM as a Cloud Service components: global chrome, all main regions, headless/decorative bands, responsive-only variants, overlays, consent UI, floating utilities, and interactions. Linked pages are out of scope unless supplied separately.

Deliver Sling Models, HTL, Coral 3 dialogs, BEM CSS, shared tokens, clientlibs, focused tests, deployable assets, policy updates, and a populated demo page. Validate disabled and author modes at every observed breakpoint (default `375`, `768`, `1440`). A successful build is not completion; the Visual Parity Gate controls completion.

## Stage Router

Read only the reference needed for the active stage. Do not load every reference up front.

1. **Source discovery and coverage** — read [01-source-discovery.md](01-source-discovery.md). Complete and freeze its evidence before inspecting the target.
2. **Reuse, component implementation, and authoring** — read [02-component-authoring.md](02-component-authoring.md). Use its contracts for every discovered block.
3. **Assets, build, deployment, and runtime checks** — read [03-assets-runtime.md](03-assets-runtime.md).
4. **Visual parity and remediation** — read [04-visual-parity.md](04-visual-parity.md). Use `design/site-url/component_parity.py` as the mandatory component screenshot, geometry, pairing, scoring, and `>92%` gate runner. Run it after every deploy affecting appearance or behavior.
5. **Completion report** — read [05-completion-output.md](05-completion-output.md) only when preparing the final response.

If a later stage exposes missing or stale evidence, return to the owning stage, refresh that evidence, and continue. Never compensate for missing discovery or content by tuning CSS.

## Non-Negotiable Rules

- `MUST`, `FAIL`, and `STOP` are completion-blocking. STOP only for unreadable/missing sources, conflicting authorities, unresolved external blockers, or explicit user input requirements. Other failures require in-turn remediation.
- No visible block may be omitted, including headless blocks such as marquees, tickers, announcement bars, background-media strips, and overlays.
- Every business-editable value must be authored. Do not hardcode copy, links, assets, item counts, or visual choices unless the component contract explicitly permits it. The exhaustive list of hardcoding anti-patterns (copy literals in HTL/model/CSS, `href` defaults, inlined brand SVGs, per-page magic numbers) is in [02-component-authoring.md](02-component-authoring.md) → "Hardcoding Anti-Patterns"; each is a Stage 2 stage-result failure, not a stylistic preference.
- Every color role uses a curated token select with `other`; choosing `other` reveals a validated custom-hex field. Models sanitize custom values and HTL exposes them only through protected CSS custom properties.
- Every authored image, video, audio, poster frame, brand logo, favicon, OG image, personnel photo, or download PDF lives under `/content/dam/<site>/<locale>/<role-folder>/<meaningful-name>.<ext>` and is referenced from the authored node via a Coral 3 `pathfield`/`pathbrowser` rooted at `/content/dam` — never from `apps/.../clientlibs/.../resources/**`. Component clientlib `resources/**` is reserved for structural design-system atoms whose invariance is proven by Stage 1 evidence. Assets acquired during Stage 3 land in DAM in the same edit, not "moved later". See [02-component-authoring.md](02-component-authoring.md) → "Assets: DAM Placement Rules" and [03-assets-runtime.md](design/site-url/03-assets-runtime.md) → "Assets And Motion".
- Author DAM paths, never remote or temporary URLs. Preserve media class: video remains video, animation remains animation, and a poster is not a substitute.
- Use Playwright/Chromium for live source and target evidence. Property equality alone cannot establish visual parity.
- Every component instance, component-type minimum, and page composite must be strictly `>92%` at every required breakpoint. `92.000%` fails.
- A component passes only when exhaustive source coverage, geometry, property, screenshot, interaction/media, and authorability checks all pass.
- User rejection invalidates the affected evidence and score; recapture and remediate.
- Never modify generated/vendor paths: `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or template `initial`/`structure` trees.
- **Evidence cleanup at completion is mandatory.** Once Stage 04 emits `VISUAL PARITY GATE: PASSED` and Stage 05 has produced its report in the same turn, run `python design/site-url/cleanup_evidence.py --full` as the final action. `--full` wipes BOTH (a) every temporary artefact under `evidence/` — per-block source/target/mask/side-by-side PNGs, full-page captures, downloaded source assets, frozen source/target manifests, `evidence/02-assets`, `evidence/node_modules`, and any other scratch tree — leaving only a `.gitkeep`, AND (b) the pipeline-scratch runner scripts under `scripts/` that this pipeline emitted during Stages 1-3 (`stage1_discovery.py`, `stage2_download_assets.py`, `stage2_place_dam.py`, `stage3_author_xfs.py`) plus every `build.log` at the repo root and per-module. `design/site-url/cleanup_evidence.py` and `design/site-url/component_parity.py` are the mandatory shipped runners and are NOT scratch — they must remain on disk. Safe-prune (default mode) is only for mid-pipeline size relief; at completion, `--full` is the required invocation. Cite the pre-/post- cleanup footprint (files, MB) for both trees in the completion summary. Do NOT run cleanup while Stage 04 is still iterating (the crops are the remediation queue and the runner scripts drive it). Do NOT leave either tree populated for the user to clean up in a later turn. If Stage 04 exits `BLOCKED` rather than `PASS`, skip cleanup — the crops and runner scripts are the blocker's proof.
- A failing parity score, a failing gate check, a failing component axis, an incomplete breakpoint sweep, or an unfinished remediation is **never** grounds for pausing, asking the user whether to continue, or handing back for approval. Keep iterating the Stage 04 Remediation Loop autonomously until every raw instance, component-type minimum, and page composite is strictly `>92%` at every required breakpoint, until every failing row has hit its 5-iteration cap and been parked, or until a genuinely unrepairable external blocker is documented in the current turn.
- **Per-component iteration cap: 5.** No single component/breakpoint pair may consume more than 5 complete remediation iterations (edit → build → deploy → reconcile → rescore) in one Stage 04 pass. If a row is still under threshold after 5 iterations, mark it `PARKED — iteration cap reached` with its full score history and move immediately to the next-highest-priority failing row; never invest a sixth iteration on the same row in the same turn. Continue draining the queue with every other failing row's independent 5-iteration budget before revisiting parked rows (and only revisit if a shared-layer fix landed that might have moved them). Stage 04 may exit `PARTIAL` when every failing row has either PASSED or been parked — this is a first-class outcome alongside `PASS` and `BLOCKED`, and must enumerate each parked row's iteration scores, best-observed value, likely cause class (pixel-content divergence, cross-framework font, source-manifest overlap, image-byte divergence), and the concrete external precondition needed to unblock it. See [04-visual-parity.md](04-visual-parity.md) → "Per-Component Iteration Cap".
- Do not end a turn with a question, a proposal, or an “want me to continue?” prompt while any parity check, gate check, or coverage requirement is still failing and remediation options remain. Asking permission counts as an unauthorized STOP.
- Treat every current-run parity report as an executable remediation queue, not as a completion summary. Immediately implement every `unpaired-source`, missing-target, invalid-evidence, and `FAIL` row; deploy, recapture, and rescore until it passes. Merely listing failed components or suggesting future work is non-compliant.
- Remediate in this order: missing/unpaired source instances first, then invalid screenshot/evidence rows, then valid failures from lowest final score upward; break ties by frozen source reading order. Preserve already-passing components unless a shared-layer correction requires recapturing them.
- The populated author page must contain every source instance in the exact frozen source reading order. Checked-in content child order, live JCR child order, disabled-page DOM order, and author-page DOM order must all agree with the source manifest. Any missing, extra, duplicated, split/combined, or out-of-order instance is a hard failure that must be repaired before visual scoring can pass.
- The global site header and the global site footer are **mandatory blocks**. Stage 1 discovery must record both as discrete top-level blocks (or explicitly justify `absent` with evidence). Stage 2 must implement both as **Adobe Experience Fragments**, referenced from the editable template's `structure` tree via the Core Components `experiencefragment` component, and never inlined into the page component to chase a parity score. Consult the `create-component` and `migration` skills and the Experience Fragments Experience League reference (`https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/fragments/experience-fragments`) before implementing them. See [02-component-authoring.md](02-component-authoring.md) for the full contract.
- Every interactive role (link, button, card/tile with pointer affordance, media poster with play, disclosure control, sticky nav/CTA) is subject to the **Interactive States Contract**. Stage 1 captures an `interactive_states_manifest` covering initial/hover/focus-visible/active/transition per role and breakpoint; Stage 2 implements each row with an `interactive_states_target_matrix` that cites its Stage 1 source row; Stage 4 runs an **executable Playwright audit** (`page.hover` + computed-style diff + nested-child transforms + `:focus-visible` parity) and fails the page composite if any row differs from source. Inventing hover treatments, silently skipping them when source has one, or missing the `:focus-visible` mirror is a hard failure — CSS `:hover` rules with no measured source pairing are not evidence. See [01-source-discovery.md](01-source-discovery.md) → "Interactive-States Manifest", [02-component-authoring.md](02-component-authoring.md) → "Interactive States Contract", and [04-visual-parity.md](04-visual-parity.md) → "Interaction Gate".
- **Hover parity is a first-class delivery, not decoration.** Before Stage 04 may return `PASS`, execute an in-turn hover audit for every interactive role in the target's design-facts block: use `page.hover(selector)` to trigger, then compare `getComputedStyle` before/after against the frozen source snapshot for `color`, `background-color`, `border`, `box-shadow`, `opacity`, `transform`, `filter`, `text-decoration`, and every nested child transform (image swap, icon rotate/scale, label recolor). A target that ships a static tile/card/link where source flips images, translates, scales, changes color, or reveals a hover panel FAILs Stage 04 regardless of pixel score. Same for missing `:focus-visible` — every `:hover` treatment MUST have a keyboard-focus mirror or an explicit `@media (hover: none)` opt-out matching source's opt-out. Log the audit under `evidence/component-parity/interaction/<breakpoint>/<role>.json` with `{before, after, sourceBefore, sourceAfter, deltas, pass}` and cite it in the `stage_result`.
- Every animated instance — entrance/reveal animations, ambient/loop keyframe animations, scroll-linked or IntersectionObserver-driven motion, canvas/WebGL, Lottie/Rive, marquee/ticker cycles, autoplay/looping background video, animated SVG, and any hero-class ambient motion (for example the animated blurred wordmark background on omc.com) — is subject to the **Motion And Animation Contract**. Stage 1 captures a `motion_manifest` per instance (trigger, technology, timing, trigger geometry, playback state, `prefers-reduced-motion` behavior, and a full-cycle capture) or records `motion=none` with two-frame proof. Stage 2 implements each row in a `motion_target_matrix` — preserving technology class (no CSS-keyframe substitute for a canvas/WebGL/Lottie source), timing within 5%, trigger geometry within 24 CSS px, and identical `prefers-reduced-motion` behavior. Stage 4 runs an **executable Playwright Motion Gate** (animations enabled + two-frame pixel-change proof for loops + `page.emulateMedia({ reducedMotion: 'reduce' })`) and fails the page composite if any row differs from source. A high still-frame pixel score never offsets a Motion-Gate failure. See [01-source-discovery.md](01-source-discovery.md) → "Motion And Animation Manifest", [02-component-authoring.md](02-component-authoring.md) → "Motion And Animation Contract", [03-assets-runtime.md](03-assets-runtime.md) → "Assets And Motion", and [04-visual-parity.md](04-visual-parity.md) → "Motion Gate".

## Build & Remediation Efficiency

Frequent full rebuilds are the most expensive part of the Stage 04 loop. Reduce build count and build scope aggressively:

- **Batch remediation, then build.** Do not rebuild after every single CSS or HTL edit. Analyze the entire current parity report first, plan and apply fixes across every failing row that shares an owning layer (tokens, model, HTL, CSS, template, container, asset), then run one build+deploy+rescore cycle. A "fix one small thing → rebuild → rescore" loop is non-compliant. Only isolate a fix into its own cycle when it must be validated before an adjacent change can be reasoned about.
- **Group root-causes.** For each failing row, name the owning layer once and group edits that share the same layer/module into a single change set. Example groupings: all component-CSS spacing/token tweaks, all HTL/model changes, all authored content deltas, all asset uploads, all template/policy updates. Deploy each group together.
- **Prefer scoped builds over `mvn clean install`.** Only build the modules whose sources actually changed:
    - Component CSS/HTL/dialog-only change → `mvn install -pl ui.apps -PautoInstallPackage`.
    - Authored content change → `mvn install -pl ui.content -PautoInstallPackage`.
    - Java/model change → `mvn install -pl core -PautoInstallBundle` (or `-pl ui.apps -PautoInstallPackage` when the OSGi bundle is embedded in the package).
    - Frontend clientlib source change → `cd ui.frontend && npm run build`, then `mvn install -pl ui.apps -PautoInstallPackage`.
  Only use `mvn install -PautoInstallSinglePackage` (full reactor) when multiple modules changed, when a new component/clientlib/proxy is introduced for the first time, or when scoped builds visibly under-install (e.g. missing `.content.xml` merges). Never use `mvn clean` unless a stale target directory is proven to be causing the failure.
- **Reuse the running SDK.** Rely on the `-PautoInstallPackage` / `-PautoInstallBundle` deploy profiles instead of restarting AEM, and reconcile drift with targeted Sling POSTs rather than reinstalling the full reactor.
- **Sequence within a cycle.** Inside a single deploy cycle: (1) plan every fix from the current parity report, (2) edit every file, (3) run one focused scoped build, (4) run one JCR reconcile POST batch, (5) run one `component_parity.py` rescore. Then re-plan from the new report.
- **Ordering discipline still applies.** Batching does not override the remediation priority order (missing/unpaired → invalid evidence → lowest-score FAIL upward). Batch fixes within the same priority band; do not defer higher-priority rows to include lower-priority ones in the same cycle.

## Required Project Workflows

1. Read `AGENTS.md`, `CLAUDE.md`, and `.aem-skills-config.yaml` when present.
2. Use `create-component` for every Tier 2/3/4 component. Run `code-assessment` on generated Java/OSGi/Maven code before completion.
3. Deliver the site header and site footer as Adobe Experience Fragments referenced from the editable template's `structure` tree, per [02-component-authoring.md](02-component-authoring.md) → "Header And Footer Delivery Contract". Before implementing them, load the `create-component` skill (and `migration` when the source is a legacy site) and consult the Experience Fragments and Templates references on Adobe Experience League.
4. Verify the parity runner prerequisites (**Python 3.10+**, an activated `.venv`, and the `numpy`, `Pillow`, `playwright` packages + `playwright install chromium`) BEFORE the first Stage 04 invocation. If Python is missing, follow the *Agent bootstrap procedure* in [04-visual-parity.md](04-visual-parity.md) → "Prerequisites": ask the user for consent (single yes/no question), then install Python 3.12 per-user with `winget install --scope user` (Windows) / `brew install python@3.12` (macOS) / `apt-get`/`dnf` (Linux), refresh `PATH` in the current shell, create `.venv`, and `pip install -r design/site-url/requirements.txt` + `playwright install chromium`. If the user declines or the platform install path is unavailable (locked-down enterprise machine, no sudo, no winget/brew), report Stage 04 as `BLOCKED` with evidence in the same turn — never skip parity, fabricate a score, or fall back to manual visual inspection.
5. Inspect only `SITE_URL` and exact resources referenced by its DOM, CSS, or captured network traffic. Do not crawl linked pages, submit forms, forward cookies, or inspect unrelated embeds.
6. Keep an inline `design-facts` block current throughout implementation:

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
  - source_order: <zero-based frozen reading-order index>
    design_instance: <source selector/heading/rect>
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
- Do not finish with missing evidence, unclaimed source regions, failed component rows, or unapproved residual gaps.
- Treat the Stage 04 Remediation Loop as autonomous and non-interactive. While any component is `<=92%`, keep executing: diagnose the owning layer (tokens, model, HTL, CSS, template, container, asset), edit, focused-test, redeploy, recapture live+target evidence, rescore. Only pause when a genuinely external blocker is proven (unreadable source URL, missing local AEM, unrecoverable build/deploy failure, credential expiry, or an unavoidable licensing constraint) and document that blocker with concrete evidence in the same turn.
- After every parity run, parse every report row and continue directly into implementation: create/reuse and author missing components; repair invalid evidence; fix the owning layer for failed components; and reorder live author content when source-order indices differ. Rerun focused validation after each edit, then redeploy and rescore the affected rows. Before completion, rerun the full page at every required breakpoint so shared changes and ordering remain verified.
- Stage 04 must invoke `design/site-url/component_parity.py`; do not replace it with manual screenshots, the VS Code shared-browser viewport, visual inspection, or ad hoc pixel calculations. Reuse its frozen source manifests during remediation and pass `--refresh-source` only when source evidence is absent, stale, rejected, or invalidated.
