# AEM Page Migration

## Inputs

```yaml
FIGMA_URL: ""
SITE_URL: "https://credera.com/en-in"
DESIGN_FILE: "" # optional PDF; a local .fig without FIGMA_URL is unsupported
# Optional: DESIGN_SCREENSHOTS_DIR, DESIGN_SVG_DIR, DESIGN_TOKENS_JSON
```

At least one source must be readable or STOP and ask. Source precedence is:

1. `FIGMA_URL` for design intent.
2. `SITE_URL` as a mandatory rendered acceptance target whenever set.
3. `DESIGN_FILE` as a safety net.

Modes: Figma only=A; PDF only=B; Figma+PDF=C; site only=D; site+PDF=E; site+Figma(+PDF)=F. If Figma and the live site materially disagree, STOP with the exact role/property conflict and ask which governs.

## Objective

Build and author every reusable AEM as a Cloud Service component needed to reproduce the complete visible document at the source URL: header, navigation, all main sections and repeated instances, footer, floating utilities, consent UI, initially visible overlays, responsive-only variants, and interactive blocks. Linked pages are out of scope unless supplied separately.

Deliver Java Sling Models, HTL, Coral 3 dialogs, BEM CSS, shared tokens, clientlibs, tests, deployable assets, policy updates, and a populated demo page. The result must match the source in disabled and author modes at every source-defined breakpoint (default `375`, `768`, `1440`, plus any observed wider frame).

No visible block may be omitted or deferred without explicit user approval. If a source region or required asset cannot be resolved, STOP with its selector/screenshot region and evidence. A successful build is not completion; the Visual Parity Gate below controls completion.

Otherwise proceed autonomously. Ask only when the source is missing/unreadable, a specific region cannot be classified or resolved, authorities conflict, or an external blocker requires user input.

## Normative Conventions

- `MUST`, `FAIL`, and `STOP` are completion-blocking.
- Requirements are canonical where first defined; later workflow references do not weaken them.
- Preserve source values byte-for-byte where declarations exist. Compare browser numeric values using the gate tolerance.
- Design wins over existing styling. Accessibility corrections are the only permitted visual deviation and must be reported.
- Never modify generated/vendor paths: `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or template `initial`/`structure` trees.

## Required Skills And Tools

1. Read `AGENTS.md`, `CLAUDE.md`, `.aem-skills-config.yaml` when present, and every `.agents/skills/*/SKILL.md` whose description overlaps this task.
2. If `AGENTS.md` is absent in an AEM Cloud project, run `ensure-agents-md` first.
3. Use `create-component` as the sole workflow for each Tier 2, Tier 3, or Tier 4 component. Pass the reuse decision and emit all independent component files in one batched edit.
4. Run `code-assessment` on generated Java/OSGi/Maven code before completion. Load `migration`, `dispatcher`, `aem-workflow`, `content-distribution`, or `aem-rde` only when their domains apply.
5. Figma modes: load `/figma-design-to-code`, parse `fileKey` and `nodeId` (`node-id=1-2` -> `1:2`; branch key replaces file key), then call per top-level frame: `get_metadata` -> `get_design_context` -> `get_variable_defs` -> `get_screenshot` -> `download_assets`. `/board/` uses FigJam; `/slides/` requires STOP; `/make/` uses its make key.
6. Site modes: use Playwright/Chromium to open the exact URL and inspect only that page and same-origin resources. An alternate-origin resource may be fetched only when its exact URL appears in rendered DOM, computed CSS, or captured network traffic. Never crawl linked pages, submit forms, forward cookies, or inspect unrelated embeds.

## Execution Model

Parallelize independent operations only:

- Discovery wave 1: read project instructions/README/config and inventory skills, components, templates, policies in one parallel call.
- Discovery wave 2: open the source first; once its page handle exists, capture independent breakpoint facts. Enumerate exact asset URLs before parallel downloads.
- Scaffolding: generate all Tier 2/3/4 components, shared tokens, and preferably sample content in one batched edit.
- Build: run the focused core tests first, then one multithreaded reactor build.
- Verification: use one parallel fetch for rendered pages/clientlibs and one batched assertion sweep.

Do not parallelize steps with output dependencies.

## 1. Discover And Freeze Source Evidence

Inventory:

- Maven build, Java/package namespace, component group, app/content roots, clientlib conventions.
- Every component folder with title, group, supertype, dialog tabs/fields, and Core Components in use.
- Existing templates, policies, allowed components, authored component instances, and generic-name violations.
- Source metadata: title, description, canonical, and OG values.

At each breakpoint, run Measurement Readiness before capturing evidence:

1. Set viewport and assert `window.innerWidth` exactly; record DPR and `visualViewport.scale`.
2. Await `document.fonts.ready`; check every measured non-system family with `document.fonts.check()` and require `true`.
3. Force relevant lazy media eager, trigger observed lazy loading, and require each visible image to be decoded (`complete`, `naturalWidth > 0`, `naturalHeight > 0`) and each visible video `readyState >= 2`.
4. Validate external font/background/media responses through network events or direct HEAD with GET fallback, not page-context CORS-sensitive fetches.
5. Inject measurement-only CSS disabling animation, transition, and smooth scrolling. Require no relevant network activity and unchanged tracked-role rectangles across two samples at least 500 ms apart. Restore motion for interaction tests.

Any wrong viewport, unresolved font, failed/collapsed media, or unstable layout invalidates the capture and blocks scoring.

Before inspecting the target, freeze these source artifacts:

- Full-page screenshot at every breakpoint.
- `score_manifest` with one stable `instance_id` per visible block in reading order.
- Source-section ownership manifest: nearest visual/semantic owner, rect, all direct regions, order, count, role (`featured`, `supporting-list`, `card`, `media`, `controls`, `pagination`, etc.), prominence, and adjacency.
- Exactly-once coverage map from every source region to one target owner or explicit parent+children composition.
- Source-DOM manifest per block: every visible node's tag, first 60 text characters, classes, section-relative and absolute rect, attributes, parent/child/sibling relationship, and computed styles.
- Responsive/state matrix per block: `static-grid`, `feature-plus-rail`, `horizontal-scroll`, or `carousel`; visible order/count, overflow, clipping, controls, pagination, initial/hover/focus/active states, and one complete next/previous transition when applicable.
- Media manifest: images, picture sources, CSS backgrounds, inline/symbol SVG, videos/audio, animated images, Lottie/JSON, canvas motion, and embeds. For video capture `src`, `data-src`, `type`, `currentSrc`, poster, autoplay, loop, muted, playsinline, controls, and actual network URL.

Computed styles must include: font family/style/weight/size, line height, letter spacing, transform, color, background color/image, opacity, border, radius, shadow, display, position, padding, margin, gap, flex/grid properties, aspect ratio, object fit, overflow, and rect geometry. Record raw values without rounding.

## 2. Decompose And Decide Reuse

Define each distinct block using a generic semantic kebab-case role such as `hero`, `header`, `services`, `testimonials`, `logos`, `subscribe`, `faq`, or `footer`. Names derived from a brand, product, campaign, page, project, Figma slug, design system, or version are forbidden in folders, models, resource types, clientlibs, and BEM classes. Rename discovered violations before scaffolding, including all references and authored resource types. Different looks of the same concept are style variants of one component.

Choose the highest viable tier:

| Tier | Decision | Deliverable |
|---|---|---|
| 1 | Reuse project component unchanged | Authored content; optional merger dialog option |
| 2 | Extend project component | `.content.xml` with `sling:resourceSuperType` + delta dialog/delegating model/CSS/JS/test |
| 3 | Extend Core Component | `@Self @Via(type = ResourceSuperType.class)` + `ComponentExporter` + delta files/test |
| 4 | New component; tiers 1-3 explicitly ruled out | Full component/model/dialog/clientlib/test |

Reuse existing templates and policies. Never fork either solely for a variant. A base and structural extension require distinct generic titles/descriptions/icons and policy order (base first). More than 80% dialog overlap between sibling components is a duplication defect.

Before code, emit and maintain this inline `design-facts` YAML, with one decision per block and one authoring row per source instance in reading order. Each row records every non-default authored value:

```yaml
reuse_decisions:
  - design_block: hero
    tier: 1|2|3|4
    reuse_target: demo-ai-site/components/hero|null
    gap: none|<why all higher tiers fail>
    additions: [<exact deltas>]
template_decision:
  reuse_template: <name>|null
  new_template_gap: none|<reason>
policy_decisions:
  - policy_path: <existing path>
    additions: [<resource types>]
instance_authoring_map:
  - design_instance: <source selector/heading/frame>
    resource_type: <decision resource type>
    parent_path: <editable inner container>
    node_name: <semantic unique name>
    dialog_values: {style: <key>, title: <exact copy>}
```

Every CSS/HTL/dialog change must trace to this block. Update it before each remediation iteration.

## 3. Shared Implementation Contracts

### Author Experience

Tier 1/2/3 changes are additive. Never remove or rename existing fields, getters, BEM classes, style values, property keys, or resource nodes. Reuse semantically equivalent fields (`image`, `tagline`, `description`, `ctaLabel`/`ctaLink`, `backgroundImage`) before adding fields. New fields are optional with defaults and hidden when irrelevant using style-bound `cq-dialog-dropdown-showhide`; if hiding is impossible, suffix their generic labels with the style key. Preserve the prior default style and rendering for empty/legacy style values.

Discover every existing page using an extended component. Verify disabled HTML, root plus two nested computed styles, screenshots, interaction hooks, editor opening, populated values, relevant field visibility, and empty state at every breakpoint. Existing authors must gain no required steps or policy/template changes.

### Dialogs And Models

- One field per independent authoring intent. Merge values that always change together.
- Enumerations use selects with sensible defaults. Required source content uses `required="{Boolean}true"`; new extension fields never do. Add descriptions for non-obvious fields.
- Color uses a curated select plus `other`, which reveals a hex field through `cq-dialog-dropdown-showhide`.
- Repeating content uses a composite Coral multifield. DAM inputs use pathfields rooted at `/content/dam`. Multi-sentence/emphasized body copy uses rich text.
- Put content under Properties and visual controls under Style.
- Model: `@Model(adaptables = Resource.class, defaultInjectionStrategy = OPTIONAL)`, `@ValueMapValue` plus matching `@Default`, and `@ChildResource List<ChildItemModel>` for multifields. Child `hasContent()` and `@PostConstruct` filter empty rows.
- Expose all getters, `isHasContent()`, and `getBackgroundStyle()`, returning `background-color: <hex>;` only for nonblank `other`; otherwise `null`.

### Style And Spatial Variants

One component supports all visual designs through a generic `style` key (`default`, `alt`, `split`, etc.). Preserve the shipped default. Add Design Style first in the Style tab and hide style-only fields. HTL root includes `cmp-<name>` and `cmp-<name>--style-${model.style}`; structurally different styles use HTL branches, never JS/CSS-only DOM switching. Scope each style's CSS and tokens beneath its modifier/design scope.

For every sibling spatial delta (side, gutter, offset, stagger, alignment, section padding, order), provide an independent token-named dialog select, default/model getter, root modifier, scoped custom property, and authored per-instance value. Tablet/mobile rules reset values only when the source does.

### HTL And Interaction

- Root is a semantic landmark with escaped attribute/URI/styleString/html contexts and a per-component clientlib include.
- Guard optional regions; show an edit-mode placeholder when `!model.hasContent && wcmmode.edit`.
- Put `data-sly-list` on a single container or `data-sly-repeat` on the repeated item. Never put `data-sly-list` on the per-item host. Addressable items include `data-index="${itemList.index}"`.
- Static labels use i18n. Navigation uses nonempty `<a href>`; actions use `<button type="button">`; roles and ARIA relationships follow source semantics.
- Interactive roots use `data-cmp-is`, root-scoped queries, `data-cmp-initialized`, no globals/inline handlers, an IIFE plus `DOMContentLoaded`, and per-component JS clientlibs. Render initial active classes and ARIA server-side. Clear sibling state before setting new state; support multiple instances.

### CSS, Tokens, Fonts, And Accessibility

- Derive shared custom properties from repeated source values or map `DESIGN_TOKENS_JSON` 1:1. One-off exact values still use purpose-specific tokens; component CSS contains no design literals.
- Use one CSS file per component and BEM `.cmp-<name>__<element>--<modifier>`. One concern per modifier. Component clientlibs depend on shared tokens; site wiring delivers them on all pages.
- Place body background, base typography/color, section rhythm, links, and focus treatment in the site clientlib. Never use broad `[class^="cmp-"]` resets.
- If source usable width is narrower than the project container, define that cap before tuning gaps/alignment. A side-hugging card uses grid/flex alignment, not transforms/margin hacks, and its maximum derives from the shared container/space tokens. Map source auto-layout directly: direction, gap, alignment, sizing, wrapping, and absolute positioning.
- Use observed breakpoints. When the source supplies none, collapse side-by-side layouts at `<=1024px` and reduce mobile padding at `<=640px`.
- Image wrappers preserve exact aspect ratio, object fit, radius, and overflow. Do not add filters unless observed.
- Designed icons are actual inline SVGs using `currentColor`, never Unicode or placeholder glyphs.
- Load every non-system source font through deployable `.woff2` `@font-face` (`font-display: swap`) or a licensed CDN. Ship observed weights and verify browser readiness/family.
- Preserve source states. Add `:focus-visible`, semantic headings/landmarks, meaningful/decorative alt, mobile hit targets at least 44x44 CSS px, and WCAG 2.1 AA contrast (4.5:1 body, 3:1 large). If source contrast fails, use the nearest compliant token and report it.

### Assets And Motion

Store every required source asset reproducibly in project-owned source or a tracked deterministic installer, then deploy it under `/content/dam/<project>/design/`. Author DAM paths, never remote/temporary URLs. Record source URL/origin, local path, DAM path, MIME, and bytes.

Preserve media class: video remains playable video, audio remains audio, Lottie remains driven motion, animated images remain animated, and embeds remain equivalent embeds. A poster is a companion, not a substitute. Background video renders `<video autoplay muted loop playsinline>` and JS calls `play()` on `loadeddata`, handling rejection through paused class/ARIA. Preserve source controls with keyboard/screen-reader behavior. Under `prefers-reduced-motion: reduce`, pause/hide autoplay motion and expose the poster; test this at one breakpoint.

## 4. Implement And Author

Create/update shared tokens and all Tier 2/3/4 files according to the contracts and `create-component` skill. Per Tier 4 deliver: component metadata, Properties/Style dialog, HTL, model/child models, clientlib metadata, CSS, optional JS, and model tests. Tier 2/3 emits delta files only and delegates to its supertype.

Tests use JUnit 5 and wcm.io AEM Mocks with `AppAemContext.newAemContext()`:

- `defaultsWhenEmpty`: defaults, empty multifield, null background style, expected `isHasContent()`.
- `configuredFully`: every field, valid `other` hex, populated multifield, all getters, exact background style.

Author a demo page under the existing content root and best existing template. Place every instance in source reading order inside the template's editable inner responsive-grid container. Populate exact copy, style/spatial values, links, media, metadata, and multifield order. Add resource types to the existing policy.

Treat content changes explicitly as create/update/delete/reorder. Merge-mode packages may preserve stale properties and order. After deployment, read live repository JSON for resource types, properties, child names/count/order. Use an update-capable package or authenticated Sling operation when needed. Create a child through the parent's wildcard endpoint with an explicit name; never post child properties to the parent. Re-read parent and child and verify the parent type.

## 5. Build And Runtime Verification

Run in order; stop on failure:

```powershell
mvn -pl core clean test
mvn -T 1C install -PautoInstallSinglePackage -DskipTests -pl all,core,ui.apps,ui.apps.structure,ui.config,ui.content -am
```

Keep FileVault validation enabled and require no relevant analyzer warnings. If local AEM is available, install affected packages and fetch in one parallel batch with Basic auth and Referer:

- `<page>.html?wcmmode=disabled`
- `/editor.html<page>.html`
- site and token CSS
- every component CSS/JS clientlib
- live repository JSON and every DAM asset

Run one assertion sweep for HTTP 200, zero `SightlyException`, root/modifier counts, source order, authored multifield item counts, exactly one server-rendered initial active state, ARIA agreement, surviving semantic wrappers, DAM paths, and expected local clientlib rules. No checked-in XML, HTL, local CSS, build result, active bundle, or class-name presence may substitute for deployed evidence.

## 6. Visual Parity Gate

This gate is mandatory in every input mode and **must always run** in the same turn as the deploy. Run against the source reference, disabled target, and author target at every breakpoint in the same real-browser session; exported Figma/PDF frames are the browser-loaded source reference when no live page exists. Whenever `SITE_URL` is set, its running page is an additional mandatory acceptance target and cannot be waived by Figma/PDF evidence. The gate cannot be deferred, skipped, waived, postponed, or partially reported. If AEM is not running, start it (or ask the user to start it) and continue; if any prerequisite check fails, remediate and rerun. Missing media, missing tokens, failed readiness, or any other gap is a remediation task, never a reason to defer.

### Frozen Scoring

Freeze denominators from source evidence before target inspection:

- Content (25%): every visible role, exact copy unit, heading, media slot, CTA, and control.
- Typography (25%): family, size, weight, style, line-height, letter-spacing, transform for every text role.
- Color (20%): color, background color/image, border color, opacity, shadow where applicable.
- Layout (15%): section-relative x/y, width/height, display/position, padding/margin/border/radius/gap, flex and grid properties.
- Section order (10%): every direct source region in reading order.
- Media/interaction (5%): media class/asset/object-fit/aspect ratio/controls/initial state/transitions.

An entry is N/A only if its absence was frozen from source. Each axis is matched entries / frozen entries. Instance score is the weighted sum. Component-type score is its minimum instance score, never an average. Page composite is the average of all instance scores at that breakpoint.

Every raw instance score, component-type minimum, and page composite must be strictly `>95%` at every breakpoint. `95.000%` fails; compare before display rounding. A high average cannot hide a failure. No instance may fall below 95% on any axis without triggering remediation.

### Mandatory Exact-Parity Requirements

These overrule any tolerance rule in the axis definitions or comparison rules and are hard prerequisites for the gate:

- **Section background color** MUST match the source computed `background-color` exactly (RGBA equality, no Delta E allowance) for every component instance at every breakpoint. A mismatch caps that instance's Color axis at `0` and forces remediation.
- **CTA background color** MUST match the source computed `background-color` exactly for every button/link acting as a call to action. A mismatch caps that instance's Color axis at `0`.
- **CTA text color, border color, and border radius** MUST match the source computed values exactly. Any mismatch caps that instance's Color axis at `50`.
- **Component width** MUST match the source computed `width` within `±1 CSS px` at every breakpoint. If the source instance spans the full viewport (`width === innerWidth` ± scrollbar), the target MUST also span the full viewport (no container clamp, no side padding on the section root). A mismatch caps that instance's Layout axis at `0`.
- **Component height** MUST match the source computed `height` within `±8 CSS px` at every breakpoint. A mismatch caps that instance's Layout axis at `40`.
- **Full-bleed parity**: if the source root paints across the entire viewport width, the target root MUST paint across the entire viewport width using the same technique class (full-bleed section, not container-clamped block). Container-clamped renderings of a full-bleed source region hard-fail structural parity.
- **Rendered box parity**: the target instance's outer `getBoundingClientRect()` (left, top offset within its section, width, height) MUST be within `±1 CSS px` on x/left and `±1 CSS px` on width, and within `±8 CSS px` on height, of the source. Deltas larger than this cap Layout at `40` and require CSS remediation.
- **Hover state parity**: every interactive element in the source that changes on `:hover` (links, buttons, cards, nav items, CTA pills, arrow icons, tiles, carousel items, etc.) MUST reproduce the same hover behavior on the target. Enumerate hoverable roles in the frozen source manifest; for each, capture the pre-hover and hovered computed styles in the same real-browser session (using `page.hover()` then `getComputedStyle`) covering at minimum: color, background-color, border-color, box-shadow, opacity, transform, text-decoration, and any child arrow/icon translation. The target must match every hovered property under the same exact-parity rules above (exact RGBA for colors, ±1 px for transforms/positions, exact class for text-decoration). A missing hover effect, a hover that only changes on the wrong property, or a hover that fires on a different element than the source hard-fails the instance and caps Media/Interaction at `0`. Hover must be tested at every breakpoint that supports pointer input (skip on `375` only if the source uses `@media (hover: hover)` gating). Do not simulate hover with permanent classes; use real pointer events.
- **Asset acquisition & deployment**: every visible source asset (raster image, SVG, inline-SVG data URI, icon, logo, video, audio, poster, Lottie/JSON, font) MUST be acquired from the source in the same turn, stored under project-owned source (`ui.content/.../content/dam/<project>/design/`), and deployed to the running AEM DAM under `/content/dam/<project>/design/` before scoring. Enumerate every asset URL from the freeze pass (including inline `data:` URIs decoded to real files) into an asset manifest with columns: source URL/origin, local path, DAM path, MIME, bytes, deployment method. Every row in the manifest MUST have HTTP status `200` on both HEAD-to-source and GET-to-DAM in the same turn, correct MIME, non-zero bytes, and browser decode success (`complete && naturalWidth>0` for images, `readyState>=2` for video/audio). A missing binary, a placeholder reuse (e.g. one asset substituted for multiple slots), a wrong MIME, a broken decode, a `data:` URI shipped without being decoded to a real file, or a source URL never actually fetched and stored, gives Media `0` for the affected instance AND caps Content at `80` per anti-gaming rule 4 — and must be remediated in-turn, never deferred. Assets must be reproducibly deployable: package-installable via a filter update or scripted via an authenticated Sling POST captured in the turn output; ad-hoc author uploads without a recorded upload command do not satisfy this rule.
- **Cross-site cross-breakpoint color & font-size parity**: applies to whichever site is being migrated (source-agnostic). At every breakpoint declared in Inputs (default `375`, `768`, `1440`, plus any observed wider frame), and for every scored role (section root, heading, subheading, body copy, eyebrow, tag, link, CTA label, form control, footer text, legal line), the target MUST match the source on:
    - **Every computed color property** — `color`, `background-color`, `border-color`, `outline-color`, `text-decoration-color`, `caret-color`, `fill`, `stroke`, `box-shadow` color stops, and CSS custom-property resolved values — with **exact RGBA equality**. Delta E and rounding are not permitted for role-level color; only antialiased raster pixels may use Delta E ≤ 3.
    - **Every computed font-size and its dependent metrics** — `font-size`, `line-height`, `letter-spacing`, `font-weight`, `font-style`, `font-family`, `text-transform` — with **exact numeric equality** at every breakpoint (`font-size` compared in `px` after resolving `em`/`rem`/`clamp()`/`calc()`; delta must be `0px`). Responsive changes must be reproduced with the same values at the same breakpoint, not approximations.
    - Enumerate a per-breakpoint parity matrix per component: rows are scored roles, columns are the required properties, cells are `SRC` / `TGT` / `MATCH?`. Any row with any mismatched cell caps Color axis at `0` (for color cells) or Typography axis at `0` (for font-size / weight / family / transform cells) for that instance at that breakpoint.
    - Site tokens must be centralized: colors resolve from `:root` custom properties matching source computed values; font sizes resolve from purpose-named tokens per breakpoint (`--<role>-fs-<bp>`). Component CSS may not hard-code color literals or `px` font-sizes; every literal is a hard failure of the tokens contract in section 3.
    - Verify tokens on the deployed target by reading `:root` computed styles via `page.evaluate`, comparing each token to its local declaration, and independently comparing each scored role's resolved value to the source's resolved value. A token that resolves differently on the target than declared, or that resolves the same as declared but does not match the source computed value at that breakpoint, hard-fails the tokens contract and forces remediation.
    - This applies regardless of which SITE_URL is set; the same rigor is required for any migration target the tool is pointed at.
- **Maximum author-editability of content**: every visible piece of source content that a business author could plausibly change post-launch MUST be exposed as an AEM authorable field on the component dialog and rendered from the Sling model / HTL binding — never inlined as a literal in HTL, CSS, JS, or a Java constant. The frozen source manifest MUST enumerate every author-editable role per component instance and, for each, declare the field name, dialog tab, widget type (`textfield`, `textarea` with `useFixedInlineToolbar`, `richtext`, `pathfield`, `imagefield` via `cq/dam/gui/coral/components/admin/DamPathField`, `numberfield`, `select` populated by the tokens catalog, `checkbox`, `multifield` for repeatable rows), required/optional flag, default, and validation. Coverage floor per component instance:
    - **Copy**: every heading, subheading, eyebrow, body paragraph, tag, label, legal/disclaimer, footnote, CTA label, form placeholder, form help text, empty-state text, aria-label, and alt text = authorable string (rich text where the source shows inline formatting).
    - **Links**: every href = `pathfield` (internal) or `textfield` with URL validation (external), plus `target`, `rel`, and `aria-label` fields where the source sets them.
    - **Assets**: every `img`, `svg use`, `video`, `audio`, `poster`, background image, and logo = `pathfield` bound to a DAM resource, with alt/title/caption authorable siblings; never hardcode a DAM path in HTL.
    - **Repeatable regions**: any source region with 2+ visually equivalent siblings (cards, tiles, logos, list items, nav items, footer columns, testimonials, stats, breadcrumbs, tabs, accordion rows, slides) = Granite `multifield` (or child resource `multifield` for structured rows) — never a fixed count of hardcoded slots. The dialog must permit add/remove/reorder and the HTL must iterate `data-sly-list`/`data-sly-repeat`.
    - **Variants**: every source-observed variant (color scheme, alignment, density, layout direction, background style, CTA style, image ratio) = `select` bound to a token key with a documented value catalog; the model exposes the key, HTL renders it as a root BEM modifier class, and CSS resolves it via scoped custom properties. Reuse the tokens contract in section 3 — no hardcoded style branches in HTL or Java.
    - **Numbers/booleans**: any authored count, threshold, delay, autoplay flag, loop flag, show/hide toggle, or aria state = `numberfield` / `checkbox` — not a hardcoded constant.
    - **Global chrome authorability**: site header nav items, footer columns/links/legal/social icons, and any repeated brand asset MUST be authored (typically via Experience Fragments or child multifields on the header/footer components), never inlined in HTL.
    - **Necessary exceptions** — the only permitted hardcoded values are: (a) fixed structural markup that carries no business meaning (wrapper `div`s, semantic landmarks), (b) accessibility attributes with a single correct value across all authored variants, (c) framework-required attributes (`data-sly-*`, `sling:resourceType`), (d) icon glyphs that are part of a shipped icon-system clientlib and referenced by a select-bound key, and (e) transient system copy the source itself hardcodes (e.g. copyright year computed at render). Every other literal in HTL, CSS content, or Java is a hard failure of this rule.
    - **Verification**: for each component instance, emit an authorability matrix — rows are visible source roles, columns are `Source Text/URL/Asset`, `Field Name`, `Field Type`, `Multifield?`, `Default`, `Live Authored Value`, `Rendered From Dialog?` (yes/no). Any `no`, or any role missing from the matrix, hard-fails the component and caps Content axis at `50` and Layout axis at `70`. The dialog must be openable in Author mode and every listed field must accept edits that round-trip to the rendered output in the same turn as evidence.

Canonical comparison rules:

- Numeric computed styles and stable rect coordinates/dimensions: absolute delta `<=1 CSS px`.
- Nested x/y use section-relative coordinates. Section-root page position is compared separately with both pages at `scrollY=0` and identical chrome/header scope.
- Family, style, weight, transform, display, flex/grid axis, item count, role sequence, and behavior class: exact.
- Computed CSS colors: exact RGBA. Delta E `<=3` applies only to raster pixels affected by antialiasing/compression/profile conversion.
- Compare declarations exactly and computed subpixels numerically; never score an unready capture.

### Anti-Gaming Rules

1. Every source instance maps exactly once and has its own measurements/table row at each breakpoint, including repeats, Tier 1, global chrome, and authored page regions.
2. A score above 90 on any axis requires cited source and target raw measurement objects. Never score from authored CSS or assumptions.
3. The first gate run after each deploy uses `page.evaluate` to return raw computed-style objects for every instance root, heading, primary CTA, and primary image/media.
4. Missing/broken/un-authored image, icon, logo, or required DAM asset gives Media `0`. Placeholder glyphs cap Content at `80` and Media at `60`.
5. Text-link versus filled-button role mismatch caps Layout at `60`.
6. Missing/incorrect full-bleed background zone caps Color at `60` and Layout at `70`.
7. If target body computed family does not begin with the ready source primary family, cap Typography at `70` for every block.
8. Compare complete homologous source sections. Missing, duplicated, orphaned, separately scored, or equalized heterogeneous sibling regions hard-fail structural parity.
9. Responsive behavior, cardinality, control presence, and initial/transition state must match evidence. Do not infer a carousel from repetition or name a static block carousel.
10. A deployed role rewritten or stripped (for example link to text, missing href/button/wrapper) hard-fails regardless of appearance.
11. User rejection invalidates prior scores: recapture source/target, publish honest lower evidence, and remediate.

### Ordered Checks

Run all checks in order and retain artifacts:

0. Measurement Readiness on all pages: viewport, DPR/scale, font checks, decoded/failed media, network quiescence, and layout stability.
1. Open source, disabled target, and author target in real Chromium at every breakpoint.
2. Save full-page source/target side-by-side screenshot pairs at every breakpoint.
3. Diff computed styles for every instance root plus heading, primary CTA, primary image/media, and at least one additional nested role.
4. Enumerate every project-owned token from deployed `:root`; compare resolved deployed value to local declaration.
5. Fetch every loaded target clientlib and fail on component-namespace BEM rules absent from local source.
6. Identify rule origins for root/heading/CTA color, family, and background via CDP matched styles or selector/stylesheet enumeration. For cross-origin source CSS, record URL plus final values on `SecurityError`; all project target CSS must be inspectable.
7. Base gate: checks 0-6 must pass before scoring or domain checks.
8. Media reachability: HEAD then GET fallback; require status 200, correct MIME, nonzero bytes, and browser decode for images.
9. Video probe after 3 seconds: `paused === false`, `currentTime > 0`, `readyState >= 3`, `error === null` for source-equivalent autoplay videos.
10. Media-class parity: video/audio/motion cannot be a poster/static substitute; `currentSrc` must resolve.
11. Attach source-DOM manifest for every Tier 2/3/4 component.
12. Verify exactly-one role-map correspondence for every visible source and target node.
13. Verify section-relative x/y and width/height within 1 CSS px and exact flex/grid axis.
14. Verify exactly-once complete source-section ownership coverage using homologous section boundaries.
15. Verify region count/order, item count, prominence class, and adjacency.
16. Verify per-breakpoint behavior matrix, overflow, controls, pagination, initial state, and transitions.
17. Emit authored role -> deployed tag/parent/attributes for every role; verify links, buttons, wrappers, order, and attributes.
18. Emit expected -> live resource type, properties, child cardinality/order, and runtime DOM order for every authored block.
19. Emit asset manifest and clean-environment deployment method; verify deployed bytes/MIME/decode.
20. Compute scores. For each score `<=85%`, refresh the live source and complete manifest, identify failed frozen entries, change tokens -> CSS -> HTL/dialog/model/content/assets as indicated, run focused tests/package validation, redeploy, reconcile repository/DOM/assets, and rerun checks 0-19 at all breakpoints and both modes. Do not rescore unchanged evidence. After three failed CSS attempts on one gap, recapture and redesign structure/ownership/content model rather than continue CSS tuning.

Checks 0-19 are all hard prerequisites. Missing screenshots, browser/source load, readiness, tokens, inspectable target cascade, semantic roles, repository order, or reproducible assets blocks a pass. Missing assets do not excuse non-media checks; acquire and deploy directly referenced assets in this run.

## 7. Completion Output

At the top of the final response, include:

1. Per-instance score table at every breakpoint, with each axis citing source and target evidence.
2. Component-type minima table.
3. Breakpoint page composites.
4. Cross-breakpoint minimum instance, component type, and page composite.
5. Exactly one terminal status line, always drawn from real measurements taken in the current turn:

```text
VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations — minimum instance <score>% — minimum component type <score>% — minimum page composite <score>% (required >95%)
```

`DEFERRED` is not a permitted status. `FAILED` is progress-only — continue remediation in the same turn until the gate PASSES; do not end the turn on FAILED. No score table is valid unless all readiness/base/structural/media/deployment checks passed in this turn. Provide at least one side-by-side screenshot to the user.

Then concisely report: loaded/invoked skills; source inputs; discovery inventories; current `design-facts`; block decomposition and tier decisions; tokens/fonts/assets; files by component (Tier 1 says no new files); template/policy changes; author-experience regression audit; HTL list audit; spatial variants; interaction guards; tests/code assessment/build; deployed DOM/clientlibs/repository; demo page path; screenshot/evidence artifact paths; accessibility deviations; and residual gaps. Residual gaps must be empty unless explicitly approved by the user in the same turn.