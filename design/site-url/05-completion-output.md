# Completion Output

Read only after Stage 4 reaches terminal PASS, FAIL, or BLOCKED. Use upstream artifacts, not reconstructed chat or reloaded implementation skills.

## Authorization

- Validate Stage 1–4 envelopes, outputs/checks, `run_id`, dependency result IDs, and evidence revisions. Stages 1–3 must be accepted PASS; Stage 4 may be terminal FAIL/BLOCKED for reporting only.
- Missing/stale prerequisites return to their owner. Never invent a result; restart Stage 1 only for invalid source discovery/denominators, not exhausted retries.
- COMPLETE requires all four stages PASS, all coverage/files/assets/scores reconciled, strict visual minima, and empty `residual_gaps`. FAIL/BLOCKED closes an incomplete run and explicitly identifies missing evidence and its owner.
- COMPLETE additionally requires a zero exit from `node design/site-url/verify-run.mjs <EVIDENCE_DIR>`, run after the final `run-state.json` write and reported with its output. Non-zero exit forces FAIL/BLOCKED.
- Never label partial delivery "migration complete", even with disclosed gaps. Record start/end/elapsed timing; incomplete runs have stop times, not successful completion times.

## Durable Report

Write the complete report under `EVIDENCE_DIR`; link it from the final response instead of reprinting large tables in chat. Cite `design-facts`, timing log, `remediation_history`, and upstream artifacts for every claim. Include these tables, with breakpoint AND target mode:

1. Per-instance Content, Typography, Color, Layout, Section order, Media/interaction, property score, screenshot score, authorability score, final minimum, and evidence paths.
2. Component-type minima, breakpoint page composites, and independent `full_page_scores` with full-page pixel ratios and final deployment revision; averages cannot replace the full-page check.
3. Cross-breakpoint/mode minimum instance, type, and page composite.
4. Per-component geometry/deltas/full-bleed status.
5. Coverage ranges/discovery signals proving no unclaimed gap of 20 CSS px or more.
6. Color authorability: role, token key, custom hex, conditional visibility, sanitized model value, deployed CSS property, round-trip result.
7. Assets: source/local/DAM paths, MIME, bytes, deployment method, reachability, decode status, and exactness evidence.

Publish the full-page and every instance's source/target/side-by-side/mask files using Stage 4's mode-specific artifact index. Every score row carries Stage 4's citation set unchanged, including `visualMatchPercent`. Invalid evidence means all numeric scores are omitted and the Stage 4 withheld reason is shown. No historical or estimated scores.

## Status Line

Emit exactly one line matching current evidence:

```text
VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations — minimum instance <score>% — minimum component type <score>% — minimum page composite <score>% — minimum full-page pixel match <score>% (required >90%)
VISUAL PARITY GATE: FAILED — <reason; bounded-retry FAILED-FINAL count when applicable> — see residual_gaps
VISUAL PARITY GATE: BLOCKED — <external prerequisite and evidence>
```

PASSED is allowed only for COMPLETE under the router's strict unrounded ratio and exact gates, including valid final full-page pairs in both modes at every breakpoint. Report `MODEL`/`THINKING_EFFORT` as provenance, never as proof of parity.

## Supporting Summary And Gaps

In the report, summarize invoked skills, sources/coverage, facts/tiers, tokens/fonts/assets, files by component, template/policy changes, author regression and HTL-list audits, spatial/interaction checks, tests/build/assessment, deployed DOM/clientlibs/repository, demo path, and accessibility deviations.

For FAIL/BLOCKED, list EVERY unresolved component/prerequisite and missing artifact. Each `FAILED-FINAL` row includes component, breakpoints/modes, final valid `visualMatchPercent` or withheld reason, owning-layer trace, evidence paths, attempt count, and why further remediation was not viable within four attempts. COMPLETE requires `residual_gaps: []`.

## Required Final Stage Result

Persist and return the shared envelope with `stage: 05-completion-output`, Stage 1–4 result IDs, `status: COMPLETE|FAIL|BLOCKED`, and:

- **outputs:** `completion_report` (artifact), `pipeline_result_index` (all five result IDs).
- **checks:** `all_upstream_results_present_and_pass`, `dependencies_same_run_and_current`, `coverage_files_assets_scores_reconcile`, `residual_gaps_consistent_with_status`.
- **next_stage:** null.

Only COMPLETE sets `pipeline_results.process_status` and top-level run status to COMPLETE. FAIL/BLOCKED remains incomplete regardless of report quality.