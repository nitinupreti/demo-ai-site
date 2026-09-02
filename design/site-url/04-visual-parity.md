# Visual Parity Gate

This file owns component scoring, exact checks, screenshots, interaction comparison, anti-gaming rules, and remediation. Run it in the same turn as every appearance/behavior deploy.

## Stage Execution Contract

- Inputs: accepted Stages 1-3 results, frozen denominators, deployed target URLs, and the same `run_id`.
- Mandatory runner: `evidence/component_parity.py`. It owns full-page capture, dynamic component discovery, source-to-target pairing, per-component crops, geometry score, pixel score, final score, side-by-side images, diff masks, and strict `>92%` screenshot status.
- Execute the full Playwright comparison at every breakpoint for every block/instance. Do not substitute CSS declarations or selected properties for rendered evidence.
- Required outputs: readiness matrix, per-instance geometry/property/interaction tables, full and component screenshots, side-by-side/diff artifacts, scores, remediation history, and final minima/composites.
- Exit gate: all prerequisites pass and every raw instance, component-type minimum, and page composite is strictly above 92% at every breakpoint.

## Mandatory Parity Runner

### Prerequisites

The runner is a Python 3 script and depends on Playwright/Chromium, NumPy and Pillow. Before the first invocation of Stage 04 on any machine, the executing agent MUST bring the environment up to spec autonomously — do not fall back to manual screenshots, visual inspection, or a fabricated score just because Python is missing.

#### Agent bootstrap procedure

Execute these steps in order at the start of every Stage 04 session. Each step is a single, copy-pastable command; the agent runs them itself in the user's shell (do NOT paste them into chat and wait for a human).

1. **Detect Python 3.10+**:

    ```powershell
    python --version   # Windows
    python3 --version  # macOS / Linux
    ```

    If the command succeeds and reports `>= 3.10`, skip to step 3. If it fails or reports `< 3.10`, continue to step 2.

2. **Install Python without admin rights, after asking the user for consent.** Software installation is an out-of-band operation, so the agent MUST first surface a one-line confirmation to the user ("Python 3.10+ is missing. Install Python 3.12 per-user via <winget|brew|apt|dnf>? y/N") using the environment's structured question tool. If the user declines, or if the platform install path below is not available, report Stage 04 as `BLOCKED` with the specific evidence (installer error, admin-lockout screenshot, or the enterprise policy that forbids installation) and stop; do not return `PASS`, do not proceed to scoring.

    Once consent is granted, run the platform-appropriate command. All four options install per-user and require no admin elevation:

    | OS | Command the agent runs after consent |
    |---|---|
    | Windows 10/11 | `winget install --id Python.Python.3.12 -e --scope user --accept-package-agreements --accept-source-agreements` |
    | macOS | `brew install python@3.12` |
    | Debian / Ubuntu | `sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip`  *(sudo is unavoidable here; if the user cannot grant it, treat as `BLOCKED`)* |
    | Fedora / RHEL | `sudo dnf install -y python3 python3-pip`  *(same sudo caveat as Debian)* |

    After the installer exits `0`, refresh the current shell's `PATH` so the new interpreter is visible without opening a new terminal:

    ```powershell
    $env:PATH = [Environment]::GetEnvironmentVariable('PATH','User') + ';' + [Environment]::GetEnvironmentVariable('PATH','Machine')   # Windows
    # hash -r                                                                                                                          # macOS / Linux (bash/zsh)
    ```

    Then re-run step 1 to confirm.

3. **Create or reuse the project's isolated `.venv` and install runner dependencies**:

    ```powershell
    # From repo root. Safe to re-run.
    if (-not (Test-Path .venv\Scripts\python.exe)) { python -m venv .venv }
    .\.venv\Scripts\python.exe -m pip install --upgrade pip
    .\.venv\Scripts\python.exe -m pip install -r evidence\requirements.txt
    .\.venv\Scripts\python.exe -m playwright install chromium
    ```

    ```bash
    # macOS / Linux equivalent
    [ -x .venv/bin/python ] || python3 -m venv .venv
    ./.venv/bin/python -m pip install --upgrade pip
    ./.venv/bin/python -m pip install -r evidence/requirements.txt
    ./.venv/bin/python -m playwright install chromium
    ```

    Do not install the runner packages globally (`pip install --user`); that causes version drift between machines and makes parity scores non-reproducible.

4. **Activate the venv for every subsequent command in this Stage 04 session.**

    ```powershell
    .\.venv\Scripts\Activate.ps1        # Windows PowerShell
    ```

    ```bash
    source .venv/bin/activate            # macOS / Linux
    ```

5. **Verify the runner can import every hard dependency before scoring.**

    ```powershell
    python -c "import numpy, PIL, playwright; from playwright.sync_api import sync_playwright; print('parity runner deps OK')"
    ```

    If that command fails, treat the environment as unready, do not proceed to scoring, and diagnose (missing wheel, corporate proxy blocking pip, disk full). Only fabricate no scores.

#### Anti-gaming reminder

Missing Python is never a valid reason to skip Stage 04 or to fall back to visual inspection. Either bootstrap the environment (steps 1-5) or return `BLOCKED` with evidence in the same turn. Anything else is a stage-level violation.

## Mandatory Parity Runner Invocation

Run from the repository root after Stage 3 deploys the target, with the parity venv activated (see Prerequisites above):

```powershell
python evidence/component_parity.py `
	--source "<SITE_URL>" `
	--target "<AEM_DISABLED_URL>" `
	--target-auth "<user>:<password>" `
	--breakpoints "<comma-separated required breakpoints>" `
	--out "<EVIDENCE_DIR>/component-parity"
```

On the first run, or whenever source evidence is stale/rejected/invalidated, append `--refresh-source`. During ordinary remediation iterations, omit it so the runner reuses frozen source screenshots/manifests and recaptures only the deployed AEM target.

The runner must emit and Stage 04 must consume:

- `component-parity.json` and `component-parity.csv` as the remediation queue;
- source and target full-page screenshots/manifests per breakpoint;
- source/target component crops, labeled side-by-side images, and diff masks;
- source/target pairing confidence and unpaired rows;
- pixel, geometry, and final scores, where final score is the minimum of pixel and geometry scores;
- `PASS` only when the final score is strictly `>92%`; exactly `92.000%` fails.

The runner covers screenshot pairing, geometry, and rendered-pixel scoring. Stage 04 must still execute the property, authorability, media, interaction, author-mode, and component-order gates defined below. Do not override a runner `FAIL`, drop an unpaired row, or substitute a manual score.

## Readiness And Scope

Use real Playwright/Chromium for the frozen source, disabled target, and author target at every required breakpoint. Assert identical CSS viewport, DPR/scale, font readiness, media decode, motion state, and stable geometry before capture. Invalid readiness blocks scoring.

Every source instance maps exactly once to a target owner. Missing, duplicated, orphaned, or structurally combined/split regions fail.

## Component Order Gate

Before issuing any visual score, compare the frozen source instance order with the deployed target order. Emit ordered instance/resource-type lists for the source manifest, checked-in editable-container children, live JCR children, disabled-page component roots, and author-page component roots. Ignore AEM authoring wrappers only when they do not represent authored component instances.

PASS requires exact one-to-one sequence equality across all five lists. Missing, extra, duplicated, split/combined, or out-of-order instances fail this gate. Return to Stage 2, create/reuse or remove the owning component as needed, explicitly reorder checked-in and live content, redeploy, reconcile, and rerun the order gate before screenshot scoring.

## Exact Geometry Gate

For every component root and repeated child instance, collect source and target `getBoundingClientRect()` in the same turn:

| Component/instance | Breakpoint | Source x/w/h | Target x/w/h | Deltas | Full-bleed flags | Status |
|---|---:|---|---|---|---|---|

PASS requires x and width within 1 CSS px, height within 8 CSS px, and matching full-bleed status. A full-bleed source cannot be container-clamped. On failure, fix the owning component/container/grid/XF/template layer, redeploy, and remeasure. After three failed CSS attempts, reassess structure rather than adding hacks.

## Exact Property Gate

Compare raw source and target values for every frozen role:

- all typography metrics, family/style/weight/transform;
- all color properties as exact RGBA (Delta E <=3 only for antialiased/compressed raster pixels);
- backgrounds, borders, radius, opacity, shadow;
- spacing, display/position, flex/grid, overflow, aspect and fit;
- item counts, role order, semantics, attributes, and behavior class.

Section and CTA background/foreground/border/radius mismatches are hard failures. Token declarations and deployed resolved token/role values must all agree.

## Screenshot Gate

At every breakpoint:

1. Use Playwright to navigate one page to the exact live `SITE_URL` and a second page to the deployed AEM disabled URL. Record both final URLs after redirects. A local copy, cached historical image, CSS preview, or authored mock is not a source substitute.
2. In source and target, assert the requested `window.innerWidth`, DPR, `visualViewport.scale`, font/media readiness, and stable homologous component roots; clear hover, trigger lazy loading, freeze animation for static capture, and scroll the roots into equivalent positions.
3. Save full-page source and target screenshots from Playwright in the current run.
4. Save source and target region screenshots for every component instance at identical CSS dimensions and native DPR. Source crop is always the live-site instance; target crop is always the corresponding deployed AEM instance.
5. Produce a labeled side-by-side image with `LIVE SITE` on the left and `AEM` on the right, plus a pixel-diff mask derived from those exact two files.
6. Validate both crops before scoring: non-empty, not mostly uniform/blank, expected component text/media present, matching viewport/DPR, matching homologous instance IDs, and comparable dimensions. Emit URL, timestamp, viewport, DPR, file path, byte size, and content-validation result for each crop.
7. Only after Step 6 passes, record matched pixels, differing pixels, total pixels, and `visualMatchPercent`.

Pixel comparison must use homologous non-blank crops. Reject wrong viewport, empty/mostly background crops, mismatched DPR, stale screenshots, different animation frames, and comparisons dominated by whitespace. Property equality never overrides screenshot failure.

### Score Issuance Gate

- Do not calculate, print, estimate, round, or publish a component score until all required live-site and AEM screenshot artifacts for that component and breakpoint pass screenshot validation.
- Before validation, report `SCORE WITHHELD — INVALID OR MISSING SCREENSHOT EVIDENCE`, never a percentage.
- A component score row must cite the live-site image, AEM image, labeled side-by-side image, diff mask, source/target URLs, viewport, DPR, and pixel counts. Missing any field makes the score invalid and withheld.
- `visualMatchPercent` reflects rendered pixels only after crop validation. The component's final score remains the minimum of visual, property/structure, authorability, and media/interaction results.
- A valid score `<=92%` is `FAIL`; update the owning AEM component layer, deploy, recapture both live and AEM evidence, and recompute. Never mark it passed or reuse the old score.
- A component may be marked `PASS` only when the newly captured valid evidence proves its final score is strictly `>92%` and all prerequisite checks pass.

## Interaction Gate

For every source hover/focus/active/transition role, use real pointer/keyboard events and capture before/after computed styles, nested icon transforms, and screenshots. Compare color, background, border, shadow, opacity, transform, and decoration. Capture one full carousel transition or marquee/ticker animation cycle. Skip hover only when source explicitly gates it off for non-hover input.

### Executable audit (mandatory)

The Interaction Gate is not satisfied by "I added `:hover` rules". Prove parity with a live Playwright measurement in the same turn as the pixel/geometry rescore. Iterate over every row in the Stage 2 `interactive_states_target_matrix`. For each role:

```python
# Pseudo-code the agent runs via Playwright (sync API or run_playwright_code).
for role, selector in interactive_roles.items():
    for state in ("hover", "focus-visible", "active"):
        target_before = computed_styles(target_page, selector)
        target_after  = apply_state(target_page, selector, state)  # page.hover / element.focus / page.keyboard.press("Space")
        source_before = frozen_state(source_manifest, role, "initial")
        source_after  = frozen_state(source_manifest, role, state)
        assert delta(source_before, source_after) == delta(target_before, target_after)   # color/bg/border/shadow/opacity/transform/decoration + nested-child deltas
        capture_side_by_side(role, state)   # into evidence/component-parity/interaction/
```

Before the assertion, disable animation via a measurement-only stylesheet, wait for `transitionend` on the changed property, then read computed styles. Move the pointer off (`page.mouse.move(0, 0)`) between roles so residual hover state does not leak. Persist per-role source/target computed-style pairs, nested-child transforms, and side-by-side screenshots under `evidence/component-parity/interaction/<breakpoint>/<role>-<state>.{png,json}`.

A role fails the gate whenever:

- source has a state change and target has none (silent omission — my typical mistake);
- target has a state change and source has none (invented affordance);
- deltas differ in color, background, border, shadow, opacity, transform, decoration, cursor, or a nested icon transform (arrow slide, chevron rotate, thumbnail scale);
- hover is present but `:focus-visible` is not, or vice versa;
- source `@media (hover: none)` opt-out is unmatched.

Any failing row must be repaired in the same Stage 04 remediation loop as pixel/geometry failures, at the same priority. A page composite cannot report `PASS` while any Interaction-Gate row is `FAIL`.

## Scores And Threshold

Calculate frozen weighted axis scores from `01-source-discovery.md`. Instance score is the weighted sum; component-type score is its minimum instance, not an average. Final component status is the minimum of:

- weighted property/structure score;
- `visualMatchPercent`;
- authorability score;
- media/interaction prerequisites.

Every raw instance, component-type minimum, and page composite must be strictly `>92%`; exactly 92% fails. A high page average cannot hide a failed component or axis.

## Remediation Loop

The current-run parity report is the work queue. Process it without waiting for user approval in this strict order:

1. `unpaired-source` or missing-target rows: return to Stage 2, choose the required reuse tier, implement any missing component contract, add it to the policy, author its content/assets at the frozen `source_order`, deploy, and reconcile live JCR plus disabled/author DOM order.
2. Invalid or missing screenshot/evidence rows: repair capture readiness, selectors/mapping, media decode, viewport/DPR, or crop validation and recapture before calculating a score.
3. Valid `FAIL` rows: sort by final score ascending and repair the lowest score first; break ties by frozen source order.
4. Order-gate failures: reorder the owning checked-in content/JCR/template/XF layer immediately, then rerun disabled and author DOM order assertions.

### Batching And Build Scope

Frequent full-reactor rebuilds are the single biggest tax on this loop. Reduce build count and build scope aggressively:

- **Batch, then build.** Do not rebuild after every isolated CSS or HTL edit. Read the entire current parity report, plan every fix across every failing row that shares an owning layer (tokens, model, HTL, CSS, template, container, asset), edit all of them, then run **one** build+deploy+rescore cycle. A "fix one small thing → rebuild → rescore" cadence is non-compliant. Isolate a fix into its own cycle only when it must be validated before an adjacent change can be reasoned about (for example, a shared token change that would otherwise mask several unrelated failures).
- **Group by owning layer.** For each failing row, name the owning layer once. Group edits that share the same layer/module into a single change set. Deploy each group together. Common groupings: all component-CSS spacing/token tweaks, all HTL/model changes, all authored content deltas, all asset uploads, all template/policy updates.
- **Prefer scoped builds over `mvn clean install`.** Only build the modules whose sources actually changed:
    - Component CSS/HTL/dialog-only change → `mvn install -pl ui.apps -PautoInstallPackage`.
    - Authored content change → `mvn install -pl ui.content -PautoInstallPackage`.
    - Java/Sling-model change → `mvn install -pl core -PautoInstallBundle` (or `-pl ui.apps -PautoInstallPackage` when the OSGi bundle is embedded in the content package).
    - Frontend clientlib source change → `cd ui.frontend && npm run build`, then `mvn install -pl ui.apps -PautoInstallPackage`.
  Use `mvn install -PautoInstallSinglePackage` (full reactor) only when multiple modules changed together, when a new component / clientlib / proxy is introduced for the first time, or when scoped builds visibly under-install. Never use `mvn clean` unless a stale `target/` directory is proven to be causing the failure.
- **Reuse the running SDK.** Rely on the `-PautoInstallPackage` / `-PautoInstallBundle` profiles instead of restarting AEM. Reconcile stale JCR state (merge-mode content packages, dropped properties, out-of-order children) with targeted Sling POSTs rather than reinstalling the full reactor.
- **One cycle contains one build.** Inside a single deploy cycle: (1) plan every fix from the current parity report, (2) edit every file, (3) run one focused scoped build, (4) run one JCR reconcile POST batch, (5) run one `component_parity.py` rescore. Only after the new report is in hand should you plan the next cycle.
- **Batching does not override priority order.** Still process rows in the mandated order (missing/unpaired → invalid evidence → lowest-score FAIL upward). Batch within the same priority band; do not defer higher-priority rows in order to bundle lower-priority ones into the same build.

For each queued component:

1. Keep it FAILED and enumerate screenshot/property gaps.
2. Trace each gap to discovery/content, dialog, model, HTL, CSS/token, container/template, behavior, or asset ownership.
3. Fix the owning layer, run focused validation, deploy, and reconcile live repository/DOM/assets.
4. Recapture source and target in fresh/bypass-cache conditions and rescore only refreshed evidence.
5. Repeat until strictly above 92%. After three failed attempts on one gap, recapture source and redesign the component structure.

Do not stop after producing the report, summarize failures as a future backlog, or ask whether remediation should begin. A report containing any missing/unpaired/invalid/failed row must be followed immediately by implementation and another validation/deploy/capture/score iteration in the same run. After all affected rows pass, execute a full-page, all-component regression sweep at every required breakpoint.

The loop is **autonomous and non-interactive**. Under-threshold scores, missing per-breakpoint captures, incomplete side-by-side/diff artifacts, and residual property/geometry/interaction gaps are never grounds for pausing or asking the user whether to continue. Do not end the turn with a proposal, a question, an offer to iterate, or a request for approval while any component, axis, or breakpoint is still below `>92%` and remediation options remain. The only permitted exits are:

- every raw instance, component-type minimum, and page composite is strictly `>92%` at every required breakpoint, with valid current-turn Playwright evidence for each row; **or**
- a genuinely external blocker is proven in the same turn (unreadable source URL after retry, local AEM unavailable, unrecoverable build/deploy failure, expired credentials, or an unavoidable licensing constraint) and reported as `BLOCKED` with concrete evidence.

Running out of ideas, hitting the same failing gap repeatedly, or feeling that further iteration will not converge are **not** external blockers. When one remediation angle stops improving a component, switch angles (structure, token, asset acquisition, template, container, dialog, model) and continue.

## Anti-Gaming Rules

- A score above 90 requires raw source/target evidence and valid screenshots.
- Missing/broken/un-authored assets, semantic-role substitutions, wrong full-bleed zones, incorrect body font, and missing interactions apply their prescribed hard failures/caps.
- Do not score a hand-picked subset of properties, blank crops, whitespace, authored CSS declarations without computed evidence, or stale captures.
- **Hardcoded business content never contributes to a passing row.** If a visible string, URL, image, video, logo, poster, or icon that a business author would legitimately change is served from HTL literals, Sling-model defaults, CSS `url(...)`, `::before content:"..."`, or `apps/.../clientlibs/.../resources/**` instead of a dialog-driven DAM/pathfield binding, the affected instance FAILs regardless of pixel score. Repair via Stage 2 (add the field), Stage 3 (move the asset to `/content/dam/<site>/<locale>/...` and rebuild), and Sling POST reconciliation — not by tuning CSS in Stage 4.
- User rejection invalidates prior affected scores and evidence.

## Required Stage Result

Return the orchestrator's required `stage_result` envelope with:

```yaml
stage_result:
	stage: 04-visual-parity
	run_id: <same run_id>
	status: PASS|FAIL|BLOCKED
	inputs_consumed: [01-source-discovery:<result-id>, 02-component-authoring:<result-id>, 03-assets-runtime:<result-id>]
	outputs:
		readiness_matrix: <artifact>
		geometry_property_interaction_tables: <artifacts>
		screenshot_and_diff_index: <artifact>
		per_instance_scores: <artifact>
		component_minima_and_page_composites: <artifact>
		remediation_history: <artifact>
	checks:
		- {name: all_source_blocks_mapped_once, status: PASS|FAIL, evidence: <artifact>}
		- {name: source_checkedin_jcr_disabled_author_order_equal, status: PASS|FAIL, evidence: <ordered instance/resource-type lists>}
		- {name: all_geometry_and_properties_pass, status: PASS|FAIL, evidence: <artifact>}
		- {name: all_live_and_aem_screenshot_pairs_valid, status: PASS|FAIL, evidence: <artifact>}
		- {name: all_screenshot_scores_above_92, status: PASS|FAIL, evidence: <artifact>}
		- {name: all_interactions_and_media_pass, status: PASS|FAIL, evidence: <per-role source vs target hover/focus/active/transition computed-style deltas + side-by-side screenshots under evidence/component-parity/interaction/>}
		- {name: all_final_minima_and_composites_above_92, status: PASS|FAIL, evidence: <artifact>}
	failures: []
	next_stage: 05-completion-output
```

Do not return `PASS` for partial breakpoints, selected components, invalid/blank crops, missing artifacts, exactly 92%, or averaged-away failures. Remediate and rerun this stage until it passes.
