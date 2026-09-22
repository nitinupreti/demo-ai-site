# Component Architecture And Authoring

This file owns block decomposition, reuse tiers, component contracts, author experience, and authored content.

## MUST — Component Coverage Gate (precondition for Stage 3)

Stage 2 cannot close, and Stage 3 cannot begin, until every Stage 1 block has:

1. A Tier decision recorded in the `reuse_decisions` block of `design-facts`;
2. A row in the Component File Matrix below;
3. A concrete `resource_type` in the `instance_authoring_map` for every source instance of that block;
4. At least one authored node reachable from the demo page or an XF the demo page consumes.

Emit a `component_coverage_matrix` alongside the Component File Matrix:

| Stage 1 block | Instances | Tier | resource_type | Files landed (dialog / HTL / model / clientlib / test) | Authored under | Status |
|---|---|---|---|---|---|---|

`Status = COMPLETE` requires every column filled. Any `MISSING` / `PLANNED` / `SKIPPED` row blocks Stage 3. For global chrome, `Authored under` MUST be an Experience Fragment variation path, never a page or template node. If a discovered block has no viable Tier decision, record `tier: null`, the rejected tiers and reasons, and the exact decision required from the user; emit Stage 2 `status: BLOCKED` with `next_stage: null`. Do not silently omit it or enter Stage 3. Only an explicit user decision may change the block scope, after which rerun this gate.

Stage 2 has no authority to invent a component that Stage 1 did not surface, and no authority to skip one that Stage 1 did surface. Every implementation and remediation change must trace back to a Stage 1 row.

## MUST — Global Chrome Uses Experience Fragments

Site header, footer, and any other chrome shared across pages (announcement bars, utility bars, mega-menu overlays) MUST be delivered as Experience Fragments. Authoring the chrome component directly into a page or into the template structure is a `FAIL`.

1. Author the chrome component inside the XF master variation, for example `/content/experience-fragments/<project>/<country>/<lang>/site/header/master`. The variation node keeps `cq:xfVariantType="web"`, `cq:xfMasterVariation="{Boolean}true"`, the project `xfpage` resource type, and the project XF web-variation template.
2. Reference each fragment from the **template structure** using the project Experience Fragment proxy (`sling:resourceType="<project>/components/experiencefragment"`, which inherits `core/wcm/components/experiencefragment/v2/experiencefragment`) with `fragmentVariationPath` pointing at the master variation. Mark those structure nodes non-editable so authors change the fragment, not a per-page copy.
3. The page's own `.content.xml` MUST NOT contain a chrome component node. Its `root` holds only the editable main container.
4. Declare each XF path as an owned filter root in `ui.content` **before** any broad `mode="merge"` root, otherwise a redeploy leaves stale child nodes from the previous fragment content.
5. Stage 3 verifies the deployed page renders the chrome through the fragment, and Stage 4 scores the chrome instances at their rendered selectors exactly as any other component.

The chrome component itself is still a normal project component with its own Sling Model, dialog, HTL and clientlib. Only its authored placement changes.

## Stage Execution Contract

- Inputs: accepted Stage 1 result, frozen manifests/denominators, project instructions, and the same `run_id`.
- Execute reuse decisions and implement/author every Stage 1 block. A block absent from the component matrix is a failure.
- Required outputs: current `design-facts`, reuse decisions, component-file matrix, per-instance target selector map, authorability/color matrices, created/modified file inventory, demo content order, and policy/template changes.
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

## Target Selector Map

Map every Stage 1 `instance_id` to one deployed-intent target selector for Stage 4:

| Instance ID | resource_type | Target selector | Match index | Expected matches | Text/media signature |
|---|---|---|---:|---:|---|

Derive selectors from rendered semantic roots, `data-cmp-is`, stable BEM classes, or authored instance hooks. Do not guess from a component title. Repeated instances require an explicit match index and signature. Stage 3 verifies these selectors against the deployed disabled page before Stage 4 may score them.

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
    target_selector_map: <artifact>
    authorability_matrices: <artifact>
    changed_files: [<paths>]
    demo_content_and_policy_map: <artifact>
  checks:
    - {name: every_source_block_has_decision, status: PASS|FAIL, evidence: <artifact>}
    - {name: every_block_file_row_complete, status: PASS|FAIL, evidence: <artifact>}
    - {name: every_instance_has_target_selector, status: PASS|FAIL, evidence: <artifact>}
    - {name: every_business_value_authorable, status: PASS|FAIL, evidence: <artifact>}
    - {name: focused_implementation_tests, status: PASS|FAIL, evidence: <command/output>}
  failures: []
  next_stage: <03-assets-runtime when PASS; null when FAIL/BLOCKED>
```

Do not return `PASS` when any coverage block lacks a component row, any applicable file is absent, content order differs, or authoring evidence is incomplete.