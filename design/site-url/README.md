# Migration Prompt Maintenance

Maintainer documentation, **not a migration-stage input**. Start a migration with [prompt_new.md](prompt_new.md), not this guide or a concatenation of this directory. This refactor does not execute or certify a migrated page.

## Audit And Measured Savings

Baseline measured on 2026-09-11 before editing the six original prompts. Current runtime total includes all six revised prompts **plus both new references**; it excludes this guide, test source, installed skills, project instructions, generated evidence, and conversation history in both comparisons.

| Instruction set | Before | After | Reduction |
|---|---:|---:|---:|
| Router words | 2,523 | 856 | 66.07% |
| Router UTF-8 bytes | 18,829 | 6,775 | 64.02% |
| All runtime prompt words | 9,578 | 6,968 | 27.25% |
| All runtime prompt UTF-8 bytes | 73,030 | 56,778 | 22.25% |

Words are whitespace-delimited; bytes are measured, not estimated tokens. Token counts and peak context depend on the selected model/tokenizer, automatic instruction injection, tool results, and session history. These numbers are **not a measured billing or peak-memory reduction**.

### Active-stage instruction sets

The router plus one stage and its direct required references, assuming a fresh context:

| Stage | Shared reference(s) | Words, excluding skills/evidence/history |
|---|---|---:|
| Source discovery | Capture gates | 2,848 |
| Component authoring | Skill routing | 2,309 |
| Assets/runtime | Capture gates + skill routing | 2,784 |
| Visual parity | Capture gates | 3,140 |
| Completion | None; upstream artifacts only | 1,387 |

Remediation additionally loads the affected owning-stage sections and relevant skill references. This table is not a claim that earlier stages disappear from one continuous chat.

## One Owner Per Contract

| Owner | Responsibility |
|---|---|
| [prompt_new.md](prompt_new.md) | Inputs/defaults, canonical thresholds, stage transitions, common result envelope, context loading |
| [references/capture-gates.md](references/capture-gates.md) | Fresh media readiness/playback, exact assets/icons, computed typography, stable geometry |
| [01-source-discovery.md](01-source-discovery.md) | Eleven discovery signals, full block catalog, negative evidence, source selectors, coverage, frozen scoring axes |
| [02-component-authoring.md](02-component-authoring.md) | Reuse tiers, component coverage, exact fields/colors, durable design facts, target selectors |
| [03-assets-runtime.md](03-assets-runtime.md) | Asset acquisition, assessment, scoped builds/deployments, live repository reconciliation |
| [04-visual-parity.md](04-visual-parity.md) | Runner preflight/revisions, valid screenshot scores, diagnostics, bounded batch remediation |
| [05-completion-output.md](05-completion-output.md) | Artifact-backed report, terminal status, residual gaps |
| [references/skill-routing.md](references/skill-routing.md) | Stage/file-type skill selection and approval/ownership handoffs |

Small action-local reminders remain intentionally. Full checklists, implementation templates, result schemas, and retry procedures should not be duplicated.

## Adobe Skill Review

Reviewed the installed AEM component-creation and code-assessment entrypoints, their applicable component references/runbook, the user-level best-practices hub, project configuration, and skill routing against the Java/HTL project. Reference topics include conventions, no-hallucination, dialogs, HTL, models, Java, tests, clientlibs, and Core extension patterns. Other installed skill descriptions were screened for applicability; unrelated photo, EDS, RDE, and workflow reference trees were not recursively loaded or modified.

Measured local entrypoints:

| Skill | Words | UTF-8 bytes | When needed |
|---|---:|---:|---|
| [create-component](../../.agents/skills/create-component/SKILL.md) | 2,171 | 17,118 | Every Tier 2/3/4 component; reuse the loaded body within the active context |
| [code-assessment](../../.agents/skills/code-assessment/SKILL.md) | 1,365 | 10,405 | Changed/generated Java/OSGi/Maven review; pattern references only when applicable |

Their reference files add further context. The entrypoints already support progressive disclosure: obey mandatory dependencies but do not read worked examples, servlet, Figma, or troubleshooting guides without a matching need. Do not copy third-party skill bodies into project prompts or change installed skill semantics merely to shrink tokens. The recognized filename is `SKILL.md`, not an aggregate `SKILLS.md`; no such aggregate exists in this workspace.

## Contradictions And Repetition Resolved

- **Geometry:** canonical 1 CSS px for x/y/width/height; removed Stage 4's conflicting 8 px height allowance.
- **Build scope:** removed routine clean/full-reactor instructions that contradicted incremental scoped deployment. Proven-stale build cleanup is distinct from prohibited hand-editing of generated outputs.
- **Invalid media:** readiness failure withholds scores; removed numeric asset-failure fallback penalties that could conflict with screenshot validity.
- **Breakpoints:** reconciliation uses runtime `BREAKPOINTS`, not a hardcoded default list.
- **Video order:** decode/present first, stabilize next, freeze motion last; shared procedure prevents source/target drift in instructions.
- **Stage returns:** structural/reuse reassessment returns to its owning stage; no unconditional Stage 1 restart after two CSS failures.
- **Models/images:** standalone Resource models remain supported; Core delegation retains request adaptation. Core Image can own DAM authoring on a child resource.
- **Results/reporting:** one envelope now includes explicit `result_id`; stages list required keys/checks. Full completion tables remain mandatory in a linked durable report rather than repeated in chat.
- **Artifacts:** screenshot paths are owned by Stage 4 and separated by disabled/author mode to avoid overwrites.
- **Skills/approval:** creation approval is not inferred; existing launcher authorization is preserved. Assessment remains scoped, local, report-first unless apply is authorized, with its own approval and one-pattern rules.

## Validation And Compatibility

[tests/prompt-contract.test.mjs](tests/prompt-contract.test.mjs) and [tests/launcher-reasoning.test.mjs](tests/launcher-reasoning.test.mjs) use Node's built-in test runner with no dependencies or network calls. Run via `node --test design/site-url/tests/prompt-contract.test.mjs design/site-url/tests/launcher-reasoning.test.mjs` from the repository root. The tests check links/fences, result keys, thresholds/mutations, discovery, media/authoring, retries, independent full-page gates, failure-only model handoff, launcher parsing, low/medium/high/xhigh capability handling and forwarding, identical workflow instructions, and word budgets (router <=900; runtime total <=7,000).

The test prints current metrics so maintenance does not rely on this table staying manually accurate. Keyword/structural tests do **not** prove LLM compliance, semantic equivalence of arbitrary edits, or browser/AEM parity. Review changed contracts and run a real migration separately before asserting operational parity.

The existing launcher entrypoint, stage filenames, flags, and concrete fallback URL remain compatible. Context-loading and Stage 5 progress wording changed; model/configuration helpers are now importable for offline tests without starting authentication or a run. The CMD wrapper and Adobe skill files are unchanged. External consumers should account for the renamed Stage 3 check `focused_tests_and_required_builds`, added assessment/coverage/full-page result keys, explicit result IDs, and mode-separated screenshot paths.

## Component, Full-Page, And Reasoning Assurance

- Every component instance requires a fresh live-source/AEM locator screenshot pair, labeled side-by-side, diff mask, and valid unrounded pixel score strictly above 90%, plus exact media/geometry/property/authorability gates.
- Full-page capture alone is insufficient. Stage 4 now explicitly requires an independent final full-page pixel comparison, side-by-side, mask, and `full_page_scores` at every breakpoint in both target modes. Component averages cannot replace it. Capture the authored content document, not the AEM editor chrome; unequal dimensions or missing evidence withhold scores.
- Stage 4 explicitly requires failure-only model handoff: compute every comparison locally, store complete evidence, and return compact JSON plus active failing/withheld/regressed pairs and relevant code. Passing images are loaded only for preflight, validation uncertainty, or rejection. Reduced page overviews/region crops are diagnostic-only, never scoring inputs. This is a runner requirement; runtime adherence still needs verification during a migration.
- `low`, `medium`, `high`, `xhigh`, and model-managed reasoning use identical workflow prompts (only effort metadata differs) and identical thresholds, diff settings, and retry caps. The launcher offers only recognized efforts advertised by the selected model, forwards the requested supported effort, and rejects unsupported effort instead of silently replacing it. Capability fixtures test this locally; actual account availability is discovered at runtime.
- Use `--effort low` or `--effort medium` when supported; no model-specific prompt copies are needed. If omitted, the existing default remains `high` when available, otherwise the first recognized advertised effort. Interactive runs offer that default without restricting the other supported choices. Models without recognized configurable efforts omit the flag and manage reasoning themselves.
- No effort level guarantees identical decisions or a passing migration. These are verified prompt/configuration contracts, NOT a cross-model browser benchmark or an independent post-run evidence verifier. Real source/AEM comparisons must execute in each migration; unresolved failures remain FAIL/BLOCKED, never assumed PASS because a particular effort was selected.

## Further Context Reduction

1. Attach only the router and runtime inputs, not the complete prompt/skill directory. Persist bulky evidence to files; return artifact paths, affected IDs, and short decisions.
2. Do not reread unchanged instructions while present in the active context; reload mandatory instructions after compaction. Skill discovery descriptions may still be auto-injected by the agent platform.
3. For actual stage-level context isolation, use separate agent contexts with validated artifact handoffs: router + active stage + run-state input IDs + relevant artifact paths. A fresh stage must validate prerequisites before acting.
4. The current launcher still uses one continuous agent session. Fresh contexts/subagents are a separate orchestration change, **not implemented or claimed here**. Keep file-writing stages and deployments sequential if adding them.