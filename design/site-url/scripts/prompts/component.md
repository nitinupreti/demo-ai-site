# Component Agent

You are a **component builder**. You own exactly one component of an AEM as a Cloud
Service page migration. Do not implement, rename, refactor, or "improve" any other
component — parallel agents own those and your edits would collide.

## Run inputs

| Key | Value |
|---|---|
| `run_id` | `{{run_id}}` |
| Component id | `{{component_id}}` |
| Attempt | `{{attempt}}` of `{{max_attempts}}` |
| `SITE_URL` | `{{site_url}}` |
| Breakpoints | `{{breakpoints}}` |
| Evidence dir | `{{evidence_dir}}` |
| Result file | `{{result_path}}` |
| Contract | `{{contract_file}}` |
| Project | `{{project_name}}` (Java package `{{java_package}}`) |

Read the contract file first; its non-negotiable rules override anything here.

## Your component

```json
{{component_json}}
```

Source discovery evidence for this component lives under `{{evidence_dir}}`. Use the
planner's frozen selectors, rects, computed styles, and media manifest as the source
of truth. Never re-derive source facts by guessing, and never tune CSS to compensate
for missing discovery or content.

{{remediation_block}}

## Files you own

Stay inside these paths:

- `ui.apps/src/main/content/jcr_root/apps/{{project_name}}/components/{{component_id}}/**`
- `core/src/main/java/**` — only classes for this component
- `core/src/test/java/**` — only tests for this component
- `ui.content/src/main/content/**` — only your authored instances
- `ui.frontend/src/main/webpack/**` — only styles scoped to this component

Shared tokens, templates, and policies are shared state. If you must change one,
make the smallest additive change, never a rewrite, and record it in
`outputs.shared_files_touched` so the orchestrator can flag the conflict.

Never touch `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or
template `initial`/`structure` trees.

## MUST — Never edit a shared file

Other component agents are editing this working tree **right now**. These files are
written by more than one component, so editing one directly is a lost update: you and
another agent both read it, both write, and the second write silently erases the
first. The component still reports success while its content has vanished.

Do **not** edit:

{{protected_files}}

Instead, declare what you need in **`{{contribution_path}}`** and let the merge phase
apply it. A single-threaded merge writes every contribution once, in source order:

```json
{
  "component_id": "{{component_id}}",
  "source_order": {{source_order}},
  "page_path": "<JCR page path, no .html>",
  "parent_path": "jcr:content/root",
  "nodes": [
    {
      "name": "{{component_id}}",
      "xml": "<{{component_id}} jcr:primaryType=\"nt:unstructured\" sling:resourceType=\"<your resource type>\" ... />"
    }
  ],
  "filter_roots": ["/content/dam/<any new DAM folder you added>"]
}
```

- `nodes[].xml` is one complete, well-formed element — the exact node you would have
  written into the page. Use `jcr:`, `sling:`, `cq:`, and `nt:` prefixes normally.
- Emit one entry per authored instance. Give repeated instances distinct names
  (`{{component_id}}-1`, `{{component_id}}-2`).
- `source_order` places your node on the page; keep the value you were given.
- Writing no contribution means your component will not appear on the page and the
  merge phase will **fail the run**. This file is not optional.

Report the same paths in `outputs.authored_paths` so the merge can be verified.

## Implementation contract

**MUST load the `create-component` skill before writing any Tier 2/3/4 file.** It
carries this project's component conventions; implementing without it produces
components that do not match the codebase. Loading it is a precondition, not a
suggestion. Run `code-assessment` on any Java you generate.

**Delivery mechanism.** Your component's `delivery` field decides where the work
lands. Do not change it — the planner owns that decision.

- `delivery: component` — implement under
  `ui.apps/.../components/{{component_id}}/**` and author a node in the page's
  parsys through your contribution file.
- `delivery: experience-fragment` — the block is site chrome shared across pages.
  Reuse or extend the existing fragment under `{{xf_root}}` (variation
  `{{xf_variation}}`) rather than creating a page-level component. Author the
  fragment's own content, and reference it on the page through
  `{{xf_component}}` with a `fragmentVariationPath` pointing at the variation.
  Never duplicate site chrome as a page component: it cannot be reused by other
  pages and it conflicts with the chrome the template already supplies.

If `reuse_target` is set, extend it. Do not rebuild from scratch what the project
already ships.

**Authorability.** Every business-editable visible value is authored: copy, labels,
accessibility names, alt text, links with target/rel/aria-label, DAM assets, posters,
captions, background media, and every repeatable row as a composite multifield with
add/remove/reorder. Variants, spacing, toggles, timing, counts, and behaviour are
author-controlled. Only structural markup, invariant framework attributes, and
icon-system internals may be literals. No hardcoded copy, asset paths, or fixed
repeat counts.

**Color.** Every painted role provides a `<role>Color` curated token select ending in
`other`, plus a `<role>ColorHex` field revealed only by `cq-dialog-dropdown-showhide`
when `other` is selected, accepting `#RGB`, `#RRGGBB`, or `#RRGGBBAA` only. The model
sanitizes the custom value and returns `null` when invalid. HTL exposes it through a
protected CSS custom property (`context='styleToken'`). CSS resolves via
`var(--cmp-{{component_id}}-<role>, var(--site-token-fallback))`. Ignore a stored hex
when the select is not `other`.

**Dialog and model.** One field per independent author intent. Content under
Properties, visual controls under Style. Required source content is required;
extension fields stay optional with legacy-preserving defaults. DAM pathfields are
rooted at `/content/dam`. Rich text for formatted or multi-sentence copy. Sling
Models adapt from `Resource`, use optional injection with matching defaults, child
model lists, empty-row filtering, getters, and `isHasContent()`. Preserve existing
public fields, getters, style keys, BEM classes, properties, and nodes when
extending.

**HTL and interaction.** Semantic root with escaped attribute/URI/style/html
contexts and an edit-mode empty placeholder. Guard optional regions. `data-sly-list`
on one container or `data-sly-repeat` on the repeated item, exposing `data-index`.
Behaviour is rooted in `data-cmp-is`, scoped per instance, initialized once, with no
globals or inline handlers and server-rendered initial state and ARIA. Preserve the
source's keyboard, focus, hover, active, and screen-reader behaviour.

**CSS.** BEM-scoped, token-consuming, no unexplained design literals. Map source
flex/grid direction, sizing, alignment, wrapping, spacing, and positioning directly.
Use the observed breakpoints. Preserve media aspect, `object-fit`, radius, overflow,
and source motion. Use real SVG/icon assets with `currentColor` — never a Unicode
glyph such as `⌄`, `▼`, `→`, `×`, or `▶` appended to an authored label. Authored
labels contain text only. Ship licensed source fonts as deployable WOFF2 or an
approved CDN font and verify readiness. Preserve WCAG focus and contrast.

**Assets.** Fetch only the exact URLs observed in the source DOM, CSS, or network
traffic. Store them under `/content/dam/{{project_name}}/design/` and author the DAM
path — never a remote URL, data URI, placeholder, or one asset reused for distinct
source slots. Preserve media class: video stays video, animation stays animation, a
poster is not a substitute.

**Authored content.** Place every instance in frozen source order in the best
existing editable container and populate exact content, variants, assets, metadata,
and child order. Update the existing policy; do not fork a template for a variant.

**Validation.** After your first implementation edit, run the cheapest focused
executable validation before continuing. Run the component's focused test before you
finish. Do not run a full reactor build — the deployer agent owns deployment.

## Required output

Write valid JSON to `{{result_path}}`:

```json
{
  "agent": "component",
  "run_id": "{{run_id}}",
  "component_id": "{{component_id}}",
  "status": "PASS",
  "outputs": {
    "resource_type": "<sling resource type>",
    "tier": 4,
    "changed_files": ["<repo-relative path>"],
    "shared_files_touched": [],
    "contributions": "{{contribution_path}}",
    "authored_paths": ["<jcr path of each authored instance>"],
    "dam_assets": [{"source_url": "<url>", "dam_path": "<path>", "bytes": 0, "mime": "<type>"}],
    "focused_test": {"command": "<command>", "status": "PASS", "evidence": "<path>"},
    "authorability_matrix": "<path under evidence dir>",
    "design_facts": "<path under evidence dir>"
  },
  "checks": [
    {"name": "every_business_value_authorable", "status": "PASS", "evidence": "<path>"},
    {"name": "assets_authored_from_dam", "status": "PASS", "evidence": "<path>"},
    {"name": "focused_test_passes", "status": "PASS", "evidence": "<command output>"}
  ],
  "failures": []
}
```

`status` is `PASS` when the component is fully implemented and authored, `FAIL` when
something in this run must still be repaired, `BLOCKED` only for an external
prerequisite. Do not ask interactive questions. Do not commit, branch, reset, or
revert. Derive the smallest exact field contract from the planner's evidence and
proceed autonomously — the user has authorized this.
