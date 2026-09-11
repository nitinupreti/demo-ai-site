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

Authoritative values: stage/reference files cannot weaken them. `stage_NN_pass` means a current accepted envelope with `status: PASS`, not another artifact.

Acceptance is model/effort-independent: use supported `low`, `medium`, `high`, or `xhigh`; model-managed reasoning is also allowed. All choices use identical gates, pixel-diff settings, and retry limits; effort cannot waive evidence or guarantee parity. Stage 4 requires component comparisons AND an independent final full-page pixel comparison.

## Mandatory Full-Pipeline Execution

- Run all five stages exhaustively without asking whether to continue, prioritize required work, or approve the full scope. Discovery, component development, DAM assets, deployment, and visual validation are already authorized. Required safety/credential/cost approvals still apply.
- Missing components or clientlib-only stubs require implementation, not deferral. Reuse/extend/build through Stage 2; never replace required media, layouts, or interactions with text-only approximations.
- Workload, elapsed time, and session/context limits never justify reduced scope or a "pragmatic single-pass" delivery. Persist checkpoints and resume the same run after interruption; never reset retries or declare completion prematurely.
- Stop only for an explicit user pause/cancel, an evidenced external blocker requiring user action, or exhausted canonical retries. Ask only for the specific unblocker, never scope consent; follow FAIL/BLOCKED routing.

## Context Loading

- Read root `AGENTS.md`, `CLAUDE.md`, and optional `.aem-skills-config.yaml` once; do not reread unchanged instructions already available.
- Load only the active stage and required references; links are routing pointers, not recursive loading instructions. Never glob-load prompts, skills, examples, or historical runs.
- Consult [skill routing](references/skill-routing.md) for Stage 2/3 or skill-owned remediation; follow mandatory dependencies and applicable conditional references.
- Persist manifests, raw DOM, tables, screenshots, logs, `design-facts`, and retries under `EVIDENCE_DIR`; read needed rows, not chat reconstructions. Keep chat to decisions/summaries.
- After compaction/new context, reload this router, active stage, and current evidence. Read-once applies only while instructions remain available; stage files cannot unload chat.

## Stage Router

| Stage | Read when active | Required entry |
|---|---|---|
| 1 | [Source discovery](01-source-discovery.md) | Runtime inputs; no target inspection yet |
| 2 | [Component authoring](02-component-authoring.md) | Accepted Stage 1 |
| 3 | [Assets and runtime](03-assets-runtime.md) | Accepted Stage 2 component coverage |
| 4 | [Visual parity](04-visual-parity.md) | Accepted Stages 1–3; rerun after appearance/behavior deployments |
| 5 | [Completion report](05-completion-output.md) | Terminal Stage 4 PASS, FAIL, or BLOCKED |

Execute sequentially; parallelize only independent work within a stage. Remediate Stage 1–3 failures with their owner; external blockers stop without invented downstream results. Stage 4 always hands terminal results to Stage 5, including exhausted retries. Direct Stage 4 entry requires current accepted same-run prerequisites.

Missing/stale evidence returns to its owner and invalidates dependents. Restart discovery only for invalid source evidence/frozen denominators, never exhausted retries. User rejection invalidates affected evidence/scores.

## Shared Result Envelope

Create `run_id` before Stage 1 (reuse supplied `RUN_ID`). Persist each executed stage under `run-state.json.stage_results[stage]`; stages define required outputs/checks:

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

Missing outputs/checks/envelopes mean not passed. Log revisions/hashes, dependency IDs, and timing; refresh dependents when inputs change. Preserve launcher inputs/metadata; synchronize summaries, `current_stage`, and top-level status. Stage 5 alone may set COMPLETE; earlier stops set FAIL/BLOCKED and `next_stage: null`.

## Cross-Stage Guardrails

- Inspect only `SITE_URL` and exact DOM/CSS/network-observed resources. No linked-page crawling, form submissions, cookie forwarding, or unrelated embed inspection.
- Use Node.js Playwright/Chromium for source/disabled/author evidence. Browser properties/build success cannot prove parity.
- [Capture gates](references/capture-gates.md) own exact assets/icons, computed typography/spacing, and freshly decoded stable video. Mandatory in Stages 1/3/4; percentages cannot waive failures.
- Author business-editable values and DAM paths; preserve media class. Stage 2 owns authorability, colors, reuse, and `design-facts`; trace every edit to an instance.
- Validate the first implementation edit with the cheapest focused executable check before further edits. Keep FileVault validation enabled; reconcile deployed repository data.
- Never hand-edit generated/vendor paths (`target/`, `dist/`, `node_modules/`, `.m2/`, Core libraries) or template `initial`/`structure` trees. Authorized builds may regenerate outputs; Stage 3 owns proven-stale build cleanup.
- Completion requires exhaustive coverage, no residual gaps, all exact checks passing, and every instance/component-type minimum/page composite strictly above the canonical ratio at every required breakpoint in both target modes.