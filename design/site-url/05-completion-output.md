# Completion Output

Prepare this report after Stage 4 reaches a terminal `PASS`, `FAIL`, or `BLOCKED` result in the current run.

## MUST — Completion Authorization

Stage 5 is authorized after the Stage 4 Remediation Loop reaches a terminal result. The following are non-negotiable:

- MUST emit `status: COMPLETE` only when every upstream stage passed and every visual minimum is strictly above the run's pass ratio, read from `parity.json.threshold`. If Stage 4 exhausted its bounded retries or an external prerequisite remains unavailable, emit the corresponding `FAIL` or `BLOCKED` result without claiming completion.
- MUST validate every upstream `stage_result` envelope (Stages 1–4) belongs to the same `run_id` and current run. Return to the earliest missing or stale owning stage; restart Stage 1 only when source discovery or frozen denominators are invalid.
- MUST NOT recreate, infer, or synthesize a missing upstream result. The only source of Stage 5 content is the frozen artifacts published by Stages 1–4.
- For `COMPLETE`, MUST emit every mandatory table and artifact listed below. For `FAIL` or `BLOCKED`, emit every available table and explicitly list missing artifacts and their owning blocker.
- MUST cite the run ledger (`design-facts`, timing log, `remediation_history`) for every claim about coverage, scores, or asset deployment.

Only `status: COMPLETE` flips the pipeline. `FAIL` or `BLOCKED` closes the current run as incomplete and preserves the evidence needed for a later run.

## Stage Execution Contract

- Inputs: terminal results from Stages 1-4 with the same `run_id`; Stages 1-3 must be `PASS`, while Stage 4 may be `PASS`, `FAIL`, or `BLOCKED`.
- Validate each upstream envelope in `EVIDENCE_DIR/stages/`, its required outputs/checks, dependency IDs, and evidence freshness. Do not recreate or infer missing results.
- Every score, pixel count and gate verdict is copied from `parity/parity.json`. Every duration is copied from the launcher-owned `run-state.json` (`timings.stages` and `timings.total_seconds`). Do not estimate either.
- Produce the mandatory tables/artifacts summary below.
- Exit gate for `COMPLETE`: Stages 1-4 are accepted `PASS` results, all evidence belongs to this run, all coverage/component/asset/visual rows reconcile, and residual gaps are empty.

## Mandatory Tables

1. Per-instance score table at every breakpoint with Content, Typography, Color, Layout, Section order, Media/interaction, property score, screenshot score, authorability score, final minimum, and source/target evidence paths.
2. Component-type minima and breakpoint page composites.
3. Cross-breakpoint minimum instance, component type, and page composite.
4. Per-component geometry table from the visual gate.
5. Coverage report per breakpoint proving no unclaimed gap of 20 CSS px or more and showing each block's discovery signals.
6. Color-authorability matrix per component: role, selected token key, custom hex, correct conditional visibility, sanitized model value, deployed CSS property, and round-trip result.
7. Asset manifest with source/local/DAM paths, MIME, bytes, deployment method, reachability, and decode status.
8. Structured match-gate table per component: `typography`, `color`, `spacing`, `images`, `svg`, `glyph_substitutions`, `structure`, `rendered_fonts`, each `PASS` or `FAIL` with the owning selector and property for every failure.
9. Run summary: components planned, components created by tier (reused / extended / new), total duration, and per-stage duration — all copied from `run-state.json`.

## Mandatory Artifacts

For every breakpoint publish:

- `evidence/full-<bp>-source.png`
- `evidence/full-<bp>-target.png`

For every component instance and breakpoint publish:

- `evidence/<component>-<instance>-<bp>-<mode>-source.png`
- `evidence/<component>-<instance>-<bp>-<mode>-target.png`
- `evidence/<component>-<instance>-<bp>-<mode>-side-by-side.png`
- `evidence/<component>-<instance>-<bp>-<mode>-mask.png`

Read each row's paths from `parity.json` rather than building them. An instance that discovery saw at fewer breakpoints than another instance of the same component, and that overlaps it by at least half of the smaller box, is scored as part of that instance rather than on its own.

Report pixel counts and `visualMatchPercent`. Missing, blank, wrong-viewport, stale, or non-homologous artifacts invalidate the associated score.

Every score row must additionally include `Live URL`, `AEM URL`, `Viewport`, `DPR`, `Live Screenshot`, `AEM Screenshot`, `Side-by-Side`, `Diff Mask`, `Screenshot Validation`, `Matched Pixels`, `Differing Pixels`, and `Total Pixels`. If `Screenshot Validation != PASS`, omit every numeric score for that row and print `SCORE WITHHELD — INVALID OR MISSING SCREENSHOT EVIDENCE`.

## Status Line

Emit exactly one status line based only on current-run evidence:

```text
VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations — minimum instance <score>% — minimum component type <score>% — minimum page composite <score>% (required > <threshold>%)
VISUAL PARITY GATE: FAILED after bounded remediation — <N> FAILED-FINAL components — see residual_gaps
VISUAL PARITY GATE: BLOCKED — <external prerequisite and evidence>
```

Choose the line matching the Stage 5 status. Report `<threshold>` as the run's own `parity.json.threshold`, never a remembered constant. Do not emit PASSED unless every prerequisite and component is strictly above it in the current run's `parity.json`. Structured match gates are advisory and do not affect this line. Never present estimates, property-only scores, invalid-crop scores, or historical screenshots as visual-parity results.

## Concise Supporting Summary

Report invoked skills; sources; discovery and coverage; current `design-facts`; tiers; tokens/fonts/assets; files by component; template/policy changes; author regression audit; HTL list audit; spatial/interaction checks; tests/build/code assessment; deployed DOM/clientlibs/repository; demo path; accessibility deviations; and residual gaps.

Residual gaps must be empty for `COMPLETE`. For `FAIL` or `BLOCKED`, list every unresolved component or prerequisite with current evidence and do not emit the PASSED status line.

## Required Final Stage Result

Return the orchestrator's required envelope after the human-readable report:

```yaml
stage_result:
  stage: 05-completion-output
  run_id: <same run_id>
  status: COMPLETE|FAIL|BLOCKED
  inputs_consumed: [01-source-discovery:<result-id>, 02-component-authoring:<result-id>, 03-assets-runtime:<result-id>, 04-visual-parity:<result-id>]
  outputs:
    completion_report: <current response/artifact>
    pipeline_result_index: <all five result IDs>
  checks:
    - {name: all_upstream_results_present_and_pass, status: PASS|FAIL, evidence: <result index>}
    - {name: dependencies_same_run_and_current, status: PASS|FAIL, evidence: <run ledger>}
    - {name: coverage_files_assets_scores_reconcile, status: PASS|FAIL, evidence: <tables>}
    - {name: residual_gaps_consistent_with_status, status: PASS|FAIL, evidence: <report section>}
  failures: []
  next_stage: null
```

Only `status: COMPLETE` changes `pipeline_results.process_status` to `COMPLETE`. Missing, failed, stale, or mismatched upstream results produce `FAIL` or `BLOCKED` as applicable; a polished report cannot override pipeline state.