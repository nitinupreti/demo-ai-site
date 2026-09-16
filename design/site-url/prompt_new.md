# AEM Page Migration — Canonical Contract

This file is the single source of truth for **what a migration run must achieve**.
It does not describe how the work is split across agents; that lives in the agent
prompts under `design/site-url/scripts/prompts/`.

Both entry points read this file:

- `python design/site-url/scripts/run_migration.py` — the multi-agent pipeline
  (combined planner/foundations, isolated component workers, assets, merge, deployer,
  parity and orchestrator-owned reporting). See
  [scripts/README.md](scripts/README.md).
- `design/site-url/run-migration.cmd` — the original single-agent launcher.

## Inputs

```yaml
SITE_URL: "https://www.notion.com/customers/cursor"
# Optional: TARGET_PAGE_PATH, BREAKPOINTS, EVIDENCE_DIR
```

`SITE_URL` is a runtime input. Supply it with `--url`; the value above is only the
fallback default. Never edit this file to inject a run-specific URL. If the resolved
URL is unreadable, STOP and report the failing URL with browser/network evidence.

## Canonical Run Contract

These values control every agent. An agent prompt may add detail but MUST NOT weaken
or override them.

```yaml
required_breakpoints: [375, 768, 1440] # unless BREAKPOINTS explicitly replaces them
visual_pass_ratio: ">= 0.90"           # compare the unrounded matched/total ratio
max_attempts_per_component: 4          # total remediation attempts per component
default_evidence_dir: design/scratch/migration-<run_id>
completion_requires: [plan_pass, implement_pass, deploy_pass, parity_pass, no_residual_gaps]
```

One `run_id` is created before planning and preserved for the whole run. Every agent
writes its artifacts and a machine-readable envelope under `EVIDENCE_DIR` so later
agents consume files rather than reconstructed chat summaries.

## Objective

Reproduce the complete visible source document as reusable, authorable AEM as a Cloud
Service components: global chrome, all main regions, headless and decorative bands,
responsive-only variants, overlays, consent UI, floating utilities, and interactions.
Linked pages are out of scope unless supplied separately.

Deliver Sling Models, HTL, Coral 3 dialogs, BEM CSS, shared tokens, clientlibs,
focused tests, deployable assets, policy updates, and a populated demo page.
Validate disabled and author modes at every required breakpoint. A successful build
is not completion — the visual parity gate controls completion.

## Non-Negotiable Rules

- **Header navigation scope: visible links only.** At each required breakpoint,
  capture and reproduce the header's default visible links and styling. Do not
  hover or focus header controls to reveal menus, or open header dropdowns and
  submenus. Hidden submenu content and its interactions are out of scope. This
  exception applies to document headers/banners and top-level navigation, not
  main-content or footer interaction checks. Visible links remain authored and
  part of visual parity; do not claim hidden-menu verification was performed.
- `MUST`, `FAIL`, and `STOP` are completion-blocking. STOP only for unreadable or
  missing sources, conflicting authorities, unresolved external blockers, or explicit
  user-input requirements. Every other failure requires in-run remediation.
- **No omission.** No visible block may be dropped, including headless blocks such as
  marquees, tickers, announcement bars, background-media strips, and overlays.
  Perceived scope, effort, or elapsed time never justifies partial delivery. If a
  block genuinely cannot be delivered, report `FAIL`/`BLOCKED` truthfully rather than
  silently reducing scope.
- **Everything business-editable is authored.** Never hardcode copy, links, assets,
  item counts, or visual choices unless the component contract explicitly permits it.
- **Color roles use tokens.** Every color role is a curated token select with an
  `other` option that reveals a validated custom-hex field. Models sanitize custom
  values; HTL exposes them only through protected CSS custom properties.
- **Assets keep their class and live in DAM.** Author DAM paths, never remote or
  temporary URLs. Video stays video, animation stays animation, and a poster is never
  a substitute for a video. Branded artwork is the real asset, never typed letters,
  CSS borders, emoji, or a hand-drawn approximation. Icons are real SVG/image
  elements, never Unicode glyphs appended to an authored label.
- **Typography is computed, not declared.** A matching CSS family declaration does not
  pass when the requested font failed to load, a fallback rendered, glyph metrics
  differ, or line breaks differ.
- **Evidence is rendered, not inferred.** Use Playwright/Chromium against the live
  source and the deployed AEM page. Property equality alone never establishes visual
  parity, and a score is invalid without valid side-by-side screenshot evidence.
- **The gate is strict.** Every component instance, component-type minimum, and page
  composite must satisfy `visual_pass_ratio` at every required breakpoint, evaluated
  on the unrounded ratio. The configured pixel target applies; exact style gates cannot
  be compensated by a high screenshot score.
- **Exact rendered styles.** Font family, rendered fonts, size, weight, style,
  line height, letter/word spacing, text and background colors, padding, margins
  and gaps must match the live source's computed values exactly. Missing values or
  unloaded/fallback fonts fail. The coordinator collects these measurements and
  evaluates them directly; an agent's PASS label is not sufficient.
- **A component passes only when everything passes.** Its final status is the minimum
  of source coverage, geometry, property, screenshot, interaction/media, and
  authorability results.
- **User rejection invalidates evidence.** Recapture and remediate; do not defend a
  stale score.
- **Never hand-edit generated or vendor paths:** `target/`, `dist/`, `node_modules/`,
  `.m2/` or Core Component libraries. Permitted build tools may generate normal output
  under the shared validation policy. Never edit template `initial`/`structure` trees.
- **Never rewrite the user's git history.** No commit, push, reset, clean, checkout,
  switch, or rebase.

## Required Project Workflows

1. Read `AGENTS.md`, `CLAUDE.md`, and `.aem-skills-config.yaml` when present.
2. Use the `create-component` skill for every Tier 2/3/4 component, and run
   `code-assessment` on generated Java/OSGi/Maven code before completion.
3. Inspect only `SITE_URL` and the exact resources referenced by its DOM, CSS, or
   captured network traffic. Do not crawl linked pages, submit forms, forward
   cookies, or inspect unrelated embeds.
4. Use Node.js Playwright/Chromium for all browser evidence, with
   `locator.screenshot()` plus `pixelmatch` and `pngjs`/`sharp` for scoring.

## Shared `design-facts` ledger

Every implementation and remediation change must trace to this block, kept current
under `EVIDENCE_DIR` throughout the run:

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

## Agent Router

| Phase | Agent prompt | Owns |
|---|---|---|
| 1 | [planner](scripts/prompts/planner.md) | Source evidence, coverage proof, frozen denominators, component plan, and sole ownership of shared tokens, site styles and policies. Repairs reuse this agent without replanning. |
| 2 | [component](scripts/prompts/component.md) | One component per isolated checkout; explicit file ownership and dependency barriers; authored content contributions. |
| 3 | Deterministic Python assets handler | Asset downloads and DAM uploads from declared manifests. |
| 4 | Deterministic Python merge handler | Authored page/XF nodes and Vault filters in source order. |
| 5 | Coordinator build handler, then [deployer](scripts/prompts/deployer.md) | Serialize shared frontend generation from merged source, then focused checks, scoped Maven deploy, runtime and repository sweep. |
| 6 | [parity](scripts/prompts/parity.md) and pinned scorer | Fresh Playwright captures and qualitative diagnostics; coordinator-owned Pixelmatch acceptance and receipts. |
| 7 | Deterministic orchestrator report handler | The completion report, persisted report result, and terminal gate status from recorded evidence. No agent invocation. |

This dispatch describes the Python pipeline. The legacy single-agent entry point
must satisfy the same acceptance contract without assuming Python's isolation or
checkpoint enforcement is present.

Phases run in order. A phase may start only once its prerequisites exist, and each
must end with its result envelope persisted to the run state — a phase without its
envelope is treated as not run. Independent reads and downloads inside a phase may
run in parallel, and component implementation is fanned out deliberately; dependent
phases never overlap.

When a later phase exposes missing or stale evidence, return to the owning phase,
refresh that evidence, and continue. Never compensate for missing discovery or
content by tuning CSS.

## Bounded remediation

Each failing component is capped at `max_attempts_per_component` total attempts. An
attempt must begin from a live-DOM diagnostic, test one falsifiable root-cause
hypothesis, and — when the geometry delta is non-zero — close the geometry gap before
typography or color. If the same gap survives two consecutive attempts, stop tuning
CSS and reassess the component's block boundary, structure, or reuse tier.

When the budget is exhausted, the component is terminal. Report it in
`residual_gaps` with its final ratio, owning-layer trace, evidence paths, and why
further remediation was not viable. Never restart discovery solely because the budget
ran out, and never emit a completion status with residual gaps outstanding.
