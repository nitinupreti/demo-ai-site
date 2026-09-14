# Skill Loading Contract

Use installed skills, not copies of their implementation guides. Relevant workspace entrypoints are [create-component](../../../.agents/skills/create-component/SKILL.md) and [code-assessment](../../../.agents/skills/code-assessment/SKILL.md). The convention is `SKILL.md` (singular); no aggregate `SKILLS.md` is needed.

Read an invoked entrypoint once per active context, and each of its mandatory references once per active context, then reuse both for every component in that context. Re-reading a reference already loaded in the same context is waste, not diligence; skipping a mandatory dependency to save tokens is a defect. Never preload the entire reference tree. Record loaded paths/revisions and component IDs in the run ledger; reload after compaction or file changes.

Load per component SET, not per component: plan the set and its tiers first, take the union of references those tiers require, load that union once, then implement the set. A later component needing an unloaded reference loads only that reference.

| Stage / trigger | Load |
|---|---|
| 1: source discovery | No component implementation skill |
| 2: component set containing any Tier 2/3/4 | `create-component` once for the whole set; validate root configuration first, then conventions and no-hallucination rules |
| Dialog / HTL / model / tests / clientlib being authored | The skill's corresponding dialog, HTL, model + Java, test, or clientlib reference, once for every component that needs it |
| Extension | Extension reference; worked example only when needed |
| Servlet / Figma input / troubleshooting | Corresponding reference only when that feature/input/problem exists |
| 3: generated/modified Java, OSGi, Maven review | `code-assessment` and its runbook; supply changed paths, run the local analyzer, then only applicable pattern guides |
| 4: remediation | Owning stage plus references for changed file types; reassess code if Java/OSGi/Maven changed |
| 5: reporting | Existing skill results, not skill bodies |

`best-practices` is an installed platform-reference hub: load matching modules only when its Java/OSGi/HTL patterns occur, not duplicate copies alongside equivalent code-assessment guides. Specialized workflow, distribution, Dispatcher, and RDE skills need their actual feature triggers. RDE requires explicit RDE scope. Legacy BPA/CAM `migration` and EDS page-import/building-blocks/Universal Editor workflows are not this Java/HTL visual migration. Adobe Express/photo/video editing skills are not component generators. Higher-priority skill triggers still apply.

## Ownership And Handoff

- Skills own implementation patterns; Stage 2 owns site-wide reuse, color authoring, coverage, and exact field contracts. Its four reuse tiers are NOT the creation skill's three parent-lookup choices.
- Pass one bounded component contract: source instance IDs/artifact paths, semantic name, supertype, exact ordered fields/defaults, variant/behavior rules, file scope, tests, and accepted authorization. Return file paths, checks, and unresolved gaps; do not paste entire manifests or skill bodies per component.
- Honor explicit dialog specifications and approval gates. Without a confirmed contract, ask; in a non-interactive run, BLOCK unless the caller explicitly authorized evidence-derived fields (the launcher does). Never infer approval from silence.
- Prefer Core Image embedding/delegation per the skill; DAM authoring can live on its child resource. Explicit source-backed asset-path contracts must be recorded, not silently replaced by manual fileupload rendering. Keep Core delegation's request adaptable; use Resource models for standalone content/children where appropriate.
- Assessment is report-first unless apply was authorized. Respect its local-only analyzer, mandatory reports, one-pattern-per-session apply, and approval rules. Do not convert a visual-fix batch into an unrelated repository-wide upgrade. Conflicting branch/rollback permissions require resolution; never discard user work.