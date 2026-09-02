# Completion Output

Prepare this report only after all stage prerequisites pass in the current turn.

## Stage Execution Contract

- Inputs: accepted results from Stages 1-4 with the same `run_id`.
- Validate each upstream result envelope, its required outputs/checks, dependency IDs, and evidence freshness. Do not recreate or infer missing results.
- Produce the mandatory tables/artifacts summary below.
- Exit gate: Stages 1-4 are accepted `PASS` results, all evidence belongs to this run, all coverage/component/asset/visual rows reconcile, and residual gaps are empty or explicitly approved.

## Mandatory Tables

1. Per-instance score table at every breakpoint with Content, Typography, Color, Layout, Section order, Media/interaction, property score, screenshot score, authorability score, final minimum, and source/target evidence paths.
2. Component-type minima and breakpoint page composites.
3. Cross-breakpoint minimum instance, component type, and page composite.
4. Per-component geometry table from the visual gate.
5. Coverage report per breakpoint proving no unclaimed gap of 20 CSS px or more and showing each block's discovery signals.
6. Color-authorability matrix per component: role, selected token key, custom hex, correct conditional visibility, sanitized model value, deployed CSS property, and round-trip result.
7. Asset manifest with source/local/DAM paths, MIME, bytes, deployment method, reachability, and decode status.

## Mandatory Artifacts

For every breakpoint publish:

- `evidence/full-<bp>-source.png`
- `evidence/full-<bp>-target.png`

For every component instance and breakpoint publish:

- `evidence/<instance>-<bp>-source.png`
- `evidence/<instance>-<bp>-target.png`
- `evidence/<instance>-<bp>-side-by-side.png`
- `evidence/<instance>-<bp>-mask.png`

Report pixel counts and `visualMatchPercent`. Missing, blank, wrong-viewport, stale, or non-homologous artifacts invalidate the associated score.

Every score row must additionally include `Live URL`, `AEM URL`, `Viewport`, `DPR`, `Live Screenshot`, `AEM Screenshot`, `Side-by-Side`, `Diff Mask`, `Screenshot Validation`, `Matched Pixels`, `Differing Pixels`, and `Total Pixels`. If `Screenshot Validation != PASS`, omit every numeric score for that row and print `SCORE WITHHELD — INVALID OR MISSING SCREENSHOT EVIDENCE`.

## Status Line

Emit exactly one status line based only on current-turn evidence:

```text
VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations — minimum instance <score>% — minimum component type <score>% — minimum page composite <score>% (required >92%)
```

Do not emit PASSED unless every prerequisite and component is strictly above 92% using valid current-run Playwright screenshots from the exact live site and deployed AEM page. Never present estimates, property-only scores, invalid-crop scores, or historical screenshots as visual-parity results. When blocked by an external prerequisite that cannot be remediated, report the blocker plainly without fabricating a score or gate status.

Do **not** substitute a "want me to continue?" question, a remediation proposal, or a next-step offer for the required status line. If parity has not yet reached `>92%`, the correct action is to return to Stage 04 and keep iterating autonomously — not to emit this stage. Only invoke Stage 05 once Stages 1-4 are current-turn `PASS` results **or** a genuinely external blocker is proven; in the blocker case, emit a `BLOCKED` status line naming the blocker and its evidence, without asking the user how to proceed.

## Concise Supporting Summary

Report invoked skills; sources; discovery and coverage; current `design-facts`; tiers; tokens/fonts/assets; files by component; template/policy changes; author regression audit; HTL list audit; spatial/interaction checks; tests/build/code assessment; deployed DOM/clientlibs/repository; demo path; accessibility deviations; and residual gaps.

Residual gaps must be empty unless the user explicitly approved them in the same turn.

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
		- {name: residual_gaps_empty_or_approved, status: PASS|FAIL, evidence: <report section>}
	failures: []
	next_stage: null
```

Only `status: COMPLETE` changes `pipeline_results.process_status` to `COMPLETE`. Missing, failed, stale, or mismatched upstream results force `FAIL`; a polished report cannot override pipeline state.
