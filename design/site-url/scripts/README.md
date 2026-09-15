# AEM Migration Agents

A config-driven multi-agent pipeline that migrates a live web page into authorable
AEM as a Cloud Service components and gates delivery on measured visual parity.

Everything the pipeline needs lives in this folder, next to the prompt contract it
reads.

## Quick start

The launcher bootstraps its own Python environment on first run. Install the pinned
numeric verifier once before a real migration (repeat when its lockfile changes):

```powershell
npm ci --prefix design/site-url/scripts/tools --ignore-scripts
```

This installs Pixelmatch and pngjs separately from the agents' browser tooling.
Preflight checks the verifier before starting agents, and detects changes to its
code or dependencies during the run.

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

It then re-launches itself inside that environment and continues. Later runs reuse
it and skip the install — a stamp file records the `requirements.txt` hash, so pip
only runs again when the requirements actually change. If the dependencies are
already importable (you activated the venv yourself, or installed them globally),
the bootstrap is skipped entirely and costs nothing.

### Optional: check the external tooling too

The bootstrap only covers Python. `setup.ps1` / `setup.sh` additionally verify
Node.js, the GitHub Copilot CLI, Maven, Java, and that AEM author is reachable:

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
| `AEM_AGENTS_SKIP_BOOTSTRAP` | Same as `--no-bootstrap`; never create or re-launch into a venv. |

## How it works

```text
Planner: frozen discovery, ownership and dependency plan
  -> Foundations: one writer for shared tokens, site styles and policies
  -> Component workers: isolated snapshots, bounded dependency waves
  -> Coordinator: validate actual diffs and apply owned changes
  -> Assets: deterministic downloads and DAM upload
  -> Merge: deterministic page/XF contributions and Vault filters
  -> Deployer: scoped builds, deployment and runtime checks
  -> Parity agent: fresh browser captures and qualitative checks
  -> Pinned scorer: independent pixels, composites and hash receipts
  -> Reporter: completion report from persisted evidence

Failed gates -> bounded repairs of owners and affected dependents
```

| Agent | Role |
|---|---|
| `planner` | Source discovery at every breakpoint; emits the component plan. **The number of components it returns is the fan-out width.** |
| `foundations` | Sole worker for shared site tokens, site styles and policies; completes before components start. |
| `component` | Implements one component in a copied source checkout; declares authored page/XF content as contributions. |
| `deployer` | Chooses the smallest scoped Maven deploy covering the union of changed files and proves the change is live. |
| `parity` | Captures fresh live-vs-AEM evidence and diagnoses geometry, properties, media and interactions. Python owns numeric acceptance. |
| `reporter` | Writes the completion report from persisted evidence only. |

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
reported as `foundation_requests`; the coordinator schedules the foundations owner
within the existing retry budget. Repairs also include transitive dependents.
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
    tools/                   pinned numeric scorer and npm lockfile
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
inputs. Valid planner/foundations/component results are reused; interrupted component
attempts still consume their budget. Assets, merge, deployment and fresh parity run
again, even when an earlier parity attempt passed. A final passing attempt may be
reverified without granting another component implementation attempt.

Existing evidence is never silently reset, and skipping planning with `--only`
requires a compatible checkpoint. **State schema is now version 3; older runs require
a new run rather than an automatic conversion.** Only one migration may run per workspace.

Regression tests (using the launcher's environment on Windows):
`design/site-url/scripts/.venv/Scripts/python.exe -B -m unittest discover -s design/site-url/scripts/tests -v`

## Output

Everything lands under `design/scratch/migration-<run_id>/`:

```
run-state.json                     orchestrator source of truth
component-plan.json                the validated plan
completion-report.md               the reporter's output
orchestrator.log
agents/<agent-slug>/prompt.md      exactly what the agent was told
agents/<agent-slug>/result.json    the validated envelope
agents/<agent-slug>/stream.jsonl   raw backend event stream
workspaces/<agent-slug>/          isolated source snapshots
parity/                            runner, screenshots, diffs, scores
parity/verified/verification-*/   coordinator-owned images and hashed receipts
```

## Prerequisites

The launcher installs its own Python dependencies. Everything else must already be
on the machine — `setup.ps1` / `setup.sh` check each one and tell you what is missing:

- Python 3.10+ (the launcher creates the venv and installs
  [requirements.txt](requirements.txt) itself)
- GitHub Copilot CLI (`npm install -g @github/copilot`, then `copilot login`)
- Node.js 18+ for the agents' Playwright and pixelmatch work
- Pinned scorer dependencies: `npm ci --prefix design/site-url/scripts/tools --ignore-scripts`
- Java and Maven for the scoped module deploys
- A running local AEM author instance

## Relationship to the Node launcher

`design/site-url/run-migration.cmd` remains a supported single-agent entry point.
This pipeline is a parallel entry point that reads the same contract but splits the
work across specialised agents and fans out component implementation.
The Python ownership, dependency, checkpoint and independent-scoring safeguards
described here do not automatically apply to the legacy single-agent Node launcher.
