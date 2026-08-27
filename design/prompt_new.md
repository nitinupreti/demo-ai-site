# AEM Design Replication - Medium-Reasoning Workflow

## Inputs

```yaml
FIGMA_URL: ""
SITE_URL: ""
DESIGN_FILE: "" # optional PDF; a .fig file requires FIGMA_URL
DESIGN_SCREENSHOTS_DIR: "" # optional
DESIGN_SVG_DIR: "" # optional
DESIGN_TOKENS_JSON: "" # optional
DEMO_PAGE_PATH: "" # discover or create when blank
```

At least one of `FIGMA_URL`, `SITE_URL`, or `DESIGN_FILE` must be usable. Otherwise STOP and ask for one.

## Mission

Build every reusable AEM as a Cloud Service component needed to author the complete visible document represented by the design source. Author all instances on a demo page and reproduce the source at every observed breakpoint in both disabled and author modes.

Complete document means header, navigation, main sections, repeated items, footer, floating controls, consent UI, initially visible overlays, responsive-only variants, images, icons, fonts, video, and interactions. Linked destination pages are excluded. Never omit a difficult or third-party-looking region silently. Ask only when a concrete source region or asset is inaccessible or cannot legally be reproduced.

## Source Precedence

| Available input | Mode | Authority |
| --- | --- | --- |
| `FIGMA_URL` | A | Figma for design intent |
| PDF only | B | Parsed PDF |
| `FIGMA_URL` + PDF | C | Figma; PDF is fallback |
| `SITE_URL` only | D | Running rendered page |
| `SITE_URL` + PDF | E | Running page; PDF is fallback |
| `FIGMA_URL` + `SITE_URL` | F | Figma for intent; running page is still the mandatory visual acceptance target |

When `SITE_URL` is set, every final score must compare the deployed page with the live site. If Figma and the live site materially disagree on a measured role or property, STOP and report the exact conflict instead of choosing the easier source.

## Medium-Reasoning Execution Rules

These rules reduce interpretation work without lowering quality:

1. Discover once, then work from one frozen `run_manifest`. Do not repeatedly reinterpret screenshots or prose.
2. Prefer browser-extracted JSON, repository inventories, scripts, and tests over narrative reasoning.
3. Record each requirement and source role once. Later phases reference its stable ID.
4. Use targeted reads around owning files and existing components. Do not map unrelated repository surfaces.
5. Parallelize independent reads, source captures, asset downloads, and component edits. Keep dependent operations sequential.
6. Do not restate this prompt during execution. Report only decisions, failures, edits, and evidence.
7. A green build is an intermediate signal. Completion is controlled only by the visual parity gate.

## Required Skills

- Read repository instructions first. If this is an AEM Cloud Service project and `AGENTS.md` is missing, run `ensure-agents-md` before anything else.
- Use `create-component` for every Tier 2, 3, or 4 component. It owns dialog, HTL, Sling Model, tests, clientlib, and Core/project extension mechanics; do not recreate its full instructions here.
- Run `code-assessment` on generated or changed Java, OSGi, and Maven code before completion.
- Load `migration`, `dispatcher`, `aem-workflow`, `content-distribution`, or `aem-rde` only when the task actually enters that domain.
- For Figma, load `/figma-design-to-code`, then use `get_metadata` -> `get_design_context` -> `get_variable_defs` -> `get_screenshot` -> `download_assets` for each top-level frame.
- For a live site, use Playwright/Chromium for source capture and final comparison.

## Canonical Run Manifest

Before editing code, emit one `design-facts` YAML block with this structure. Keep it as the sole plan and scoring denominator. Add measured values; do not use prose such as "approximately" or "looks like".

```yaml
run_manifest:
  mode: D
  source_urls: []
  breakpoints: [375, 768, 1440]
  demo_page_path: ""
  page_metadata: {}
  source_readiness:
    - breakpoint: 375
      viewport: { width: 375, dpr: 1, scale: 1 }
      fonts: []
      decoded_media: 0
      failed_media: []
      layout_stable: true
  tokens:
    colors: {}
    typography: {}
    spacing: {}
    radii: {}
    shadows: {}
    containers: {}
    breakpoints: {}
  sections:
    - section_id: "01-header"
      source_locator: "header"
      ownership_boundary: ""
      composition: "static-row"
      direct_regions: []
      instances:
        - instance_id: "01-header-primary"
          role: "header"
          source_locator: ""
          visible_roles: []
          text: {}
          assets: []
          interaction: {}
          measurements_by_breakpoint: {}
  assets:
    - asset_id: ""
      source_url: ""
      local_source_path: ""
      dam_path: ""
      mime: ""
      bytes: 0
  reuse_decisions:
    - design_block: "header"
      tier: 1
      reuse_target: "project/components/header"
      gap: "none"
      additions: []
  template_decision:
    reuse_template: ""
    new_template_gap: ""
  policy_decisions: []
  instance_authoring_map:
    - instance_id: "01-header-primary"
      resource_type: "project/components/header"
      parent_path: ""
      node_name: "header_primary"
      dialog_values: {}
```

Manifest rules:

- Assign source instances in reading order and preserve IDs through implementation and scoring.
- Start each section at the nearest boundary owning its heading and all visually grouped sibling regions.
- Every visible source region belongs to exactly one target component or one explicit parent-plus-children composition.
- Freeze all visible text roles, media slots, controls, DOM roles, style properties, geometry, and interaction states before inspecting the target.
- Repeated instances remain separate rows even when they share a component.
- Capture responsive behavior per breakpoint: `static-grid`, `feature-plus-rail`, `horizontal-scroll`, or `carousel`, including item count, order, overflow, controls, pagination, and initial state.
- If an input is genuinely absent from a source role, mark it N/A before target inspection. Never change the denominator to improve a score.

## Phase 1 - Targeted Discovery

### Repository

Read `AGENTS.md`, `CLAUDE.md`, `README.md`, the root `pom.xml`, and relevant skill files. Discover:

- package prefix, project name, component group, content root, build commands;
- existing shared tokens and site clientlibs;
- component folders with title, supertype, dialog fields, model, and clientlib;
- existing editable templates, policies, and allowed components;
- existing content using any component that may be extended.

Do not inventory generated directories or unrelated modules. Never edit `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or template `initial`/`structure` trees.

### Source

For each breakpoint, open the source in a real browser and perform readiness before capture:

1. Set and assert `window.innerWidth`; record DPR and `visualViewport.scale`.
2. Await `document.fonts.ready` and require `document.fonts.check()` for every measured non-system family.
3. Trigger lazy loading, then require every visible image to be decoded and every visible video to have `readyState >= 2`.
4. Disable animation, transition, and smooth scrolling for static measurement only.
5. Require no relevant network activity and unchanged tracked bounding boxes across two samples at least 500 ms apart.

A failed font, media asset, viewport assertion, or unstable layout invalidates the capture. Retry the exact directly referenced resource; otherwise STOP with its URL.

Capture in dependency order:

- full-page screenshot;
- section ownership boundaries and direct visual regions;
- visible DOM nodes with tag, text, classes, attributes, parent/child order, and bounding boxes;
- computed styles for section root and every mapped role;
- images, picture sources, CSS backgrounds, inline SVG, fonts, video/audio/motion sources, posters, and media attributes;
- initial interactive state and one complete next/previous or open/close transition;
- title, description, canonical, and OG metadata.

Computed style set:

```text
font-family, font-size, font-weight, font-style, line-height, letter-spacing,
text-transform, color, background-color, background-image, opacity,
display, position, flex-direction, flex-wrap, align-items, justify-content,
grid-template-columns, grid-template-rows, gap, width, height, aspect-ratio,
object-fit, padding, margin, border, border-radius, box-shadow, overflow
```

Download only same-origin assets or exact alternate-origin URLs directly referenced by DOM, CSS, or captured network traffic. Do not crawl linked pages, submit forms, copy cookies, or inspect unrelated third-party traffic.

**Phase 1 gate:** the manifest covers every visible section and instance, all readiness checks pass, and every asset has a source URL. Do not edit code before this gate passes.

## Phase 2 - Reuse and Component Design

Choose the highest viable reuse tier:

| Tier | Action |
| --- | --- |
| 1 | Reuse an existing project component; author content only |
| 2 | Additively extend an existing project component |
| 3 | Extend an AEM Core Component |
| 4 | Create a new component after explicitly ruling out Tiers 1-3 |

Rules:

- Use generic semantic names such as `hero`, `header`, `services`, `logos`, `faq`, and `footer`. Never use brand, campaign, page, Figma, project, or version names in component folders, models, resource types, clientlib categories, or BEM roots.
- The same conceptual block with a different appearance is one component with a generic `style` variant, not a duplicate component.
- Preserve every existing dialog property, model getter, BEM class, style value, default rendering, policy, and interactive hook when extending.
- Reuse semantically equivalent fields before adding optional fields. Hide style-specific fields with dialog show/hide.
- Do not create a template or policy tree when an existing one can host the page. Add resource types to the existing policy only when needed.
- Preserve heterogeneous composition. A featured item plus supporting rail is not an equal-card grid.
- Model sibling-specific offsets, alignment, orientation, and spacing as per-instance token-backed dialog values.

Update the manifest with one reuse row and one authoring row per source instance. Tier 4 `gap` must state why project and Core components cannot preserve the source structure and behavior.

**Phase 2 gate:** every source region maps exactly once, all instances have a resource type and authoring values, and every new/extended component has a justified tier.

## Phase 3 - Implement

Use existing repository patterns and make the smallest complete change.

### Shared Layer

- Create or update one tokens clientlib from repeated measured values or `DESIGN_TOKENS_JSON`.
- Load every measured non-system font using legal self-hosted `.woff2` files or its licensed provider. Use `font-display: swap` and only required weights.
- Put body font, page color/background, default links, focus ring, and section rhythm in the site clientlib.
- Use tokens in component CSS. One-off source values may have a clearly named component token; do not scatter raw measured literals.

### Components

Follow `create-component` and these outcome constraints:

- Granite UI Coral 3 dialog with Properties and Style tabs.
- One field per independent authoring intent; rich text for formatted multi-sentence copy; composite multifields for repeated items; DAM-rooted pathfields for media.
- Optional additive style fields with defaults; curated color choices may expose an `other` hex field.
- Sling Model adaptable from `Resource`, optional injection, defaults matching dialog defaults, filtered child models, `isHasContent()`, and safe background style when required.
- Semantic HTL with explicit `attribute`, `uri`, `html`, and `styleString` contexts and an author-mode empty state.
- Put `data-sly-list` on a collection container or `data-sly-repeat` on the repeated element. Render one sibling DOM element per authored item.
- BEM CSS scoped to the component and style modifier. Preserve measured geometry, zones, hierarchy, aspect ratio, object fit, and responsive behavior.
- Component JS uses `data-cmp-is`, root-scoped queries, an idempotent initialization guard, no globals or inline handlers, and render-time initial classes/ARIA.
- Use links for navigation and buttons for actions. Preserve heading order, focus visibility, keyboard operation, 44px mobile targets, and WCAG AA contrast. Record any necessary contrast adjustment.

For source video/audio/motion, use the same media class and real asset. Background video requires autoplay, muted, loop, playsinline, a guarded `play()` fallback, real controls when shown, and reduced-motion behavior. A poster is a fallback, never a video replacement.

### Assets and Content

- Store every source asset in a reproducibly deployable project source location or deterministic tracked installer.
- Deploy assets to `/content/dam/<project>/design/` and author DAM paths, never remote CDN paths.
- Author the demo page under the template's editable container in exact source reading order and with exact copy, media, variants, and per-instance values.
- Reuse the best existing template and update its existing allowed-components policy as needed.
- Account for FileVault merge semantics: classify content changes as create, update, delete, or reorder. Do not assume package installation changed an existing node.

### Focused Tests

For each changed model, add JUnit 5 AEM Mock tests for empty defaults and fully configured values, including multifields and custom background values. Test interaction utilities when logic is non-trivial.

**Phase 3 gate:** all manifest instances are authored; all source roles and assets have target implementations; focused tests pass.

## Phase 4 - Build, Deploy, and Reconcile

Run in this order:

```powershell
mvn -pl core clean test
mvn -T 1C install -PautoInstallSinglePackage -DskipTests -pl all,core,ui.apps,ui.apps.structure,ui.config,ui.content -am
```

Then:

1. Run `code-assessment` on changed Java/OSGi/Maven code and fix relevant findings.
2. Fetch disabled page, editor page, site CSS, token CSS, and each component clientlib in one parallel batch.
3. Assert HTTP 200, zero `SightlyException`, all expected BEM roots, exact per-item counts, one correct initial active state, expected variant counts, semantic tags/attributes, and source reading order.
4. Fetch live repository JSON. Compare resource types, properties, child names, cardinality, and sibling order with `instance_authoring_map`.
5. If reconciliation is required, use an update-capable package or authenticated Sling operation. Create a child through the parent's wildcard endpoint with an explicit child name; never mutate the parent accidentally. Re-read JSON afterward.
6. Fetch deployed project-owned CSS and reject stale BEM rules absent from local source.
7. Verify each DAM asset with HEAD then GET fallback, MIME, non-zero bytes, and browser decode/playback.

**Phase 4 gate:** tests and build pass, deployed DOM matches the manifest structurally, live repository state is reconciled, and all deployed assets/clientlibs are reachable.

If no AEM instance is available, finish all possible implementation and tests, then report the visual gate as DEFERRED. This is the only deployment waiver; it is not a parity pass.

## Phase 5 - Visual Parity Gate

Run all checks against source, disabled target, and author target at every manifest breakpoint in the same Playwright session.

### Required Evidence

1. Repeat measurement readiness on source and target.
2. Save a full-page source/target screenshot pair and homologous complete-section crops.
3. Capture raw computed-style objects for every instance root and all mapped roles, including heading, primary CTA, and primary media.
4. Compare source and target DOM tag, parent/child relation, sibling order, required attributes, text, item count, section ownership, and composition signature.
5. Compare section-relative role geometry. Compare page-level section positions only at `scrollY === 0` with equivalent chrome scope.
6. Enumerate resolved target token values and compare them with local token declarations.
7. Identify cascade origins for font family, color, and background on root, heading, and CTA. Project-owned stylesheets must be inspectable.
8. Compare responsive behavior class, overflow, controls, pagination, active state, and one interaction transition.
9. Probe every target video after 3 seconds: `paused === false`, `currentTime > 0`, `readyState >= 3`, and `error === null`. Also test reduced motion.
10. Verify disabled and author mode. Ignore editor chrome and empty-state placeholders only.
11. Reconfirm live repository reconciliation and asset reproducibility from Phase 4.

No CSS inspection, build result, BEM presence check, or subjective screenshot review substitutes for this evidence.

### Canonical Tolerances

- Stable numeric CSS properties and bounding boxes: absolute delta <= 1 CSS px.
- Section-relative positions: compare `roleRect - sectionRect`.
- Font family/style/weight, text transform, tag/role, display mode, flex/grid axis, role sequence, item count, and behavior class: exact.
- Computed CSS colors: exact resolved RGBA. Delta E <= 3 applies only to anti-aliased or compressed raster pixels.
- Source declarations/tokens: exact. Browser subpixel numeric output uses the 1px tolerance.

### Scoring

Score each source instance independently at each breakpoint from frozen manifest entries:

| Axis | Weight |
| --- | ---: |
| Content and role parity | 25% |
| Typography | 25% |
| Color and surface | 20% |
| Layout and geometry | 15% |
| Section order | 10% |
| Media and interaction | 5% |

Axis score = matching frozen entries / total applicable frozen entries. Instance score = weighted sum of the six axes.

- Every instance raw score must be strictly greater than 85% at every breakpoint.
- Component-type score is the minimum score of its instances, not an average, and must be greater than 85%.
- Page composite is the average of all instance scores at one breakpoint and must be greater than 85% at every breakpoint.
- Use raw values for pass/fail; display rounding cannot change the result.
- A score over 90 on any axis requires cited source and target measurement objects.
- Missing/broken source-equivalent media makes Media 0.
- Wrong CTA semantic/visual role caps Layout at 60.
- Missing source background band caps Color at 60 and Layout at 70.
- Wrong body font caps Typography at 70 for every instance.
- Placeholder icons cap Content at 80 and Media at 60.
- A page average cannot hide a failing instance.

### Mandatory Repair Loop

For every failed check or score <=85:

1. Reload the live source and repeat readiness for the failing breakpoint.
2. Capture fresh source evidence for the complete owning section.
3. List exact failed manifest entries and their source/target values.
4. Fix in order: shared token/font -> component CSS -> HTL/dialog/model/content/asset structure.
5. Run focused tests, rebuild, redeploy, reconcile repository content, and verify assets/clientlibs.
6. Rerun the complete Phase 5 gate at all breakpoints, not only the previously failing one.

After three unsuccessful CSS-only attempts on the same gap, stop tweaking CSS and redesign the ownership mapping, content model, or component structure. Continue until the gate passes or a concrete external blocker requires user input. Never relabel a failure as a residual gap.

## Completion Contract

The final response starts with exactly one status line:

```text
VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations - minimum instance <score>% - minimum component type <score>% - minimum page composite <score>% (required >85%)
```

or, only for a concrete external blocker:

```text
VISUAL PARITY GATE: DEFERRED (reason: <exact blocker>) - MUST RUN on next turn
```

For a pass, include compact tables for:

- per-instance scores at every breakpoint;
- component-type minimums;
- page composites and all three cross-breakpoint minimums;
- reuse decisions and additions;
- source/target screenshot and measurement evidence paths.

Then summarize skills used, source inputs, components changed or reused, tokens/fonts, template/policy decisions, demo page path, assets, tests, build/deploy/repository checks, interaction checks, and author-mode result. Residual gaps must be empty unless the user explicitly approved an exclusion before scoring.

Do not claim completion without browser evidence from this run and at least one accessible side-by-side screenshot pair.
