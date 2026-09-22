# AEM Migration Agents

A config-driven multi-agent pipeline that migrates a live web page into authorable
AEM as a Cloud Service components and gates delivery on measured visual parity.

Everything the pipeline needs lives in this folder, next to the prompt contract it
reads.

## Quick start

With Python 3.10+, Node.js 20+ (including npm), a JDK, Maven and Copilot CLI available, run
the normal migration command. No separate npm or browser-install command is needed:

```powershell
python design/site-url/scripts/run_migration.py --url https://example.com/page
```

The launcher always enters its isolated project virtual environment and verifies
the exact versions in [requirements.txt](requirements.txt), rather than using global
Python packages. It creates the environment and installs or repairs dependencies
as needed. Normal migration preflight checks Node, environment-selected Java and Maven,
then prepares the shared Node/browser runtime before starting any agents:

1. Read [tools/package.json](tools/package.json) and [tools/package-lock.json](tools/package-lock.json).
2. Run a locked `npm ci --ignore-scripts` when dependencies are missing, inconsistent,
  or the package/lockfile fingerprint changed. A successful installation is stamped
  inside `tools/node_modules`; unchanged installations are reused.
3. Try a headless browser launch. If the matching executable is missing, install
  Chromium into the shared cache once, then verify the launch again. An executable
  rejected with `EFTYPE` and missing Playwright's installation-complete marker is
  treated as an interrupted download and repaired using Playwright's own installer.
4. Continue to the planner only after setup and verification pass.

Playwright, Pixelmatch and pngjs remain one pinned project package. The current
Playwright pin is 1.63.0, which uses Chromium headless-shell revision 1243. Missing
downloads require network/proxy access, so a cold first run can take longer; warm
runs skip installation. System Node.js and operating-system libraries are prerequisites,
not installed with elevation by this launcher.

Use `--no-bootstrap` or `AEM_AGENTS_SKIP_BOOTSTRAP=1` to disable automatic Python,
Node-package and browser installation. In that mode existing dependencies are checked
and missing dependencies fail with manual setup hints. `--dry-run` and `--show-plan`
never run Node/browser setup. Other browser launch failures (for example a rejected
complete installation or a missing system library) are reported without reinstall loops.
Browser preflight has no process, launch or rendering timeout. It prints its current
phase while waiting; press Ctrl+C to cancel. The former
`parity.browser_check_timeout_seconds` setting is no longer used.

### Shared Playwright runtime

The package is in `design/site-url/scripts/tools`, not in each evidence directory.
Browser binaries default to `design/site-url/scripts/.tools/ms-playwright`, shared
by all runs in this repository. Both paths are configured in
[config/migration.yaml](config/migration.yaml). The old `.tools/browser` package is
no longer used by the Python agents; existing files there are left untouched.

To share browser binaries across repositories on Windows, set the environment
variable before running the launcher:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA 'ms-playwright'
python design/site-url/scripts/run_migration.py --url https://example.com/page
```

An absolute `PLAYWRIGHT_BROWSERS_PATH` overrides the configured cache path. Different
Playwright versions may require different browser revisions in that cache. A global
`npm install -g playwright` is neither necessary nor sufficient: evidence scripts
must import the pinned project module rather than rely on global Node resolution.

The coordinator exports `MIGRATION_BROWSER_MODULE` as an absolute file URL and
preserves it for isolated workers. Planner/parity capture scripts use:

```javascript
const { chromium } = await import(process.env.MIGRATION_BROWSER_MODULE);
const browser = await chromium.launch({ headless: true });
```

This works from an evidence directory without a local `node_modules` or `NODE_PATH`.
Agent prompts still prohibit package/browser installs and cache/lock deletion;
setup belongs to the launcher, not the planner LLM. These are agent instructions,
not an OS sandbox. Automatic setup holds a separate setup lock and refuses an existing browser-installer
lock when a download is needed; inspect the installer before clearing a confirmed
stale lock. Package setup and the browser download installer retain five-minute
deadlines, with a 30-second download connection timeout. The browser setup wrapper
has no outer deadline because it also verifies the browser. Timeout or cancellation
cleans up only the setup process tree. Failed
installs are not marked ready. No setup step requests elevation or deletes locks.

A standalone check never downloads anything:

```powershell
npm --prefix design/site-url/scripts/tools run browser:check
```

```powershell
# 1. credentials for this session - never commit them
$env:AEM_CREDENTIALS = 'admin:admin'                                         # Windows
export AEM_CREDENTIALS='admin:admin'                                         # macOS / Linux

# 2. run it
python design/site-url/scripts/run_migration.py --url https://example.com/page
```

On the first launch you will see:

```
First run: preparing the Python environment for run_migration.py.
  creating virtual environment at .../design/site-url/scripts/.venv
  installing dependencies from requirements.txt
  running in .../design/site-url/scripts/.venv
```

It re-launches Python with `-I` and excludes user-site packages and inherited
`PYTHONPATH`, `PYTHONHOME` and `PYTHONUSERBASE`. Later runs reuse the environment and
verify exact installed versions. Pip runs only for missing/mismatched dependencies
or changed requirements. PyYAML 6.0.3 and Pillow 12.3.0 are pinned; binary wheels avoid
requiring a local C compiler. If a supported wheel is unavailable for the selected
Python/OS combination, setup fails rather than silently using a different version.
`--no-bootstrap` permits a self-managed environment but still checks exact versions.

### Running on another machine

Clone the repository, including the manifests and lockfiles. Do not copy `.venv`,
`node_modules`, browser binaries or another run's evidence between operating systems.
Run the same launcher command; its folders and executables are resolved locally.
On systems where the executable is named `python3`, substitute `python3` for `python`.

| Dependency | How it is provided |
|---|---|
| Python interpreter with `venv`/pip support | Host prerequisite; a Python command cannot install the interpreter needed to start itself. |
| PyYAML and Pillow | Installed automatically in `scripts/.venv` at the exact committed versions. |
| Node.js 20+ and npm | Host prerequisite, version checked before Node-package setup. |
| Playwright, Pixelmatch and pngjs | Installed automatically from the shared npm lockfile. |
| Matching Chromium and its bundled support binaries | Installed automatically into the configured platform-specific browser cache. |
| JDK | Host prerequisite; use the JDK selected by `JAVA_HOME` or `PATH`, without requiring a particular major version. Both `java` and `javac` must be present. |
| Apache Maven | Host prerequisite; startup is verified with the selected JDK before agents run. |
| Copilot CLI and authentication | Host prerequisite; install a compatible CLI and authenticate on that machine. Credentials are not copied or generated by bootstrap. |
| AEM instance and credentials | External prerequisite; set `AEM_HOST`, `AEM_PORT` and `AEM_CREDENTIALS` for that target. Defaults refer to a local SDK, not production. |
| Linux browser shared libraries and fonts | OS prerequisites; bootstrap never invokes sudo or an elevation prompt. |

Local JDK selection follows `toolchain.java_home` when explicitly configured, then a
valid `JAVA_HOME`, then the JDK containing `javac` on `PATH`. If those are unavailable,
the configured installed-JDK locations are searched. An invalid `JAVA_HOME` does not
block a valid JDK on `PATH`. The launcher does not install Java or change your user
environment; it passes the resolved JDK to child processes. Cloud Manager's
[Java setting](../../../.cloudmanager/java-version) is unchanged and does not constrain
this local selection. Maven/plugins/project dependencies can still reject a JDK that
cannot build the project; selecting a JDK does not certify build compatibility.

Project dependency versions and setup behavior are reproducible, but native Windows,
macOS and Linux are not identical environments. Browser fonts/rasterization, CPU
architecture, Python/Node/JDK patch versions, live content and model responses can
still differ. Use the same provisioned container/CI image, toolchain versions, fonts
and AEM target when identical execution environments are required. The current
bootstrap does not silently install those system runtimes or promise identical AI
output. Windows is the locally verified platform; macOS/Linux still require native
smoke testing before claiming support for a particular OS/runtime combination.

### Optional: check the external tooling too

The launcher handles Python and shared Node/browser dependencies automatically.
`setup.ps1` / `setup.sh` are optional checks for Node.js, Copilot CLI, Maven, Java
and AEM author availability:

```powershell
powershell -File design/site-url/scripts/setup.ps1                           # Windows
bash design/site-url/scripts/setup.sh                                        # macOS / Linux
```

### Verify before spending credits

```powershell
python design/site-url/scripts/run_migration.py --show-plan
python design/site-url/scripts/run_migration.py --dry-run
```

These commands do not invoke Copilot, Java, Node scoring, or AEM. A dry run renders
every role prompt and writes a `DRY_RUN` record; it cannot be resumed as a real run.

Or from inside this folder:

```powershell
cd design/site-url/scripts
python run_migration.py --url https://example.com/page
```

Both work — the launcher locates the repository root itself, so the working
directory does not matter.

Common variations:

```powershell
# use the SITE_URL fallback in prompt_new.md instead of passing one
python run_migration.py

# author into a specific AEM page, one component agent at a time
python run_migration.py --url https://example.com/page --target-path /content/demo-ai-site/us/en/my-page --max-parallel 1

# manage the environment yourself; fail instead of creating a venv
python run_migration.py --show-plan --no-bootstrap
```

### Environment variables the bootstrap honours

| Variable | Effect |
|---|---|
| `AEM_AGENTS_VENV` | Use this path for the virtual environment instead of `scripts/.venv`. |
| `AEM_AGENTS_SKIP_BOOTSTRAP` | Same as `--no-bootstrap`; disable automatic Python, Node-package and browser setup. |

## How it works

### Common failure recovery

Component and planner-shared workers may accidentally create root-level text dumps.
The coordinator quarantines only newly added, non-hidden root `.txt` files that decode
as UTF-8 or BOM-marked UTF-16, contain no binary control characters, and fit within
2 MiB per file / 8 MiB per collection. These are retained under the invocation's
`validation/worker-diagnostics`, with source names, hashes and sizes in the result.
They are not merged or deployed. Every other unowned change must pass the existing
ownership rules: existing files, nested files, source/config files and mixed violations
are still rejected. Read-only planning/diagnosis does not get this cleanup allowance.
Workers must still write diagnostics directly under `MIGRATION_VALIDATION_DIR`.

When serialized CLI arguments reach 30,000 UTF-16 code units, the launcher stores the
entire prompt in `request-prompt.md` and sends a short instruction to read that file
in full. `prompt-transport.json` records its hash, byte length and argument sizes.
This avoids Windows error 206 without truncating the prompt, reducing acceptance
requirements or changing model/permission settings. This is a file-reference prompt,
not an undocumented native CLI prompt-file option; the model must read it using tools.

Recoverable failures no longer exhaust a shared page-wide loop. The coordinator
persists a phase cursor, accepted component attempts, diagnostic history and counters
per failing phase/owner. Component and shared-file defects return to their existing
LLM owners with the actual failure evidence. Unmapped failures, frontend builds,
asset outages, preflight issues and failed reporting writes can invoke the planner's
new **read-only diagnostic mode**. It returns only retry, scoped repair or pause;
Python validates owners and evidence before acting. No new top-level agent role is added.

Validated discovery is reused when planning itself needs correction. Successful
components, cached asset bytes and unchanged frontend build receipts remain reusable.
When only a component's authored contribution is invalid, its otherwise valid result
metadata and ownership-checked source diff are retained as an unaccepted candidate.
The coordinator records a hashed `contribution-candidate.json` receipt with source
and evidence fingerprints; it does not merge that source on a failed attempt.
The existing component agent's `contribution_repair` mode starts from a copy of that
candidate, uses a short contribution-only prompt, and skips full discovery handoff,
implementation and build work. Previous attempt artifacts are not overwritten.
Source additions, edits and deletions during this mode, changed candidate evidence,
or intervening edits to affected main-checkout files are rejected. The coordinator
reruns component acceptance after the contribution repair before applying any source.

For example, a footer can have valid XF nodes but an empty separate page entry.
The diagnostic identifies the specific `pages[index]` and target. The repair must
provide the required page/XF nodes, not rebuild the dialog or model, drop a required
target or invent a duplicate footer. A plan/template conflict that cannot be fixed
within contribution-only scope must be reported as BLOCKED. This mode retains the
existing retry budgets and all downstream asset, merge, deploy and parity gates.
It is a restricted invocation of the same component role, not a new agent or a
guarantee that all failure types can be repaired without source changes.

Retries run the failed operation; source repairs re-enter assets/merge/build/deploy/
parity as required. All required gates still apply. Resuming a paused parity check
revalidates deployment first; a report-only I/O pause can regenerate the report from
the validated run without rebuilding or claiming a new live verification.

The default limit comes from `max_attempts_per_component`, now scoped to the failing
phase and owner, with `pipeline.recovery.repeated_failure_limit` bounding repeated
identical failures. A pause remains BLOCKED, not COMPLETE. Plain resume does not reset
budgets. To explicitly authorize one further attempt for the last paused operation:

```powershell
python design/site-url/scripts/run_migration.py --resume --run-id YOUR_RUN_ID --retry-recovery
```

This records an approval and retains counters/history; it does not relax validation
or permit unlimited automatic model calls. Use plain `--resume` for a restored
external prerequisite. Source/config/evidence fingerprints must still match. Old
runs from before this workflow change are not converted or given new counters.
Ownership violations, corrupted evidence and unsafe conflicts remain hard failures.
Diagnosis uses copied sources and post-run guards, not an OS sandbox. If the backend
or persistent storage is unavailable, model-assisted diagnosis may itself be unavailable.

### Asset recovery and inline SVGs

The collector saves visible static inline SVGs under each breakpoint's discovery
directory and registers their hashes in the discovery manifest. The LLM copies
`source_file`, `sha256` and a `.svg` `dam_path` into an asset declaration instead of
inventing a `source_url`. Python validates containment, manifest membership, checksum
and a restricted static SVG vocabulary, then uploads those bytes to DAM without a
download. Inherited paint colors are captured. Text, scripts, foreign content,
animation, external references and unsupported effects are not silently converted
or accepted. No SVG is injected as untrusted HTML into a component template.

Successful inline SVG exports are listed directly in authoring tasks as
`captured_assets`, with their breakpoint, selector, source JSON pointer, source_file
and sha256. An empty planner assets list or empty svg_recoveries list does not mean
those exports are missing. Use the captured SVG directly with its DAM destination;
do not add recovery fields. Recovery declarations instead require a supplied
discovery recovery JSON and a derived SVG inside the owning invocation. Mixing
these two forms remains rejected by the evidence-provenance checks.

Pure 2D CSS translations of the outer SVG position the element on the page; they
are retained in layout observations, not baked into the exported vector artwork.
Child transforms, rotations, scaling and other unsupported effects still require
recovery. This avoids shifting or clipping artwork twice when matching an
element-relative reference screenshot.

When automatic SVG export fails, discovery preserves the original markup,
paint-resolved candidate, unsupported computed styles and a reference screenshot
as checksummed `inline-svg-recovery` artifacts. The planner gets an indexed recovery
list; the existing component LLM gets only failures inside its source roots. It may
write a derived SVG under its own invocation and declare `recovery_source` and
`recovery_sha256` alongside the derivative's `source_file`, `sha256` and `dam_path`.
It must preserve original vector geometry and the viewBox, never redraw the logo.
The coordinator checks source provenance, worker containment and static SVG safety,
then uses the shared browser without network access and requires at least 0.99
pixel similarity to the reference. Matching validations are reused in-process;
final page parity still runs separately. A missing required recovery or a visual
mismatch returns component repair feedback rather than silently dropping the logo.
Animations and missing/unrecoverable source evidence are not certified. No new LLM
role is created, and the component agent still does not recapture the live site.

Malformed declarations fail component acceptance and return owner-specific repair
feedback. Temporary network failures and HTTP 408/425/429/500/502/503/504 get up to
`assets.transfer_attempts` local attempts (default 3) with exponential delay starting
at `assets.retry_delay_seconds` (default 1). Expired CSRF tokens refresh once per
write. Authentication errors and missing remote resources do not retry blindly.
Other declared assets continue processing even when one transfer is unavailable.

Successful downloads are cached under the run's asset staging directory and verified
by checksum before reuse. An existing DAM asset is reused only when its bytes match;
different existing bytes are a critical conflict and are never overwritten. This
cache is independent of Maven builds and component invocation budgets.

If required media remains unavailable, the run pauses as **BLOCKED**, not FAIL. Its
accepted plan, foundations, components and downloaded bytes are preserved. Merge,
build, deploy and parity do not run against incomplete media. After restoring asset
availability, use `python design/site-url/scripts/run_migration.py --resume --run-id YOUR_RUN_ID`.
An asset pause resumes the same pipeline round, even at the last allowed round,
without invoking accepted component builders again. It does not reset repair budgets.
Unsafe paths, evidence tampering, incompatible declarations and DAM byte conflicts
remain hard failures. Required assets are never silently dropped or counted as PASS.

Resume still requires unchanged source/configuration and intact checkpoints. These
workflow changes require a fresh run for older evidence, including runs whose repair
budget was already exhausted; existing generated application sources remain reusable
by the planner. No old run state or counter is rewritten by this change.

```text
Python + pinned collector: source evidence and cached repository inventory
  -> Planner (read-only): coverage, reuse, ownership, dependencies, measured token specification
  -> Python: compact, lossless shared-work handoff and source/policy inspection
  -> Planner (shared mode): tokens/styles/policies, validated and applied before component work
  -> Component authoring mode: one read-only session per source-ready group, across tiers
  -> Component builders: isolated source edits for new/extended components and source repairs
  -> Coordinator: validate actual diffs and apply owned changes
  -> Assets: deterministic downloads and DAM upload
  -> Merge: deterministic page/XF contributions and Vault filters
  -> Coordinator: serialized frontend build and verified clientlib application
  -> Deployment worker: configured builds, tests, scoped deployment and runtime checks (no LLM)
  -> Fixed Playwright collector: fresh component/state/page captures and measured checks (no LLM)
  -> Pinned scorer: independent pixels, composites and hash receipts
  -> Orchestrator: deterministic completion report from persisted evidence

Failed gates -> bounded repairs of owners and affected dependents
```

| Agent | Role |
|---|---|
| `planner` | Planning mode emits coverage, the component plan and measured tokens without source edits. Planned selectors must resolve in frozen discovery before plan acceptance. Shared mode then establishes tokens, styles and policies in isolation. |
| `component` | Groups source-ready authoring across all tiers in one read-only session per dependency wave; source implementation and repairs use individual builders. Every component retains its own contribution, result and validation gates. |
| `deployer` | Deterministic worker: executes configured checks and scoped Maven deployments, verifies live evidence, and returns owner-scoped repair diagnostics. No LLM invocation. |
| `parity` | Coordinator-run collector/validator, not an LLM invocation. Captures and checks styles, fonts, geometry, media and supported interaction states; Python owns acceptance. |

There are two LLM roles (planner and component), plus deterministic deployment and parity phases. The planner has planning, shared-file and read-only diagnosis prompts, with
separate invocations/results so accepted planning is not repeated. The order is strictly
`plan -> foundations -> implement`: failed planning prevents foundations work,
and failed foundations prevents every component worker from starting. Shared
changes are validated and applied before component snapshots are created.
The `foundations` phase is now assigned to `planner` with `mode: shared`; there is
no separate foundations agent. Initial shared output uses `planner-shared`, and
repairs use `planner-shared-repair-attempt-N` without recollecting source or changing
the accepted plan. Both modes retain their own required checks and ownership.

### Hybrid component execution

With `fanout.batch_reuse: true` (the default), source-ready authoring tasks from
any reuse tier share the existing component role's compact `reuse` prompt and one source snapshot. Full
task specifications and exact discovery packets live in indexed evidence files,
not repeated full builder prompts. Plans select `execution_mode: authoring` for
content-only work or `execution_mode: implementation` for pending source changes.
The mode is independent of the tier: project extensions, Core Component extensions
and new components can enter authoring once their required implementation is available.
Missing or incomplete source still requires implementation; selecting authoring does
not waive component/runtime validation. When the field is omitted, compatibility
defaults are authoring for Tier 1 and implementation for Tiers 2-4.
Components requiring source implementation
then use individual workers up to `fanout.max_parallel`. Dependency waves remain
barriers; a component is never authored before its required predecessors pass.

Reuse authoring cannot edit repository sources. Each member writes its own result
as it finishes; the coordinator independently checks those results and retains
completed members even after a session interruption or transport failure. One
failed member cannot certify or discard the others. Authoring-only retry feedback
can select this path for any tier; source-repair feedback overrides the planned mode.
An evidence-backed
`implementation_required` failure routes that component to a source-repair worker;
ordinary authoring failures remain in the reuse path. The separate contribution-only
candidate-repair mode is unchanged. No new top-level agent is introduced.

Each authoring task includes a `BLOCKED` result_template with the exact planned
instance IDs, canonical focused_test.command field, required checks, and empty
fields to complete from evidence. The template is not a passing result. Parity
targets use rendered AEM selectors; explicit roles are objects with relative
source_selector/target_selector pairs, not string labels. Invalid instances and
roles report the component and field index; focused_test.argv is rejected before
acceptance instead of reaching deployment.

The CLI completion message says coordinator validation is pending. The coordinator
then persists the batch verdict and member_statuses after member validation; its
proposal_status retains the agent's original verdict. Rejected member and batch
envelopes are preserved for diagnosis. A failure before visual comparison is
reported as parity NOT RUN, not a failed visual score, and residual gaps use the
latest component failure rather than an earlier repair's diagnostic.

LLM workers must not install frontend dependencies, compile Sass/webpack or run
the code-assessment analyzer. They use lightweight available structural checks
and declare focused tests. Shared frontend builds and deterministic deployment
checks still run on merged source before deployment. The source guard is not an
OS sandbox; tool restrictions here also depend on worker instruction compliance.

This reduces session/setup duplication, not the acceptance requirements. All
components still must pass before page merge/deployment, and live parity is still
required. It does not fix external model transport latency or impose new timeouts.
Set `fanout.batch_reuse: false` before a fresh run to use per-component builders for
all tiers. Saved runs require unchanged configuration and source fingerprints.

### Deterministic deployment

The `DeployerAgent` class and `deployer-attempt-N` result names remain for pipeline
compatibility, but deployment never calls the model backend. The worker selects
configured `deploy.scoped` commands, deduplicates them and orders selected scopes
by `depends_on`. Missing scopes and dependency cycles fail before commands run.
The existing full-reactor command is retained for two evidenced cases: new Maven
artifacts/internal dependencies measured against the accepted planner's original
source snapshot, or actual live repository differences after successful scoped
installs. Changing several modules alone is not sufficient. Each fallback records
its justification and runs the full runtime checks again; at most one fallback is
made per deployment attempt. Unknown non-Maven paths never authorize a reactor.
`deploy.full.verify_modules` identifies the installed aggregate package to verify,
not every build-only module selected by the reactor command.

After the coordinator's frontend build, the worker performs configured target
hygiene, compile/HTL validation, component-reported focused tests and OOTB code
assessment for changed Java/OSGi/Maven files. Focused tests are deduplicated by
command and working directory, with isolated source paths relocated to the merged
checkout. Maven method selectors and non-Maven test commands are preserved; missing
commands are reported to their component owner, never replaced by `-Dtest=*`.
Declared DAM availability is checked before any package installation.
The analyzer is compiled under the
validation directory without modifying its OOTB sources. Its checkout-root
`.autofix/` reports remain excluded from source changes and deployment packages.
Silent successful commands receive an explicit exit-code log receipt.

Maven deployments run sequentially. Read-only checks verify current-attempt
package installation timestamps, the expected active core bundle version,
typed FileVault properties, child order/cardinality and deployed application-file
bytes. Fixed Playwright checks cover disabled and author content-frame pages at
all required breakpoints, mapped component instances, shared styles/tokens,
visible media and declared DAM images. Component `runtime_contract.model_probes`
identify model-bound HTL expressions or existing exporters, authored resources and
expected model-derived values. Fresh HTL probe requests disable JavaScript; exporter
probes check nested JSON values and array order/cardinality. Child models can use
`via_model` when the owned parent references that child class. Every known model
needs a probe; an active bundle and an arbitrary nonempty page do not prove adaptation.
`runtime_contract.clientlibs` maps owned library definitions to exact CSS/JS requests.
Embedding relationships are checked against source definitions, and browser checks
accept AEM cache-busted/minified request forms while rejecting missing libraries.
Components without a usable existing HTL/exporter probe must report the missing
capability; the pipeline does not add diagnostic servlets, change APIs or invent
passing evidence. These probes establish the declared model outputs, not arbitrary
unexercised getter behavior. Visual equivalence remains the separate
parity gate. The AEM account needs access to Package Manager metadata, repository
JSON and the bundle console; unavailable access is a prerequisite, not a pass.

Source defects are routed to the component owner and affected dependents; shared
defects go to planner shared mode. Asset-only failures retry asset handling without
rerunning component builders. Missing executables/authentication or unavailable
AEM produce `BLOCKED`; unmapped failures retry deployment within the existing
attempt budget without triggering blind source repair. Every repaired attempt
repeats deployment and runtime checks. Invalid/unknown reported owners still fail.
The worker never edits application source and records `deployment_model_calls: 0`.

These are the existing local-SDK Maven deployments, not a replacement for Cloud
Manager production pipelines. Start a fresh run after updating this workflow;
old checkpoint fingerprints are not migrated. Automated fixture tests do not
establish live AEM compatibility; no AEM deployment is performed by the test suite.

### Compact shared inputs

Before planner shared mode starts, Python creates an invocation-local `handoff/`
under evidence. It preserves the complete accepted plan and measured tokens,
precomputes category/classification counts, and provides bounded token/component
projections, exact existing policy allow-lists and source/build-file snapshots.
Unknown fields, provenance, component notes and all original measurements remain
available through documented JSON pointers; missing data is never invented.

Packets are at most 8 KB. A single oversized record is preserved in its own file
and referenced explicitly for field queries/ranged reads. The small index explains
schemas and paths, avoiding repeated schema inspection and whole-file reads that
exceed tool limits. Independent reads and validations are batched. The model copies
the full components array programmatically rather than regenerating it in its response.
Exact plan equality, evidence validation, source ownership and deployment/parity
gates remain unchanged. Prepared artifacts are integrity-checked and checkpointed.
Post-edit checks must use actual edited source, not the pre-edit handoff snapshots.

This reduces duplicated prompt context and mechanical model work; live response
times still depend on the model and tooling. No tool-call cap or new timeout is added.

### Component context and run-local cache

Each component invocation receives a `discovery-inputs/index.json` beside its
result. Python selects its planned selectors and captured descendants at the
applicable breakpoints, then writes bounded node/media packets. Component names
and counts come from the accepted plan for the supplied site URL; breakpoints come
from the run contract. This optimization has no site-specific component list,
expected component count or fixed breakpoint set.

The planner checks every planned source root at every applicable breakpoint before
accepting the plan. A missing mapping or missing root fails with component ID,
breakpoint and selector, instead of launching a worker with an empty handoff.
The same check runs when inputs are prepared; missing evidence is never inferred
from selector prefixes or silently treated as unchanged reuse.

Every captured field is preserved, including exact copy, attributes, styles,
hidden states and unknown fields. Oversized records use the same full-record
references as the shared handoff. Original source paths and JSON pointers remain
available; the worker must report missing evidence rather than infer it. Prompts
direct workers to these files instead of recursively searching the
evidence/workspaces tree. Scoped searches within the worker's own source modules
remain permitted.

Parsing and selector-parent indexes share a process-local LRU cache, capped at
a bounded number of file versions to control memory use. This is not a limit on
components or breakpoints: evicted files are parsed again when needed. Keys are
absolute evidence paths plus SHA-256 content hashes, so different runs cannot
reuse each other's entries. Lookups still hash files; this saves JSON parsing and
indexing, not all disk I/O. Concurrent workers share one parse per cached version.
Changes invalidate entries even when size and timestamp are unchanged. The cache
is not persisted across process restarts.

Packets remain invocation-local, are hash-checked before accepting the result,
and join existing checkpoint protection through `outputs.handoff_artifacts`.
`outputs.handoff_metrics` records full/selected record counts, input/prepared
bytes, packet count, preparation seconds and parse-cache hits/misses. Preparation
counts and timing also appear in the coordinator log. No model response, build,
deployment or parity verdict is cached by this feature; existing gates still run.

Use each run's handoff metrics to measure context reduction and cache reuse;
results depend on the supplied site's content and plan. These metrics measure
input preparation, not end-to-end migration or LLM speedups. Start a fresh
migration after updating these scripts/prompts because existing checkpoints
fingerprint source files; old evidence is not rewritten.

### Model-free comparison and selective repair

Component results provide `parity_targets` for every planned source instance, with
rendered root selectors and optional breakpoint/mode overrides. Ambiguous descendant
roles can be mapped explicitly; automatic matching never omits unmatched source roles.
The fixed collector [tools/parity.mjs](tools/parity.mjs) navigates the live source
and AEM, measures them, and captures each component at each breakpoint in disabled
and author modes. Author content is measured through the validated author content
frame URL, not including the editor toolbar.

Exact font family/size/weight/style, rendered font identity, text/line boxes, colors,
background color, margins, padding and gaps are hard checks. Geometry is measured
with the configured pixel tolerances. Fonts must be ready; image/video readiness and
media attributes must agree. Identical screenshots cannot override a failed style
or readiness measurement. Python validates measured values, not agent-written PASS labels.

Hover/focus on visible non-header controls is automatic. Safe declared click states
are tested using control/state selectors. Instance, interaction-state and full-page
PNGs are compared with pinned pixelmatch and get side-by-side/diff artifacts. Every
applicable capture must pass the canonical `visual_pass_ratio`; the current editable
contract is authoritative. Unequal component crops get an explicitly unscored,
native-size side-by-side preview for diagnosis; originals are never resized or
padded for scoring. Pixelmatch tolerates anti-aliasing, while computed style
equality does not. A 99% pixel target can be configured, but is not substituted for
the value in the contract. Lowering it does not relax exact style gates.

Only failed components and dependency-affected components enter LLM repair. Shared
layout failures go to planner shared mode; shared-only changes do not rerun every
component model. Failure prompts contain measured deltas and references to source,
AEM, side-by-side and diff files, with full measurements linked separately. After
repair/deployment the complete page is recaptured to catch regressions. Comparison
itself records `comparison_model_calls: 0`. Only planning, shared-source work and
component implementation/repair use LLM roles; deployment is deterministic.

Unsupported or missing mappings and cross-origin embeds fail rather than silently
passing. The collector does not yet certify arbitrary business interactions, form
submissions or every animation-cycle state; those require additional fixed probes.
Navigation and form-submission clicks are rejected. Component authorability checks
and deployment tests remain separate. Live AEM visual equivalence is not implied by
the offline/local-browser tests.

The `report` phase is a deterministic orchestrator handler, not an agent invocation.
It writes `completion-report.md` and `report-result.json` from persisted state,
including failures before preflight completes and explicitly unverified dry runs.
The report includes score tables, recorded screenshot minima, component and deploy
ledgers, evidence references and residual gaps. Missing qualitative data is left
unreported; numeric screenshot scores require a matching current-run scorer receipt.
Invalid or unverified scores are withheld. Report generation cannot upgrade failed
gates to completion, and a report-write failure prevents completion.

## Progress logging

Both planner modes and component workers report concise milestones as they work. Examples:

```text
[planner 00:30] reported: Section 2/8: Hero | Planning | Checking existing component reuse
[planner-shared 02:40] reported: Typography | Shared styles | Adding measured font tokens
[component-hero-attempt-1 00:12] reported: hero | Dialog | Adding authored image and title fields
[component-hero-attempt-1 01:05] reported: hero | Tests | Running focused model tests
```

Every line includes the worker identity and elapsed invocation time. The planner
reports section counts only once it has established its candidate list; counts
are not a time estimate. Component workers report only the development steps their
component needs. The `reported:` label distinguishes agent activity from accepted
results: milestones never change checks, completion status or the remediation budget.

After the plan passes, console and orchestrator logs show the target page/source,
accepted component-definition count, scheduled worker count, reuse/extend/new
breakdown and component IDs in source order, before shared-file work starts.
The count is definitions, not page instances, and not every definition is new code.
Dry-run placeholder plans are explicitly labeled; failed plans are not announced
as accepted. A compatible resume logs the accepted plan again without replanning.

Progress does not depend solely on the model following the milestone format.
The coordinator also displays real `tool.execution_start` and
`tool.execution_complete` events in normal mode:

```text
[planner 02:15] activity: Started | Verify all fonts ready at each breakpoint
[planner 02:17] activity: Finished | Verify all fonts ready at each breakpoint | 2s | 12 tool calls completed
```

Only the tool description or short filename is shown, never raw command/result
payloads. `Finished` means the tool reported success, not that the component or
pipeline passed validation. Duplicate tool events are suppressed per invocation.
Null section counters are treated as unknown, with no fabricated count or percentage.

After 45 seconds without a displayed update, `Still running` identifies active
tools and their duration, a pending model response, or the last observed/reported
activity. `No milestone reported yet` appears only when none of that information
has arrived. Partial output and reasoning events are not presented as milestones.
A heartbeat confirms monitoring, not completion or forward progress.

Technical tool-request details remain under `--verbose`. Activity and waiting
notices are written to the existing run log; raw stream events are flushed as
they arrive for live inspection. No new agent or prompt file is involved.
Already-running Python processes keep their loaded logger until they exit; editing
these files does not hot-reload an active migration.

## Runtime deadlines

Overall runtime deadlines are disabled by default for all four agents and source
discovery. In [config/agents.yaml](config/agents.yaml), `defaults.timeout_seconds`
is `null`, with no per-role overrides. In
[config/migration.yaml](config/migration.yaml), `discovery.page_timeout_seconds`
is also `null`; this disables both the Node per-breakpoint deadline and Python's
outer collector deadline. `0` is accepted as an alternative to `null`. A positive
integer opts back into a deadline in seconds.

Agents and discovery continue until completion, a real error, or manual cancellation
with `Ctrl+C`. Existing progress logging and agent waiting heartbeats remain enabled.
Without a total deadline, a stuck run can wait indefinitely; inspect its logs and
cancel it when necessary. Cancelling still cleans up the owned subprocesses.

Individual navigation, font/media readiness, HTTP requests, browser startup and
dependency setup retain their operation-specific limits. These report failed
operations rather than ending an otherwise active agent merely for taking too long.
The Copilot continuation budget is unchanged. Recovery budgets are per failing operation,
not per page-wide invocation ID.

## Planner latency

The planner no longer starts by generating and debugging browser scripts. Before
its Copilot invocation, Python runs [tools/discover.mjs](tools/discover.mjs) directly
with the pinned shared browser. The collector visits only the supplied page and its
loaded resources, uses fresh isolated browser contexts, and never submits forms or
clicks links. It records all eleven discovery signal categories, raw DOM text and
styles, media/font readiness, hover/focus observations, 20px page bands, batched
rectangle samples, token measurements and full-page source screenshots.

Header navigation uses **visible-links-only** discovery, as requested. The collector
records default-state header link text, URLs and geometry in `header-links.json` at
each breakpoint. It never hovers/focuses document header/banner controls or top-level
navigation to open dropdowns or submenus. Hidden header menu content is intentionally
out of scope, not silently marked verified. Main-content and footer interactions
remain enabled; visible header links and styling still participate in visual parity.
The collector logs this exclusion and records `header_navigation_scope` in its
manifest and summaries. Planner, component and parity prompts use the same scope.

Defaults under `discovery` in [config/migration.yaml](config/migration.yaml):

| Setting | Default | Purpose |
|---|---|---|
| `max_parallel` | 2 | Concurrent breakpoint contexts, independent of component fan-out. |
| `page_timeout_seconds` | `null` | No overall discovery deadline; a positive value enables one. |
| `navigation_timeout_seconds` | 30 | Bound navigation/loading of the source page. |
| `readiness_timeout_seconds` | 15 | Bound individual font, media and interaction waits. |

The collector closes each context on success or failure and closes its browser at
the end. Python adds an outer deadline only when a positive per-breakpoint limit
is configured, and stops only that collector's process tree on interruption or
an explicitly enabled timeout. Progress is printed by breakpoint/stage
and persisted to `progress.jsonl`; partial evidence is retained for diagnosis, not
accepted as complete. Missing readiness or artifacts stops planning before spending
LLM calls. The mandatory dynamic-injection wait, stability samples, breakpoints and
final visual thresholds have not been shortened or removed.

Repository inventory is cached by the contents of the configured component, XF,
template and policy roots. File additions, removals or edits invalidate the cache.
Only this repository inventory is cached across new runs: live-page evidence is
collected afresh. No old screenshot is substituted for a new source observation.

The LLM reads a compact source summary and inventory first, then the specific raw
artifacts needed for a decision. It must not create more discovery scripts or
repeat live-page scans. It still owns exactly-once block coverage, source order,
reuse decisions, field contracts and dependencies. `COLLECTED` means the collector
finished its checks, not that the plan, authorability, semantic behavior or final
visual parity has passed. Unhandled source behavior requires an explicit failure,
not omission or guessed evidence; parity interaction tests remain separate.

New planner results include `discovery_seconds` and `planner_total_seconds` alongside
the existing backend `duration_seconds`. Discovery manifests include per-breakpoint
stage timings and hashes. These allow collector time and LLM time to be compared
without pretending that a faster dry run predicts live migration performance.

Use a fresh run to pick up this change; it does not hot-reload an already running
planner. Resuming a prior planner without the new collection manifest is rejected.
No production-readiness sign-off is implied by the offline collector tests.

## The prompt contract is the source of truth

`SITE_URL`, `required_breakpoints`, `visual_pass_ratio`, and
`max_attempts_per_component` are read from [prompt_new.md](../prompt_new.md) — never
hardcoded in Python. [config/migration.yaml](config/migration.yaml) binds the logical
names to the keys that appear in that markdown, so renaming a key there is a config
edit, not a code edit.

The coordinator ignores agent-supplied pixel counts and ratios. It invokes
[tools/score.mjs](tools/score.mjs) on validated PNG pairs through
[aem_agents/scoring.py](aem_agents/scoring.py), creates its own diffs and labeled
comparisons, and applies the unchanged contract threshold. Full-page composites
must provide real source/target PNGs, URLs, breakpoint and DPR; a bare ratio fails.
Unequal dimensions withhold scoring and request a layout repair. Exactly `0.90`
still fails when the contract requires `> 0.90`.

## Check evidence format

For successful agent results, each `checks[].evidence` is one exact file path or a
nonempty JSON array of file paths. Every path must be repository-relative or
absolute and resolve to an existing, nonempty file inside the current run's evidence
directory. Multi-file checks must list every supporting artifact explicitly.

```json
{
  "name": "all_breakpoints_ready",
  "status": "PASS",
  "evidence": [
    "design/scratch/migration-<run-id>/stability-375.json",
    "design/scratch/migration-<run-id>/stability-768.json",
    "design/scratch/migration-<run-id>/stability-1440.json"
  ],
  "details": "Viewport and layout stability checked at every breakpoint."
}
```

Use `details` for explanations. Comma-separated paths, globs, Markdown links and
paths with appended prose are not interpreted as evidence references. The shared
prompt renderer supplies this contract to every agent; validation errors identify
the agent and check that need correction. File validation does not certify the
measurements inside an artifact or replace the required browser and parity gates.

## Ownership and dependencies

The planner declares `owned_paths` for additional files such as exact Java model,
helper and test paths and other component-scoped frontend files. Each component owns
its application directory and the exact `_<id>.scss`, `<id>.scss`, `<id>.css` and
`<id>.js` files under `ui.frontend/src/main/webpack/components/` automatically,
including reused components. This is not an extension wildcard or permission for
other component files, asset folders or shared site files. Other source paths still
need explicit ownership. Both defaults and declared paths are shown in the worker prompt and
checked for conflicting owners before workers start. Unknown dependency ids and
cycles are also rejected. `depends_on` is a completion
barrier; `priority_prefixes` only orders submissions within an already-ready wave.

Content delivery and file ownership are separate. Page and Experience Fragment
content goes through the merge handler, even when `delivery` is
`experience-fragment`. Plans can declare exact JCR `contribution_targets`; workers
must include each target as a `page_path` with authored nodes in their contribution.

If the planner mistakenly lists an exact page/XF content XML file in `owned_paths`,
the coordinator moves it into `contribution_targets` before ownership validation.
This correction uses the configured authored-page file pattern and is restricted
to this project's page root and configured XF root. It logs the correction and
records `ownership_corrections` in the planner result. The canonical accepted plan
contains the corrected ownership. Content intent is preserved: omitting a required
contribution target fails validation before component changes are applied.

This does not grant component workers permission to edit content XML. Actual
unowned file edits, templates, shared styles/policies, Vault filters, DAM files,
unknown roots, traversal and broad content claims remain rejected. Rejected planner
results are persisted as `FAIL`, and failures before an accepted component plan
report that visual parity was not run rather than showing zero unresolved components.

Workers receive copies of eligible current source files, including uncommitted
changes, without build outputs, virtual environments or installed dependencies.
Python derives the actual diff, rejects unowned changes, checks that the original
files have not changed meanwhile, and applies accepted changes serially. Deletions
also count as changes: workers must leave unowned files untouched, not delete them
to avoid an ownership error. Each wave
sees its prerequisites' applied files. Because a worker checkout has no `target/`,
any Maven goal there is a cold reactor build: workers therefore declare the focused
test they wrote and the deployer runs it once on the merged, warm checkout.
Page and XF content are applied separately through the existing contribution merge.

### Shared Validation Policy

Common rules live once in `validation.rules` in
[config/migration.yaml](config/migration.yaml). The base agent appends the same
policy and resolved output paths to each role prompt. No separate policy prompt,
new role or per-component configuration file is needed.

Each invocation gets an evidence workspace under `agents/<slug>/validation`:

| Environment | Purpose |
|---|---|
| `MIGRATION_VALIDATION_DIR` | Explicit compiler output, coverage and check logs |
| `REPORTS_PATH` | Cypress screenshots, videos and JUnit reports |
| `TMP`, `TEMP`, `TMPDIR` | Temporary files for tools honoring OS temp settings |

Paths are absolute, scoped per worker/attempt and checked to remain inside the
current run's evidence directory. Workers use already-available JSON/XML parsing
or `node --check` for immediate structural checks. The coordinator owns locked
`npm ci` and the shared frontend build; the deployer owns compilation, declared
tests and the original code-assessment analyzer. Workers do not install dependencies
or run Sass/webpack/analyzers. Lockfiles, source files
and deployable assets remain protected; failure to obey the policy is not fixed
by automatically expanding ownership or deleting user changes.

Native build output remains excluded, along with exact legacy module-root output
locations: `ui.frontend/dist_validate`, `ui.frontend/build`, `ui.frontend/coverage`,
`ui.frontend/reports` and `ui.tests/test-module/cypress/results`. These compatibility
exclusions are not the preferred validation destination. Similarly named source
directories remain checked, and Git ignore rules do not determine ownership.

### Serialized Shared Build

If frontend source changed, the coordinator runs `deploy.frontend.install` and
`deploy.frontend.build` after component waves and content merging, before starting
the deployer. Defaults are `npm ci` and `npm run prod` in an isolated source
snapshot. Only configured site/dependency clientlib outputs may change; generated
source is copied back only after success, ownership validation and checkout-conflict
checks. No frontend module or full project build is run for a dry run.

The run records input hashes, output hashes, command exit codes, logs and a protected
receipt. Unchanged inputs and outputs reuse that successful build on deployment
retries or resume. Source repairs or changed outputs require a new build. This is
per-run reuse, not a cross-machine reproducible-build guarantee. Each new isolated
build installs dependencies again, so it can require registry access.

The deployer receives the prepared clientlib paths, not a command to build the
frontend again. A failed shared build stops deployment and appears in the report;
source or clientlib changes made during deployment invalidate acceptance. Runtime
deployment and parity checks still run on retries even when a build is reused.

Shared paths are configured in `isolation.foundation_paths`. Missing tokens are
reported as `foundation_requests`; shared styles and policy requests use the same
owner-directed mechanism. The coordinator schedules planner shared mode for repair
mode within the existing retry budget. Repairs also include transitive dependents.
Snapshots are retained under the evidence directory during the run and after
non-successful runs, so budget disk space along with parallelism. Successful runs
remove them by default after report acceptance (see Output below).
On Windows, a short `--evidence-dir` helps avoid long
paths when copying deeply nested component files.

## Trust boundaries

Snapshots and path validation prevent conflicting code application; they are not
an OS security sandbox. Copilot tools still run with the invoking user's permissions.
Every prompt explicitly identifies its source root, also exported as
`MIGRATION_SOURCE_ROOT`. Historical absolute paths in contracts or evidence are not
write destinations. Planning-mode source writes are rejected; shared-mode writes must
match `isolation.foundation_paths`. Changes in the original checkout fail the gate
with the offending file names; they are not automatically reverted.
Use a dedicated restricted account or container when processing untrusted inputs.
Environment variables redirect only tools that honor them; explicit compiler flags
must also use the validation workspace. Do not edit shared repository files while
a migration is active: the checkout guard deliberately rejects concurrent changes.

Browser capture and style/geometry/media comparison are coordinator-owned; selector
mappings, semantic/authorability checks and deployment still involve agents. The
deterministic scorer proves comparison of the supplied PNGs, not web origin by itself.
Fixed capture code, validated URLs, fresh invocation-specific capture
directories, timestamps, URL metadata and evidence checks reduce accidental stale
reuse; they do not cryptographically attest browser provenance. No unattended live
AEM success is implied by the offline regression suite.

## Layout

```
design/site-url/
  prompt_new.md              the canonical contract (thresholds live here)
  run-migration.cmd|.mjs     legacy single-agent launcher
  scripts/
    setup.ps1 | setup.sh     one-time bootstrap
    requirements.txt         Python dependencies
    run_migration.py         entry point
    config/                  migration.yaml, agents.yaml
    prompts/                 one role prompt per agent
    aem_agents/              orchestrator + agent implementations
    tools/                   shared browser, discovery collector, scorer and npm lockfile
    tests/                   offline orchestration and native scorer regressions
    .venv/                   created by setup, git-ignored
```

## Configuration

| File | Owns |
|---|---|
| [config/migration.yaml](config/migration.yaml) | Contract binding, run layout, AEM target, agent backend and CLI flags, fan-out limits, Maven deploy table, parity capture mechanics, pipeline phases. |
| [config/agents.yaml](config/agents.yaml) | The agent roster: prompt file, model, budget, and the result contract each agent must satisfy. |
| [prompts/](prompts) | One role prompt per agent. `{{placeholders}}` are filled from config and the contract. |

Adding an agent is a config change plus a small class in `aem_agents/agents/`
registered in `AGENT_CLASSES`.

## Secrets

Nothing secret lives in the YAML. AEM credentials are read by the agents from the
environment variable named in `aem.credentials_env` (default `AEM_CREDENTIALS`).
Host and port come from `AEM_HOST` / `AEM_PORT` when set, otherwise the config
defaults. Every agent invocation denies the git tools that would rewrite history.

## CLI

```
python run_migration.py --url https://example.com/page [options]

--url URL              Override SITE_URL from the contract
--target-path PATH     AEM page path to author into
--breakpoints LIST     Comma-separated widths
--model ID             Model passed to the agent backend
--effort LEVEL         Reasoning effort, when the model advertises it
--max-parallel N       Component agents running concurrently
--max-attempts N       Remediation attempts per component
--only PHASES          Phase ids (plan,foundations,implement,assets,merge,deploy,parity,report)
--evidence-dir PATH    Override the generated evidence directory (relative to the repo root)
--run-id ID            Choose an id; an existing run requires --resume
--resume               Reuse validated checkpoints from --run-id or --evidence-dir
--retry-recovery       With --resume, grant one additional recovery attempt without resetting history
--skip-probe           Do not probe SITE_URL and AEM first
--dry-run              Resolve config, render every prompt, invoke nothing
--show-plan            Print the resolved contract and pipeline, then exit
--verbose              Show technical tool activity and write debug logs
```

Exit codes: `0` complete or successful dry run, `1` failed, `2` blocked, `130` interrupted.
Dry runs finish as `DRY_RUN`, never as a verified migration.

Resume with `python design/site-url/scripts/run_migration.py --resume --run-id YOUR_RUN_ID`
from the repository root. Omitted URL, target path, and breakpoints are restored
from that run. Source files, configuration and reusable evidence are fingerprinted.
Changed source, inputs, configuration, AEM targets, attempt budgets or frozen evidence
reject reuse without overwriting those changes. Start a new run to accept changed
inputs. Valid planner, planner-shared, shared-repair and component results are reused;
interrupted component attempts still consume their budget. A phase recovery cursor
continues the failed operation, not every previous build. Source repairs repeat the
required downstream gates. A paused parity phase repeats deployment verification
before collecting fresh comparisons; a report-only I/O pause reuses verified evidence.
Successful runs cleaned under the default retention
policy cannot be resumed; the CLI explains this rather than reporting missing state.

Existing evidence is never silently reset on startup, and skipping planning with `--only`
requires a compatible checkpoint. **State schema is now version 3; older runs require
a new run rather than an automatic conversion.** Only one migration may run per workspace.

Runs created before the planner shared-mode/handoff change or reporter removal also
require a new run: their configuration fingerprints and role envelopes are incompatible.
Include `foundations` in `--only` when shared-foundation repairs must be allowed.

Regression tests (using the launcher's environment on Windows):
`design/site-url/scripts/.venv/Scripts/python.exe -B -m unittest discover -s design/site-url/scripts/tests -v`

## Output

During a run, everything lands under `design/scratch/migration-<run_id>/`:

```
run-state.json                     orchestrator source of truth
component-plan.json                the validated plan
completion-report.md               deterministic orchestrator report
report-result.json                 report outcome, pipeline status and residual gaps
orchestrator.log
agents/<agent-slug>/prompt.md      exactly what the agent was told
agents/<agent-slug>/result.json    the validated envelope
agents/<agent-slug>/stream.jsonl   raw backend event stream
workspaces/<agent-slug>/          isolated source snapshots
discovery/collection-*/           prepared source summary, inventory and collector inputs
discovery/collection-*/source/    checksummed source observations and progress by breakpoint
parity/                            runner, screenshots, diffs, scores
parity/verified/verification-*/   coordinator-owned images and hashed receipts
```

### Successful-run cleanup

`run.cleanup_on_success: true` is the default in
[config/migration.yaml](config/migration.yaml). After all migration gates and the
completion report pass, the coordinator removes the current run's temporary
files and directories, keeping only:

```text
completion-report.md               final verified report with a retention notice
completion-summary.json            run identity, outcome, component/phase statuses and cleanup result
```

Discovery JSON (including band scans), raw observations, temporary scripts, worker
checkouts, handoff packets, logs, asset staging copies, screenshots, diffs, receipts,
agent results and resume checkpoints are deleted. Scores in the retained report
were verified before deletion; detailed evidence paths are historical references
and cannot be reopened or reverified. Cleaned successful runs are not resumable.
The summary records removed file/byte counts, the report hash and any cleanup errors.

Failed, blocked, interrupted, partial and dry runs retain all their evidence for
diagnosis and compatible resume. Cleanup never sweeps old run folders or touches
project source, deployed AEM content, OOTB skills or shared browser/npm caches.
It checks the current run's identity and rejects filesystem links/junctions rather
than following them. A locked file or other deletion failure emits a warning and
is recorded in the summary; it does not turn a successful deployment into failure.

Set `run.cleanup_on_success: false` **before starting a run** to keep all evidence,
including screenshots and checkpoints, for later inspection. Existing saved runs
are not deleted by installing or testing this cleanup change.

## Prerequisites

Normal launcher execution installs its project dependencies automatically. These
host runtimes and external services must be available first:

- Python 3.10+ (the launcher creates the venv and installs
  [requirements.txt](requirements.txt) itself)
- GitHub Copilot CLI (`npm install -g @github/copilot`, then `copilot login`)
- Node.js 20+ with npm for the pinned Playwright and pixelmatch runtime
- Shared Node packages and matching Chromium: automatically prepared by normal launcher preflight
- An installed JDK selected through `JAVA_HOME` or `PATH`, and Maven for scoped module deploys
- A running local AEM author instance

## Relationship to the Node launcher

`design/site-url/run-migration.cmd` remains a supported single-agent entry point.
This pipeline is a parallel entry point that reads the same contract but splits the
work across specialised agents and fans out component implementation.
The Python ownership, dependency, checkpoint and independent-scoring safeguards
described here do not automatically apply to the legacy single-agent Node launcher.
