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

## Evidence Cleanup

Every accepted Stage 04 run leaves behind tens of megabytes of raster crops, side-by-side composites, diff masks, downloaded source assets, per-block screenshots, and full-page captures under `evidence/`, plus a set of pipeline-scratch runner scripts under `scripts/` (`stage1_discovery.py`, `stage2_download_assets.py`, `stage2_place_dam.py`, `stage3_author_xfs.py`) and root-level `build.log` files that each `mvn install` emits. Once Stage 04 reports `PASS` in this turn and the completion report has been emitted, wipe both the `evidence/` tree and the pipeline scratch. The reasoning trail lives in git history and the report; everything else is disposable.

Run the shipped cleanup runner from the repo root in **full** mode as the last action of Stage 05:

```powershell
python design/site-url/cleanup_evidence.py --full        # MANDATORY at completion — wipes evidence/ AND pipeline scratch scripts + build.logs
python design/site-url/cleanup_evidence.py --dry-run     # preview only
python design/site-url/cleanup_evidence.py               # safe prune — only for mid-pipeline size relief, never at completion
```

Cleanup rules:

- **After a `PASS` status line, ALWAYS invoke `--full`.** Safe-prune is not sufficient at completion. `--full` removes:
    - Everything under `evidence/` (per-block source/target/mask/side-by-side crops, full-page captures, source/target manifests, downloaded raw asset copies, `evidence/node_modules`), leaving a single `.gitkeep`.
    - Every entry listed in `PIPELINE_SCRATCH` inside `design/site-url/cleanup_evidence.py` — the discovery/download/DAM-placement/XF-authoring runner scripts and any `build.log` files at the repo root and per-module. These are one-shot scaffolding written during the migration; they belong in git history, not the working tree at completion.
    - `design/site-url/cleanup_evidence.py` itself and `design/site-url/component_parity.py` (the mandatory shipped runner) are NOT in the scratch list and are preserved.
- **Never invoke `--full` while Stage 04 is still iterating** — the raster crops are the executable remediation queue and the runner scripts drive that queue. Only run at the very end of Stage 05 once the completion report has been emitted.
- **Never leave cleanup to a future turn.** The wipe happens in the same turn that emits `VISUAL PARITY GATE: PASSED`. Leaving `evidence/` or pipeline scratch scripts populated for the user to clean up later is non-compliant.
- **Cite the pre-/post-cleanup footprint** (`files`, `MB`) for both `evidence/` and the pipeline-scratch list in the completion summary so the deletion is auditable.
- If Stage 04 exits `BLOCKED` rather than `PASS`, do NOT wipe — the crops and runner scripts are the blocker's proof and the reproduction path; leave them in place.

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
		- {name: evidence_cleanup_executed, status: PASS|FAIL, evidence: <pre-cleanup footprint (files, MB) for BOTH evidence/ AND the pipeline-scratch list, post-cleanup MUST be evidence/ = 0 files ex `.gitkeep` AND every `PIPELINE_SCRATCH` entry absent, invocation `python design/site-url/cleanup_evidence.py --full`>}
	failures: []
	next_stage: null
```

Only `status: COMPLETE` changes `pipeline_results.process_status` to `COMPLETE`. Missing, failed, stale, or mismatched upstream results force `FAIL`; a polished report cannot override pipeline state.
