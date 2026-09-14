# Component Architecture And Authoring

Owns reuse, authoring contracts, implementation coverage, and `design-facts`. Consume accepted Stage 1 artifacts and project configuration. Read [verified project facts](references/project-facts.md) once before authoring. Read [skill routing](references/skill-routing.md); `create-component` governs EVERY Tier 2/3/4 component and loads once per context for the whole set, not once per component. Use its implementation references rather than duplicating their templates here.

## Component Coverage Gate

Stage 3 is blocked until every Stage 1 block has a reuse decision, complete file row, concrete resource type for each instance, and an authored node reachable from the demo page or a consumed XF. No discovered block may be skipped, and no implementation may invent an untraced source region.

The `component_file_matrix` records: block/instances, tier, resource type, metadata, dialog, HTL, model/children, clientlib/CSS/JS, tests, authored parent/node, demo order, policy, and status. Publish `component_coverage_matrix` as its per-block completeness view, not a second independent inventory. Cite existing/inherited files and every delta; justify non-applicable columns. `MISSING`, `PLANNED`, or `SKIPPED` blocks the gate. Missing implementations require development, not consent. No viable tier: record `tier: null`, rejected tiers/reasons, and an evidenced external blocker; return BLOCKED. Never solicit block removal to avoid development.

## Reuse Decision

Use generic semantic kebab-case names. Brand, campaign, project, version, and Figma-slug names are forbidden. Different appearances of the same concept are variants, not separate components.

| Tier | Decision | Deliverable |
|---|---|---|
| 1 | Reuse project component unchanged | Authored content using existing dialog options |
| 2 | Extend project component | supertype plus delta dialog/model/CSS/JS/test |
| 3 | Extend Core Component | delegated Core model/exporter plus delta files/test |
| 4 | Higher tiers proven insufficient | full component/model/dialog/clientlib/test |

Reuse templates and policies. Do not fork them only for a variant. More than 80% dialog overlap between sibling components is a duplication defect.

## Batched Implementation

Decide every tier and write every component contract BEFORE the first file edit; a complete contract set is what lets one skill load serve the whole run.

1. Publish the full `component_file_matrix` and per-component field contracts first.
2. Implement in tier groups rather than one component at a time. Components in a tier share the same file shape, so author the group together.
3. Validate the first component of each NEW pattern with the cheapest focused executable check. Components reusing an already-proven pattern do not each repeat it.
4. Deploy at most once per changed module per batch through [Stage 3](03-assets-runtime.md), never once per component.

Batching changes sequencing and loading only. Per-component coverage, authorability, exact field contracts, and every gate are unchanged.

## Design Facts (durable handoff)

Maintain this structure in a run-scoped artifact; report only active changes inline. Every implementation/remediation edit traces to its instance and owning layer.

```yaml
reuse_decisions:
  - design_block: <source block ID / generic role>
    tier: 1|2|3|4
    reuse_target: <resource-type>|null
    gap: none|<why higher reuse tiers fail>
    additions: [<exact deltas>]
template_decision: {reuse_template: <name>|null, new_template_gap: none|<reason>}
policy_decisions:
  - {policy_path: <path>, additions: [<resource-types>]}
instance_authoring_map:
  - design_instance: <instance ID + selector/heading/rect reference>
    resource_type: <resource-type>
    parent_path: <editable-container>
    node_name: <semantic-unique-name>
    dialog_values: {<all non-default authored values>}
```

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
- Use composite Coral multifields, DAM-backed asset fields rooted at `/content/dam`, and rich text for formatted/multi-sentence copy. Core Image may own image authoring on a child resource.
- Standalone/child Sling Models use `Resource`, optional injection, matching defaults, child-model lists, empty-row filtering, getters, and `isHasContent()`. Core delegation uses the skill's request-adaptable/exporter contract, not forced Resource-only adaptation.
- Preserve existing public fields, getters, style keys, BEM classes, properties, and nodes when extending.

## Rendering Deltas Beyond Skill Patterns

- Semantic escaped HTL with edit-mode placeholder; guarded optional regions and valid links/actions. Put `data-sly-list` on one container or `data-sly-repeat` on the item; expose `data-index` for repeated rows.
- `data-cmp-is` roots, instance-scoped initialization once, no globals/inline handlers, server-rendered initial ARIA. Preserve source keyboard/focus/hover/active/screen-reader behavior.
- BEM-scoped CSS with shared/purpose tokens; map observed layout/spacing/media/motion directly. Use observed CSS breakpoints; `1024`/`640` are fallbacks only if none exist (capture widths still come from runtime inputs).
- Implement exact source asset/icon/typography contracts from Stage 1, using deployable licensed fonts and separate icons with `currentColor` where appropriate. No temporary URLs or glyph substitutes. Preserve WCAG focus/contrast and report necessary deviations; no silent visual sign-off.

## Authoring And Repository Reconciliation

Place every instance in frozen source order in the best existing editable container. Populate exact content, variants, assets, metadata, and child order; update the existing policy.

Specify create/update/delete/reorder intent explicitly. Stage 3 verifies deployed repository JSON against resource types, properties, child names/count/order, and runtime DOM order; merge-mode packages may retain stale values. Do not deploy early to close Stage 2.

## Target Selector Map

Map every Stage 1 `instance_id` to one deployed-intent target selector for Stage 4:

| Instance ID | resource_type | Target selector | Match index | Expected matches | Text/media signature |
|---|---|---|---:|---:|---|

Derive selectors from rendered semantic roots, `data-cmp-is`, stable BEM classes, or authored instance hooks. Do not guess from a component title. Repeated instances require an explicit match index and signature. Stage 3 verifies these selectors against the deployed disabled page before Stage 4 may score them.

## Required Stage Result

Persist the shared envelope with `stage: 02-component-authoring`, Stage 1 result ID, and:

- **outputs:** `design_facts`, `reuse_decisions` (may reference the facts artifact), `component_file_matrix`, `component_coverage_matrix`, `target_selector_map`, `authorability_matrices`, `changed_files`, `demo_content_and_policy_map`.
- **checks:** `every_source_block_has_decision`, `every_block_file_row_complete`, `component_coverage_complete`, `every_instance_has_target_selector`, `every_business_value_authorable`, `focused_implementation_tests`.
- **next_stage:** `03-assets-runtime` only on PASS; otherwise null.

PASS requires complete coverage, source order, authoring evidence, and passing focused executable tests for touched implementations.