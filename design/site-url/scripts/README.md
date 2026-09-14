# AEM Migration Agents

A config-driven multi-agent pipeline that migrates a live web page into authorable
AEM as a Cloud Service components and gates delivery on measured visual parity.

Everything the pipeline needs lives in this folder, next to the prompt contract it
reads.

## Quick start

There is no separate setup step. The launcher bootstraps its own Python
environment on first run.

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

```
                 reads SITE_URL + thresholds from design/site-url/prompt_new.md
                                          |
  orchestrator ──► planner ──► component plan (N components)
                                          |
                     ┌────────────────────┴────────────────────┐
                     │  fan-out: one component agent per plan  │
                     │  row, max_parallel at a time            │
                     └────────────────────┬────────────────────┘
                                          |  union of changed files
                                     deployer ──► scoped Maven deploy + runtime sweep
                                          |
                                      parity ──► Playwright + pixelmatch scoring
                                          |
                       below threshold? ──┴── re-dispatch only the failing
                       components with the measured deltas, up to
                       max_attempts_per_component
                                          |
                                     reporter ──► completion-report.md
```

| Agent | Role |
|---|---|
| `planner` | Source discovery at every breakpoint; emits the component plan. **The number of components it returns is the fan-out width.** |
| `component` | Implements exactly one component: dialog, HTL, Sling Model, clientlib, test, authored content. |
| `deployer` | Chooses the smallest scoped Maven deploy covering the union of changed files and proves the change is live. |
| `parity` | Captures live-vs-AEM evidence and scores every instance. Its verdict is re-checked in Python against the contract threshold. |
| `reporter` | Writes the completion report from persisted evidence only. |

## The prompt contract is the source of truth

`SITE_URL`, `required_breakpoints`, `visual_pass_ratio`, and
`max_attempts_per_component` are read from [prompt_new.md](../prompt_new.md) — never
hardcoded in Python. [config/migration.yaml](config/migration.yaml) binds the logical
names to the keys that appear in that markdown, so renaming a key there is a config
edit, not a code edit.

The parity agent cannot relax the gate: every reported ratio is re-evaluated in
[aem_agents/agents/parity.py](aem_agents/agents/parity.py) against the parsed
threshold, and a `PASS` that contradicts the numbers is rejected.

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
--only PHASES          Comma-separated phase ids (plan,implement,deploy,parity,report)
--evidence-dir PATH    Override the generated evidence directory (relative to the repo root)
--run-id ID            Reuse a run id
--skip-probe           Do not probe SITE_URL and AEM first
--dry-run              Resolve config, render every prompt, invoke nothing
--show-plan            Print the resolved contract and pipeline, then exit
--verbose              Debug logging into the run log
```

Exit codes: `0` complete, `1` failed, `2` blocked.

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
parity/                            runner, screenshots, diffs, scores
```

## Prerequisites

The launcher installs its own Python dependencies. Everything else must already be
on the machine — `setup.ps1` / `setup.sh` check each one and tell you what is missing:

- Python 3.10+ (the launcher creates the venv and installs
  [requirements.txt](requirements.txt) itself)
- GitHub Copilot CLI (`npm install -g @github/copilot`, then `copilot login`)
- Node.js 18+ for the agents' Playwright and pixelmatch work
- Java and Maven for the scoped module deploys
- A running local AEM author instance

## Relationship to the Node launcher

`design/site-url/run-migration.cmd` remains a supported single-agent entry point.
This pipeline is a parallel entry point that reads the same contract but splits the
work across specialised agents and fans out component implementation.
