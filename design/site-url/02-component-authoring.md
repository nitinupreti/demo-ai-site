# Component Architecture And Authoring

This file owns block decomposition, reuse tiers, component contracts, author experience, and authored content.

## Stage Execution Contract

- Inputs: accepted Stage 1 result, frozen manifests/denominators, project instructions, and the same `run_id`.
- Execute reuse decisions and implement/author every Stage 1 block. A block absent from the component matrix is a failure.
- Required outputs: current `design-facts`, reuse decisions, component-file matrix, authorability/color matrices, created/modified file inventory, demo content order, and policy/template changes.
- Exit gate: every source block has exactly one Tier 1/2/3/4 decision and one complete implementation/authoring row; focused tests for the touched implementation pass.

## Component File Matrix

For every source block, record applicable files or verified reuse:

| Block/instance | Tier | Metadata | Dialog | HTL | Model/children | Clientlib/CSS/JS | Tests | Demo content | Policy | XF placement | Status |
|---|---:|---|---|---|---|---|---|---|---|---|---|

Tier 1 cites reused resources. Tier 2/3 cites inherited resources plus every delta. Tier 4 requires all applicable columns. Headless blocks such as promo marquees are not exempt. The `XF placement` column is required for the `site-header` and `site-footer` rows (and any other component delivered through an Experience Fragment) and must cite the exact XF path plus the template `structure` node that references it. `COMPLETE` requires existing files/resources and a deployed-intent mapping for every column.

## Reuse Decision

Use generic semantic kebab-case names. Brand, campaign, project, version, and Figma-slug names are forbidden. Different appearances of the same concept are variants, not separate components.

| Tier | Decision | Deliverable |
|---|---|---|
| 1 | Reuse project component unchanged | Authored content; optional dialog option |
| 2 | Extend project component | supertype plus delta dialog/model/CSS/JS/test |
| 3 | Extend Core Component | delegated Core model/exporter plus delta files/test |
| 4 | Higher tiers proven insufficient | full component/model/dialog/clientlib/test |

Reuse templates and policies. Do not fork them only for a variant. More than 80% dialog overlap between sibling components is a duplication defect.

## Header And Footer Delivery Contract (Experience Fragments)

The global site header and the global site footer discovered in Stage 1 are treated as **first-class components** and **must be delivered via Adobe Experience Fragments** (XF). They are not one-off in-page components and they are not the same class of block as an in-page hero, teaser, list, or CTA band.

Before implementing or wiring header/footer, load and follow the AEM skills that own this workflow. If the plugin/skills index exposes them, prefer the shipped skills over improvising:

- **`create-component`** — for scaffolding any XF component wrapper (dialog, HTL, Sling model, clientlib, tests).
- **`migration`** — when the source header/footer comes from a legacy site and needs to be re-authored as an XF.
- **Adobe Experience League references** (canonical, non-negotiable):
    - Experience Fragments overview and best practices: `https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/fragments/experience-fragments`.
    - Templates and structural layers (where header/footer XFs are locked in the template `structure` tree): `https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/full-stack/components-templates/templates`.
    - Site header/footer as XF pattern in the WKND reference and Core Components guidance under the Components Reference Guide.

The following rules are non-negotiable for header and footer:

1. **XF-first placement.** The header and the footer are rendered by placing an XF reference in the editable template's `structure` tree (not `initial`) so every page inherits them and they cannot be edited per page. Use the Core Components `experiencefragment` component (`core/wcm/components/experiencefragment/v2/experiencefragment` or the current stable version) as the reference container. Do not hardcode a custom `site-header`/`site-footer` HTL block into the page component just to shortcut this.
2. **XF content location.** Author the XF content under `/content/experience-fragments/<site>/<locale>/site-header/master` and `/content/experience-fragments/<site>/<locale>/site-footer/master`. Do not co-locate header/footer content under the page tree.
3. **Reuse tier is still explicit.** Choose Tier 1 (reuse an existing XF unchanged), Tier 2/3 (extend a project or Core component that composes the XF), or Tier 4 (net-new component authored inside the XF). Record the choice in the `design-facts` reuse block just like any other component.
4. **Every business-editable value is inside the XF** — logo asset, primary and utility navigation, region/language switcher, search entry, contact CTA, footer link groups, legal links, social links, newsletter form, copyright. No literals in HTL/CSS. Multi-item groups (nav, footer link groups, social) use composite multifields with add/remove/reorder as required by the Authorability Contract above.
5. **Templates policy must publish the XF fragment path.** Update the template policy so the XF placeholder points at the authored fragment path and locks it in `structure`. Any per-page override attempt is a failure.
6. **Order-gate applies.** Header must render first in the disabled-page and author-page DOM; footer must render last. The Stage 4 order-gate lists must show `site-header` at index 0 and `site-footer` at the final index, matching the Stage 1 source manifest.
7. **Coverage matrix rows.** Add explicit `site-header` and `site-footer` rows to the Component File Matrix and to the Authorability Matrix. Missing rows fail this stage even if the visual is present.
8. **Do not swap XF for hardcoded chrome to chase a parity score.** If a Stage 4 pixel gap tempts you to inline a header/footer into the page component, that is an anti-gaming violation. Fix the XF, template policy, or component contract instead.

If the AEM instance does not yet have an XF template, XF configuration under `/conf/<site>/settings/experience-fragments`, or the Experience Fragments feature enabled, treat it as an environment gap: report it explicitly and stop until it is provisioned — do not fall back to in-page components.

## Authorability Contract

Every business-editable visible value is authored and represented in an authorability matrix:

- copy, labels, accessibility names, and alt text;
- links plus target/rel/aria-label when applicable;
- DAM assets, posters, captions, and background media;
- repeatable cards/tiles/logos/nav/footer rows as composite multifields with add/remove/reorder;
- independent variants, spacing controls, toggles, timing, counts, and behavior settings.

Permitted literals are structural markup, invariant accessibility/framework attributes, and icon-system implementation details. Do not hardcode business content, asset paths, or fixed repeat counts.

### Hardcoding Anti-Patterns (each is a Stage 2 failure, not a stylistic preference)

The runtime rule is simple: if a business author would ever need to change a value on the live site — a word of copy, a link URL, an image, a video, a logo, a poster, an icon backing an authorable choice, an item count, a phone number, an email, a social handle — that value MUST be authored, not compiled into the codebase. The following are explicit hard failures:

- **Copy in HTL/JS/CSS.** Every visible string comes from the dialog through the Sling model. No `${'...'}` string literals in HTL for headings, sub-headings, body copy, CTA labels, breadcrumb crumbs, aria-labels, form placeholders, empty-state messages, or footnotes. No CSS `::before { content: "…"; }` for copy authors would edit.
- **Copy in the Sling model.** `StringUtils.defaultIfBlank(x, "...")` and similar model-side fallbacks are permitted only for accessibility-only strings that the source itself proves are invariant (e.g. `role="img"` title when source hides the visible label). Fallbacks for headings, brand names, taglines, region names, region labels, CTA text, or menu items are forbidden.
- **Business URLs baked into HTL, model, or CSS.** No `href="/some-target"`, no `linkPath` model default, no `url("/some-asset")` for author-controlled links. Site navigation targets, contact links, social profile URLs, video-source URLs, poster paths, and asset paths are dialog inputs backed by pathfield / linkfield / DAM path-picker.
- **Asset bytes shipped inside the component clientlib.** Any image, video, audio, or logo file that a business author might replace — `astra-poster.jpg`, `insight-1.png`, `home-bg.mp4`, `case-1.jpg`, brand wordmarks, hero backgrounds, partner logos, personnel photos — belongs under `/content/dam/<site>/<locale>/...` and is referenced from the authored node via a DAM pathfield / fileReference. Component clientlibs under `apps/.../clientlibs/.../resources/**` are for structural chrome and design-system atoms only: grid dividers, decorative shapes that never change, `currentColor`-driven icon-system SVGs whose CHOICE is authored via a token/select field even when the geometry is invariant.
- **Full-brand SVG paths inlined in HTL.** A wordmark, monogram, or brand mark IS an asset. Even when the shape data is invariant for now, ship it as an SVG under `/content/dam/<site>/brand/...`, add a `logoAsset` DAM pathfield to the dialog, and let HTL render `<img src="${model.logoAsset}"/>` or `<svg><use href="${model.logoAsset}#glyph"/></svg>`. Inlining a 12-path Credera wordmark inside `site-header.html` is the exact violation this rule exists to prevent.
- **Icon glyphs bound to visible copy inside HTL.** Utility rows (SEARCH, CONTACT), social rows (LinkedIn, Instagram, YouTube), region badges (India + globe), and section CTA arrows are multifield items — one row = one authored label + one authored link + one icon selection (`select` field backed by the project icon-system category, OR a DAM pathfield for a bespoke icon). Do not `data-sly-test="${item.icon == 'linkedin'}"` a hardcoded SVG for every known brand; instead render `<img src="${model.iconAsset}"/>` or `<use href="${iconSystem.href}#${item.iconKey}"/>` so authors can add a Threads/Bluesky/TikTok icon without a code deploy.
- **Author-provided item counts hardcoded.** Six nav items, three social links, four insight cards — none are magic numbers. Multifield with add/remove/reorder; the CSS handles 0..N.
- **DAM asset paths hardcoded outside the dialog.** The moment a `.content.xml` or Sling POST authors a DAM path, that path lives in checked-in authored content next to the DAM binary, not scattered through HTL/CSS. `posterImage` is a `./posterImage` pathfield, not `<img src="/apps/.../poster.jpg"/>` under the component's clientlib.

### Assets: DAM Placement Rules

Every authored asset (image, video, audio, poster frame, brand logo, favicon, OG image, personnel photo, download PDF) MUST live under `/content/dam/<site>/<locale>/...` and MUST be:

1. **Committed under `ui.content/src/main/content/jcr_root/content/dam/<site>/...`** as a real FileVault-packaged binary with its sibling `.content.xml` and `_jcr_content/renditions/` folder generated by the DAM upload pipeline, OR uploaded to the running instance via the AEM Assets HTTP API (`POST /content/dam/<site>/<locale>/...`) and reconciled into the package with `mvn -pl ui.content` on the next build.
2. **Referenced from the authored node via a Sling model input backed by a Coral 3 `pathfield` or `pathbrowser` rooted at `/content/dam`** (e.g. `<posterImage jcr:primaryType="nt:unstructured" sling:resourceType="granite/ui/components/coral/foundation/form/pathfield" rootPath="/content/dam"/>`) — never a plain textfield.
3. **Rendered by HTL through the Core Components image component when applicable** (`core/wcm/components/image/v3/image`), or by the component's own model getter that returns the DAM path unchanged and lets the browser fetch it (with `sling:includeAsSelector` or a proper `.coreimg.` URL for responsive rendition selection).
4. **Never referenced from `apps/.../clientlibs/.../resources/**` for an authored image/video.** The moment an asset would legitimately need a business swap, it moves to DAM in the same edit — no "we'll migrate it later". Structural design-system assets (grid dashes, decorative geometry) that the source proves are never re-authored MAY remain in the clientlib and MUST cite their invariance in the `design-facts` block.

Assets acquired from `SITE_URL` during Stage 3 MUST land under `/content/dam/<site>/<locale>/<meaningful-folder>/<meaningful-name>.<ext>` (e.g. `/content/dam/demo-ai-site/us/en/case-studies/astra-poster.jpg`, `/content/dam/demo-ai-site/us/en/insights/adobe-practice.png`, `/content/dam/demo-ai-site/us/en/video/home-bg.mp4`, `/content/dam/demo-ai-site/us/en/brand/credera-wordmark.svg`). Foldering by role, not by consumer component, so the same asset can be reused across the site.

## Color Authoring

Every painted role (section/card/CTA background and foreground, heading/body/tag/border/divider/icon/overlay colors) provides:

1. `<role>Color`: curated token-key select with a final `other` option.
2. `<role>ColorHex`: hidden text field revealed only by `cq-dialog-dropdown-showhide` when `other` is selected. Accept `#RGB`, `#RRGGBB`, or `#RRGGBBAA` only.
3. Model getters for the key and sanitized custom hex. Invalid custom values return `null`.
4. A key-based BEM modifier and protected CSS custom property (`context='styleToken'`) for custom values.
5. CSS resolution through `var(--cmp-<component>-<role>, var(--site-token-fallback))`.

Ignore stored custom hex when the select is not `other`. Verify field visibility and a live author-edit-render round trip. Missing override paths block authorability.

## Dialog And Model Contracts

- One field per independent author intent; merge only values that always change together.
- Put content controls under Properties and visual controls under Style.
- Required source content is required; additive extension fields remain optional and preserve legacy defaults.
- Use composite Coral multifields, DAM pathfields rooted at `/content/dam`, and rich text for formatted/multi-sentence copy.
- Sling Models adapt from `Resource`, use optional injection, matching defaults, child-model lists, empty-row filtering, getters, and `isHasContent()`.
- Preserve existing public fields, getters, style keys, BEM classes, properties, and nodes when extending.

## HTL And Interaction Contracts

- Render a semantic root with escaped attribute/URI/style/html contexts and an edit-mode empty placeholder.
- Guard optional regions and render valid links/actions with source-equivalent semantics.
- Put `data-sly-list` on one container or `data-sly-repeat` on the repeated item; expose `data-index` for addressable rows.
- Root interactive behavior in `data-cmp-is`, scope queries per instance, initialize once, avoid globals/inline handlers, and render initial state/ARIA server-side.
- Preserve source keyboard, focus, hover, active, and screen-reader behavior.

## Interactive States Contract

Every interactive role captured in the Stage 1 `interactive_states_manifest` MUST have a corresponding target implementation, cited row-for-row in an `interactive_states_target_matrix`:

| Role/instance | Source states (hover/focus-visible/active/transition) | CSS rule that implements each state | Nested-child transforms (icon translate/rotate/opacity) | Focus-visible outline/ring | Transition property/duration/easing | `@media (hover: none)` opt-out | Notes |
|---|---|---|---|---|---|---|---|

Non-negotiable authoring rules:

- Do not invent hover treatments where source has none, and do not skip them where source has them. "I added `:hover` because it felt right" is a failure; every `:hover`/`:focus-visible`/`:active` selector must cite a Stage 1 row.
- Every hover treatment MUST have a matching `:focus-visible` treatment so keyboard users get the same affordance. Focus outlines are required; disabling them is a WCAG violation unless replaced with an equivalently visible ring.
- When source uses a nested icon transform (arrow slides, chevron rotates, thumbnail scales), reproduce it on the same nested element, not on the outer card.
- Wrap pointer-only effects in `@media (hover: hover) and (pointer: fine)` when source does, or add an equivalent `@media (hover: none)` opt-out; measure both.
- Transitions declared for measurement disable purposes only. The authored component ships with the source-observed `transition` property/duration/easing.
- The `interactive_states_target_matrix` row status is `COMPLETE` only when a live Playwright measurement of the deployed target (`page.hover(...)` + computed-style diff before/after) matches the frozen source row within 1 CSS px of geometry delta and matching color/opacity/decoration deltas. A HAND-WRITTEN CSS rule is not evidence.

## CSS And Responsive Contracts

- Component CSS is BEM-scoped and consumes shared/purpose-specific tokens; no unexplained design literals.
- Map source flex/grid direction, sizing, alignment, wrapping, spacing, and positioning directly.
- Use observed breakpoints; only default to `1024`/`640` when source supplies none.
- Preserve media aspect, object-fit, radius, overflow, and source motion.
- Use real SVG/icon assets with `currentColor`, not placeholder glyphs.
- Ship licensed source fonts as deployable WOFF2 or approved CDN fonts and verify readiness.
- Preserve WCAG focus and contrast; report any necessary accessibility deviation.

## Authoring And Repository Reconciliation

Place every instance in frozen source order in the best existing editable container. Populate exact content, variants, assets, metadata, and child order; update the existing policy.

Assign each authored instance its frozen zero-based `source_order` from the Stage 1 manifest. Treat create/update/delete/reorder explicitly. After deployment, read live repository JSON and verify resource types, properties, child names/count/order, and runtime DOM order. Do not assume merge-mode packages removed stale values.

The ordered source instance IDs must equal all four ordered target lists exactly:

1. checked-in content children in the editable container;
2. live JCR children after package installation and any required reconciliation;
3. component roots in the disabled-page DOM; and
4. component roots in the author-page DOM, ignoring only AEM authoring wrappers that do not represent authored component instances.

A missing, extra, duplicated, split/combined, or out-of-order instance is a hard authoring failure. Repair the owning content node, template/XF placement, or live JCR order and repeat repository/DOM reconciliation before entering or resuming visual scoring.

## Required Stage Result

Return the orchestrator's required `stage_result` envelope with:

```yaml
stage_result:
	stage: 02-component-authoring
	run_id: <same run_id>
	status: PASS|FAIL|BLOCKED
	inputs_consumed: [01-source-discovery:<result-id>]
	outputs:
		design_facts: <artifact>
		reuse_decisions: <artifact>
		component_file_matrix: <artifact>
		authorability_matrices: <artifact>
		changed_files: [<paths>]
		demo_content_and_policy_map: <artifact>
	checks:
		- {name: every_source_block_has_decision, status: PASS|FAIL, evidence: <artifact>}
		- {name: every_block_file_row_complete, status: PASS|FAIL, evidence: <artifact>}
		- {name: every_business_value_authorable, status: PASS|FAIL, evidence: <artifact>}
		- {name: no_hardcoded_business_content_in_htl_model_or_css, status: PASS|FAIL, evidence: <grep audit for literal copy/URLs/asset paths in *.html, *.java, *.css/*.scss, plus authorability-matrix rows>}
		- {name: authored_assets_live_in_dam_not_clientlibs, status: PASS|FAIL, evidence: <inventory of images/videos/logos/posters with DAM path + `fileReference`/pathfield binding; violations enumerated>}
		- {name: interactive_states_target_matrix_complete, status: PASS|FAIL, evidence: <one row per interactive role with source→target hover/focus/active/transition parity measured live via Playwright>}
		- {name: site_header_and_footer_delivered_via_experience_fragments, status: PASS|FAIL, evidence: <xf paths, template structure node, policy override, disabled/author-mode header-first/footer-last DOM check>}
		- {name: author_page_order_matches_frozen_source, status: PASS|FAIL, evidence: <checked-in/JCR/disabled/author ordered lists>}
		- {name: focused_implementation_tests, status: PASS|FAIL, evidence: <command/output>}
	failures: []
	next_stage: 03-assets-runtime
```

Do not return `PASS` when any coverage block lacks a component row, any applicable file is absent, content order differs, authoring evidence is incomplete, or the site header/footer are not delivered through Experience Fragments referenced from the editable template's `structure` tree.
