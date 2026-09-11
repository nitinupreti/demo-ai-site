# AEM Page Migration

Reproduce the complete visible source document as reusable, authorable AEM as a Cloud Service components. Include global chrome, headless/decorative regions, responsive variants, overlays, consent UI, floating utilities, and interactions. Linked pages are out of scope.

## Inputs

```yaml
SITE_URL: "https://www.notion.com/customers/cursor"
# Launcher fallback only; caller/launcher runtime values take precedence.
# Optional: TARGET_PAGE_PATH, BREAKPOINTS, EVIDENCE_DIR, RUN_ID, AEM_HOST, AEM_PORT
```

Never edit prompts to inject run-specific values. An unreadable resolved `SITE_URL` stops the run with URL and browser/network evidence.

## Canonical Run Contract

```yaml
required_breakpoints: [375, 768, 1440] # BREAKPOINTS may explicitly replace this list
visual_pass_ratio: "> 0.90" # unrounded matchedPixels / totalPixels; equality fails
geometry_tolerance_css_px: 1 # x/y/width/height; documented browser rounding only
max_attempts_per_component: 4
round_1_attempts: 3
round_2_attempts: 1
default_evidence_dir: design/scratch/migration-<run_id>
completion_requires: [stage_01_pass, stage_02_pass, stage_03_pass, stage_04_pass, no_residual_gaps]
```

These values are authoritative; stage/reference files cannot weaken them. `stage_NN_pass` means that stage's current accepted envelope has `status: PASS`; these are predicates, not additional artifacts.

Acceptance is model/effort-independent: `high` and `xhigh` use identical gates, pixel-diff settings, and retry limits. Reasoning effort cannot waive evidence or guarantee a match. Require both component comparisons and an independent final full-page pixel comparison; Stage 4 owns the procedure.

## Context Loading

- Read project instructions once: root `AGENTS.md`, `CLAUDE.md`, and `.aem-skills-config.yaml` when present. Do not reread content already available and unchanged in the active context.
- Read only the active stage and its explicitly required references. A link is a routing pointer, not an instruction to recursively load every Markdown file. Do not glob-load prompts, skill directories, examples, or historical runs.
- Consult [skill routing](references/skill-routing.md) only for Stage 2/3 or a skill-owned remediation. Follow each invoked skill's mandatory dependencies; load conditional references only when their condition applies.
- Persist large manifests, raw DOM, tables, screenshots, logs, `design-facts`, and retry history under `EVIDENCE_DIR`. Read the needed rows/artifacts, not chat reconstructions. Chat contains active decisions and short result summaries.
- After compaction or a new context, reload this router, the active stage, and referenced current-run evidence. Read-once applies only while the instructions remain available. Stage files do not unload earlier chat automatically.

## Stage Router

| Stage | Read when active | Required entry |
|---|---|---|
| 1 | [Source discovery](01-source-discovery.md) | Runtime inputs; no target inspection yet |
| 2 | [Component authoring](02-component-authoring.md) | Accepted Stage 1 |
| 3 | [Assets and runtime](03-assets-runtime.md) | Accepted Stage 2 component coverage |
| 4 | [Visual parity](04-visual-parity.md) | Accepted Stages 1–3; rerun after appearance/behavior deployments |
| 5 | [Completion report](05-completion-output.md) | Terminal Stage 4 PASS, FAIL, or BLOCKED |

Execute sequentially; only independent work inside a stage may run in parallel. Remediable Stage 1–3 failures stay with their owner. External blockers or required user decisions stop those stages without invented downstream results. Stage 4 always hands its terminal result to Stage 5, including exhausted retries. Direct Stage 4 entry requires current accepted prerequisite results for the same run.

Missing/stale evidence returns to its owning stage and invalidates affected dependents. Restart discovery only when source evidence or frozen denominators are invalid, never merely because retries were exhausted. User rejection invalidates affected evidence and scores.

## Shared Result Envelope

Create one `run_id` before Stage 1 (reuse `RUN_ID` when supplied). Persist each executed stage under `run-state.json.stage_results[stage]` using this envelope; each stage lists its required outputs/checks, without repeating the schema:

```yaml
stage_result:
  stage: <exact numbered filename stem>
  result_id: <unique revision ID>
  run_id: <same run_id>
  status: PASS|FAIL|BLOCKED # Stage 5: COMPLETE|FAIL|BLOCKED
  inputs_consumed: [<runtime inputs or upstream result IDs>]
  outputs: {<stage-defined keys>: <artifact paths or file inventory>}
  checks: [{name: <stage-defined check>, status: PASS|FAIL, evidence: <artifact>}]
  failures: [] # populated on failure/blocker
  next_stage: <router successor or null>
```

Missing output/check/envelope means not passed. Record artifact revisions/hashes, dependency result IDs, and timing in the ledger; refresh dependents when inputs change. Preserve launcher inputs/metadata and keep stage summaries, `current_stage`, and top-level status synchronized. Stage 5 alone may set COMPLETE; earlier stops set FAIL/BLOCKED and `next_stage: null`.

## Cross-Stage Guardrails

- Inspect only `SITE_URL` and exact resources observed in its DOM, CSS, or network traffic. No crawling linked pages, submitting forms, forwarding cookies, or inspecting unrelated embeds.
- Use Node.js Playwright/Chromium for source, disabled, and author evidence. Browser properties or build success alone cannot prove parity.
- [Capture gates](references/capture-gates.md) own exact assets/icons, computed typography/spacing, and freshly decoded stable video. Stages 1/3/4 invoke them; failures cannot be waived by a percentage.
- Author business-editable values and DAM asset paths; preserve media class. Stage 2 owns authorability, color controls, reuse, and `design-facts`; every edit must trace to an instance there.
- Validate the first implementation edit with the cheapest focused executable check before further edits. Keep FileVault validation enabled; reconcile live repository data after deployment.
- Never hand-edit generated/vendor paths (`target/`, `dist/`, `node_modules/`, `.m2/`, Core libraries) or template `initial`/`structure` trees. Authorized builds may regenerate outputs; Stage 3 owns proven-stale build cleanup.
- Completion requires exhaustive coverage and every instance, component-type minimum, and page composite strictly above the canonical ratio at every required breakpoint, in both target modes, with all exact checks passing and no residual gaps.