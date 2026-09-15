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
never run Node/browser setup. Other browser launch failures (for example a timeout,
a rejected complete installation or a missing system library) are reported without reinstall loops.
The launch timeout defaults to 15 seconds, with a 25-second outer process limit;
`parity.browser_check_timeout_seconds` controls it.

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
stale lock. Package setup has a five-minute deadline; browser setup has a 330-second
outer deadline, a five-minute installer deadline and a 30-second download connection
timeout. Timeout or cancellation cleans up only the setup process tree. Failed
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

```text
Python + pinned collector: source evidence and cached repository inventory
  -> Planner: coverage, reuse, ownership, dependencies, shared tokens/styles/policies
  -> Component workers: isolated snapshots, bounded dependency waves
  -> Coordinator: validate actual diffs and apply owned changes
  -> Assets: deterministic downloads and DAM upload
  -> Merge: deterministic page/XF contributions and Vault filters
  -> Deployer: scoped builds, deployment and runtime checks
  -> Parity agent: fresh browser captures and qualitative checks
  -> Pinned scorer: independent pixels, composites and hash receipts
  -> Orchestrator: deterministic completion report from persisted evidence

Failed gates -> bounded repairs of owners and affected dependents
```

| Agent | Role |
|---|---|
| `planner` | Consumes prepared evidence, emits the coverage and component plan, and establishes shared tokens, site styles and policies in one isolated invocation. **The number of components it returns is the fan-out width.** |
| `component` | Implements one component in a copied source checkout; declares authored page/XF content as contributions. |
| `deployer` | Chooses the smallest scoped Maven deploy covering the union of changed files and proves the change is live. |
| `parity` | Captures fresh live-vs-AEM evidence and diagnoses geometry, properties, media and interactions. Python owns numeric acceptance. |

There are four agent roles and four role prompts. Planning and foundations share
[aem_agents/agents/planner.py](aem_agents/agents/planner.py) and
[prompts/planner.md](prompts/planner.md). Later shared-file repairs use the same
planner in repair mode, without collecting the source again or changing the plan.
Repair results have separate `planner-repair-attempt-N` identities so the original
plan and its frozen evidence remain reusable.

The `report` phase is a deterministic orchestrator handler, not an agent invocation.
It writes `completion-report.md` and `report-result.json` from persisted state,
including failures before preflight completes and explicitly unverified dry runs.
The report includes score tables, recorded screenshot minima, component and deploy
ledgers, evidence references and residual gaps. Missing qualitative data is left
unreported; numeric screenshot scores require a matching current-run scorer receipt.
Invalid or unverified scores are withheld. Report generation cannot upgrade failed
gates to completion, and a report-write failure prevents completion.

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
| `page_timeout_seconds` | 120 | Bound each breakpoint's complete collection. |
| `navigation_timeout_seconds` | 30 | Bound navigation/loading of the source page. |
| `readiness_timeout_seconds` | 15 | Bound individual font, media and interaction waits. |

The collector closes each context on success or failure and closes its browser at
the end. Python has an additional overall deadline and stops only that collector's
process tree on interruption or timeout. Progress is printed by breakpoint/stage
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
helper and test paths and component-scoped frontend files. Each component owns its
own application directory automatically. Overlapping ownership, unknown dependency
ids and cycles are rejected before workers start. `depends_on` is a completion
barrier; `priority_prefixes` only orders submissions within an already-ready wave.

Workers receive copies of eligible current source files, including uncommitted
changes, without build outputs, virtual environments or installed dependencies.
Python derives the actual diff, rejects unowned changes, checks that the original
files have not changed meanwhile, and applies accepted changes serially. Each wave
sees its prerequisites' applied files. Maven output stays in the worker checkout.
Page and XF content are applied separately through the existing contribution merge.

Shared paths are configured in `isolation.foundation_paths`. Missing tokens are
reported as `foundation_requests`; the coordinator schedules the planner in repair
mode within the existing retry budget. Repairs also include transitive dependents.
Snapshots are retained under the evidence directory for inspection, so budget disk
space along with parallelism. On Windows, a short `--evidence-dir` helps avoid long
paths when copying deeply nested component files.

## Trust boundaries

Snapshots and path validation prevent conflicting code application; they are not
an OS security sandbox. Copilot tools still run with the invoking user's permissions.
Use a dedicated restricted account or container when processing untrusted inputs.

Browser capture, selector choice, semantic/authorability checks and runtime deployment
checks remain agent-assisted. The deterministic scorer proves the comparison of the
supplied PNGs, not their web origin by itself. Fresh invocation-specific capture
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
--only PHASES          Phase ids (plan,implement,assets,merge,deploy,parity,report)
--evidence-dir PATH    Override the generated evidence directory (relative to the repo root)
--run-id ID            Choose an id; an existing run requires --resume
--resume               Reuse validated checkpoints from --run-id or --evidence-dir
--skip-probe           Do not probe SITE_URL and AEM first
--dry-run              Resolve config, render every prompt, invoke nothing
--show-plan            Print the resolved contract and pipeline, then exit
--verbose              Debug logging into the run log
```

Exit codes: `0` complete or successful dry run, `1` failed, `2` blocked, `130` interrupted.
Dry runs finish as `DRY_RUN`, never as a verified migration.

Resume with `python design/site-url/scripts/run_migration.py --resume --run-id YOUR_RUN_ID`
from the repository root. Omitted URL, target path, and breakpoints are restored
from that run. Source files, configuration and reusable evidence are fingerprinted.
Changed source, inputs, configuration, AEM targets, attempt budgets or frozen evidence
reject reuse without overwriting those changes. Start a new run to accept changed
inputs. Valid planner, shared-repair and component results are reused; interrupted component
attempts still consume their budget. Assets, merge, deployment and fresh parity run
again, even when an earlier parity attempt passed. A final passing attempt may be
reverified without granting another component implementation attempt.

Existing evidence is never silently reset, and skipping planning with `--only`
requires a compatible checkpoint. **State schema is now version 3; older runs require
a new run rather than an automatic conversion.** Only one migration may run per workspace.

Runs created before the planner/foundations consolidation or reporter removal also
require a new run: their configuration fingerprints and role envelopes are incompatible.
Include `plan` in `--only` when shared-foundation repairs must be allowed.

Regression tests (using the launcher's environment on Windows):
`design/site-url/scripts/.venv/Scripts/python.exe -B -m unittest discover -s design/site-url/scripts/tests -v`

## Output

Everything lands under `design/scratch/migration-<run_id>/`:

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
