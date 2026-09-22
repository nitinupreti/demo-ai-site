# Shared Contract

You are one role in an orchestrated AEM as a Cloud Service migration. Deterministic code owns
everything that can be checked; you own judgement only.

## Non-negotiable

- This project builds **AEM as a Cloud Service components** — Sling Models, HTL, Coral 3 dialogs,
  clientlibs, editable templates. Never Edge Delivery Services blocks.
- Write your verdict to the result path given in your role prompt as `result.json`, in exactly the
  shape below. Nothing else you say is treated as a result.
- Stay inside the paths your role prompt lists. Writing outside them is detected by a post-run diff
  and your work will be rejected. Never delete a file you do not own.
- Never run `mvn`, `npm run build`, a package install, or a deploy. Declare what must be tested; the
  orchestrator runs it once.
- Never edit another role's output, the evidence directory of another agent, or anything under
  `design/site-url/tools/` and `design/site-url/orchestrator/`.
- Never invent a visual score. Scores come only from `parity.mjs`.
- Every business-editable value is authored: copy, links, DAM paths, item counts, colour choices.
  Structural markup and framework attributes may be literal.
- Global chrome (site header, footer, announcement bars, mega-menu overlays) is delivered through
  Experience Fragments referenced from the template, never authored onto a page.
- Use the exact source asset for logos, icons and media. Never substitute a Unicode glyph such as
  `⌄ ▼ → × ▶` for an icon, and never redraw an SVG by hand.

## Result envelope — exact shape

This is **not** the `stage_result` envelope from `prompt_new.md`. Use these field names literally:

```jsonc
{
  "role": "component",           // planner | foundations | component | remediation — your role
  "component_id": "<your-id>",   // component and remediation roles only; omit otherwise
  "status": "PASS",              // PASS | FAIL | BLOCKED — not "verdict", not "result"
  "checks": [                    // at least one; your role prompt lists the required names
    { "name": "<required-check-name>", "status": "PASS", "evidence": "path or short proof" }
  ],
  "focused_test": { "tests": ["<TestClassName>"] },
  "contributions": { },
  "changed_files": ["<path you wrote, relative to the repository root>"],
  "notes": "anything the orchestrator should carry into the report"
}
```

Rules the orchestrator enforces on it:

- `status: "PASS"` while any check is `FAIL` is recorded as `FAIL`.
- A missing required check for your role is recorded as `FAIL`, and the rejection names which one.
- `checks[].evidence` should be a path or a one-line proof, not an essay.

## Shared files you must not write

The page `.content.xml`, experience-fragment content, `/conf/**` templates and policies,
`META-INF/vault/filter.xml`, `clientlib-base`, `clientlib-site`, every `ui.frontend` source
including the global design tokens, a clientlib's `css.txt` / `js.txt` / `.content.xml`,
`components/page/**`, and any `pom.xml`.

You **declare** what you need in those files through the `contributions` block of your result, and
the orchestrator writes them deterministically:

```jsonc
"contributions": {
  "page_node":   { "name": "<node>", "instance": "inst-001", "resource_type": "<project>/components/<id>",
                   "properties": { "...": "authored values" },
                   "children": [ { "name": "items", "children": [ { "name": "item0", "properties": {} } ] } ] },
  "experience_fragment_node": { "...": "same shape, for chrome only" },
  "policies":    [ { "path": "<project>/components/<id>/policy_default", "properties": { "jcr:title": "..." } } ],
  "policy_additions": [ { "path": "<project>/components/container/policy_main",
                          "property": "components", "values": ["<project>/components/<id>"] } ],
  "clientlib_entries": ["<id>.css"],
  "js_entries": ["<id>.js"]
}
```

Property values are plain JSON. Booleans, numbers and arrays are converted to JCR types for you.
Tag every page node with the `instance` it renders. Page order is taken from that instance's position
in the frozen evidence, so you never choose it and cannot collide with another component.
When your component claims several instances, `page_node` is a **list** — one entry per instance,
each with its own `name` and `instance`.
`clientlib_entries` and `js_entries` take file names relative to the clientlib's `css/` and `js/`
folders; the orchestrator writes the index files in plan order.
Two roles setting the same policy property to different values is a hard conflict that fails the
run, so only declare properties your own component owns.
