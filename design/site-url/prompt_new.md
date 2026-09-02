# AEM Page Migration

## Inputs

```yaml
SITE_URL: "https://credera.com/en-in"
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
4. **Visual parity and remediation** — read [04-visual-parity.md](04-visual-parity.md). Run after every deploy affecting appearance or behavior.
5. **Completion report** — read [05-completion-output.md](05-completion-output.md) only when preparing the final response.

If a later stage exposes missing or stale evidence, return to the owning stage, refresh that evidence, and continue. Never compensate for missing discovery or content by tuning CSS.

## Non-Negotiable Rules

- `MUST`, `FAIL`, and `STOP` are completion-blocking. STOP only for unreadable/missing sources, conflicting authorities, unresolved external blockers, or explicit user input requirements. Other failures require in-turn remediation.
- No visible block may be omitted, including headless blocks such as marquees, tickers, announcement bars, background-media strips, and overlays.
- Every business-editable value must be authored. Do not hardcode copy, links, assets, item counts, or visual choices unless the component contract explicitly permits it.
- Every color role uses a curated token select with `other`; choosing `other` reveals a validated custom-hex field. Models sanitize custom values and HTL exposes them only through protected CSS custom properties.
- Author DAM paths, never remote or temporary URLs. Preserve media class: video remains video, animation remains animation, and a poster is not a substitute.
- Use Playwright/Chromium for live source and target evidence. Property equality alone cannot establish visual parity.
- Every component instance, component-type minimum, and page composite must be strictly `>92%` at every required breakpoint. `92.000%` fails.
- A component passes only when exhaustive source coverage, geometry, property, screenshot, interaction/media, and authorability checks all pass.
- User rejection invalidates the affected evidence and score; recapture and remediate.
- Never modify generated/vendor paths: `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or template `initial`/`structure` trees.
- A failing parity score, a failing gate check, a failing component axis, an incomplete breakpoint sweep, or an unfinished remediation is **never** grounds for pausing, asking the user whether to continue, or handing back for approval. Keep iterating the Stage 04 Remediation Loop autonomously until every raw instance, component-type minimum, and page composite is strictly `>92%` at every required breakpoint, or a genuinely unrepairable external blocker is documented in the current turn.
- Do not end a turn with a question, a proposal, or an “want me to continue?” prompt while any parity check, gate check, or coverage requirement is still failing and remediation options remain. Asking permission counts as an unauthorized STOP.

## Required Project Workflows

1. Read `AGENTS.md`, `CLAUDE.md`, and `.aem-skills-config.yaml` when present.
2. Use `create-component` for every Tier 2/3/4 component. Run `code-assessment` on generated Java/OSGi/Maven code before completion.
3. Inspect only `SITE_URL` and exact resources referenced by its DOM, CSS, or captured network traffic. Do not crawl linked pages, submit forms, forward cookies, or inspect unrelated embeds.
4. Keep an inline `design-facts` block current throughout implementation:

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
  - design_instance: <source selector/heading/rect>
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
