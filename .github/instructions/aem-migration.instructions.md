---
name: "AEM migration execution rules"
description: "Use when executing or resuming an AEM page/site migration, reproducing a live source page, or validating visual parity with the design/site-url prompt. Mandatory stage gates, evidence, no scope reduction, and truthful completion."
applyTo: "design/site-url/**,design/scratch/migration-*/**"
---

# AEM migration execution rules

## Scope and authority

- For migration execution, follow the [canonical router](../../design/site-url/prompt_new.md), its active stage, and required references. These rules reinforce that contract; they do not replace it or weaken its acceptance criteria.
- A request to explain, review, or edit instructions is not permission to execute a migration. Respect explicit user pauses, cancellations, and changes of task.
- Memory stores supporting facts, not exceptions to the contract. Neither historical success claims nor remembered shortcuts authorize skipping a current check.
- Required security, credential, cost, and tool approvals remain in force. Never bypass an editor permission denial or cancellation.

## No agent-authorized scope reduction

- Execute the full authorized five-stage pipeline. Do not substitute a "pragmatic", "targeted", "single-pass", or content-only migration.
- Do not skip or deprioritize discovery, component implementation, DAM/media work, deployment, or visual parity because they are difficult, slow, or expensive in effort/context.
- Do not ask whether to perform already-required stages or whether to continue the authorized scope. Ask only for a specific missing input, genuine external unblocker, or required approval.
- Disclosing a shortcut before or after delivery does not authorize it. "Not complete, but components render" is not an acceptable substitute for continuing required work when no legitimate blocker exists.

## Sequential stage gates and recovery

- Create or resume the same-run evidence ledger before executing stages; preserve runtime inputs, result revisions, dependencies, and retry history.
- Complete source discovery before inspecting or changing the target. Do not enter a successor stage without the router-required current accepted upstream envelopes and evidence.
- Partial discovery, a narrative summary, candidate counts, and a successful build are not accepted stage results. Missing checks remain missing; never manufacture a PASS.
- If evidence is missing, stale, or rejected, return to its owning stage and invalidate dependents. Resume the same run after interruption; never restart to erase failures or replenish retries.
- Use the canonical retry limits. If they are exhausted, route to FAIL. If an evidenced external blocker requires user action, route to BLOCKED and identify the exact failed operation and required unblocker. Workload alone is not an external blocker.
- Do not end a migration turn with "continue in subsequent turns" in place of doing authorized work. If execution is interrupted, persist a truthful checkpoint without claiming completion or background progress.

## Visual parity is mandatory

- Execute [Stage 4](../../design/site-url/04-visual-parity.md) only with its accepted prerequisites. Re-run affected verification after appearance or behavior changes.
- Compare every required source instance, component-type minimum, and page composite at every resolved breakpoint in both `disabled` and `author` modes. Defaults are 375, 768, and 1440 CSS px; only explicit runtime `BREAKPOINTS` may replace them.
- Produce actual component screenshot comparisons AND an independent final full-page pixel comparison. Use the prescribed pixel-diff runner and frozen options, with native screenshots, masks, side-by-side images, raw counts, and ratios retained as evidence.
- Every required unrounded ratio must be strictly greater than 0.90. Equality fails. All exact geometry, property, interaction, and media checks must also pass; a ratio cannot waive them.
- Follow the [capture gates](../../design/site-url/references/capture-gates.md). Verify actual viewport, device scale, screenshot dimensions, fonts, decoded media, and matching states. Reject collapsed-view screenshots. Unequal full-page dimensions withhold the score; repair geometry instead of resizing, padding, cropping, or masking away mismatches.
- HTTP 200, DOM/text presence, accessibility snapshots, screenshot spot checks, and successful compilation are diagnostic checks only. Never call them visual parity, use them instead of pixel comparisons, or report invented match percentages.

## Evidence integrity and completion

- Record stage status only from work actually executed. Keep absent results absent and failed checks failed until fresh evidence resolves them.
- During migration execution, never modify the router, acceptance tests, verifier, thresholds, or recorded measurements to force acceptance. Honest ledger updates must reflect real artifacts, not satisfy the verifier by fabrication.
- Before any COMPLETE or equivalent "migration finished/matches the live site" claim, run `node design/site-url/verify-run.mjs <EVIDENCE_DIR>` from the repository root and paste its output. Exit code 0, all required stage gates, and no residual gaps are necessary.
- Nonzero exit means not complete: report the failure list verbatim and remediate through the router unless a legitimate terminal condition applies. Do not relabel a failed full migration as a successful smaller task.
- The verifier checks submitted evidence; it does not itself perform browser captures or prove that artifacts are authentic. Preserve reproducible runner inputs and outputs for independent validation.

## Portability and timing

- Resolve paths from the repository, not a previous user's home directory. Read runtime host/port inputs; never copy remembered credentials or hard-code one user's AEM instance into shared rules.
- Follow [skill routing](../../design/site-url/references/skill-routing.md); confirm required skills, tooling, and runtime access on the current machine instead of assuming they transferred with memory.
- When reporting component-creation time, record its start/end intervals separately from discovery, deployment, and parity validation. Do not double-count overlapping sessions or label total elapsed migration time as measured component-authoring time.