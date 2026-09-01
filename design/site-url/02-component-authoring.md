# Component Architecture And Authoring

This file owns block decomposition, reuse tiers, component contracts, author experience, and authored content.

## Stage Execution Contract

- Inputs: accepted Stage 1 result, frozen manifests/denominators, project instructions, and the same `run_id`.
- Execute reuse decisions and implement/author every Stage 1 block. A block absent from the component matrix is a failure.
- Required outputs: current `design-facts`, reuse decisions, component-file matrix, authorability/color matrices, created/modified file inventory, demo content order, and policy/template changes.
- Exit gate: every source block has exactly one Tier 1/2/3/4 decision and one complete implementation/authoring row; focused tests for the touched implementation pass.

## Component File Matrix

For every source block, record applicable files or verified reuse:

| Block/instance | Tier | Metadata | Dialog | HTL | Model/children | Clientlib/CSS/JS | Tests | Demo content | Policy | Status |
|---|---:|---|---|---|---|---|---|---|---|---|

Tier 1 cites reused resources. Tier 2/3 cites inherited resources plus every delta. Tier 4 requires all applicable columns. Headless blocks such as promo marquees are not exempt. `COMPLETE` requires existing files/resources and a deployed-intent mapping for every column.

## Reuse Decision

Use generic semantic kebab-case names. Brand, campaign, project, version, and Figma-slug names are forbidden. Different appearances of the same concept are variants, not separate components.

| Tier | Decision | Deliverable |
|---|---|---|
| 1 | Reuse project component unchanged | Authored content; optional dialog option |
| 2 | Extend project component | supertype plus delta dialog/model/CSS/JS/test |
| 3 | Extend Core Component | delegated Core model/exporter plus delta files/test |
| 4 | Higher tiers proven insufficient | full component/model/dialog/clientlib/test |

Reuse templates and policies. Do not fork them only for a variant. More than 80% dialog overlap between sibling components is a duplication defect.

## Authorability Contract

Every business-editable visible value is authored and represented in an authorability matrix:

- copy, labels, accessibility names, and alt text;
- links plus target/rel/aria-label when applicable;
- DAM assets, posters, captions, and background media;
- repeatable cards/tiles/logos/nav/footer rows as composite multifields with add/remove/reorder;
- independent variants, spacing controls, toggles, timing, counts, and behavior settings.

Permitted literals are structural markup, invariant accessibility/framework attributes, and icon-system implementation details. Do not hardcode business content, asset paths, or fixed repeat counts.

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

Treat create/update/delete/reorder explicitly. After deployment, read live repository JSON and verify resource types, properties, child names/count/order, and runtime DOM order. Do not assume merge-mode packages removed stale values.

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
		- {name: focused_implementation_tests, status: PASS|FAIL, evidence: <command/output>}
	failures: []
	next_stage: 03-assets-runtime
```

Do not return `PASS` when any coverage block lacks a component row, any applicable file is absent, content order differs, or authoring evidence is incomplete.
