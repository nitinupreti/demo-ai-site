# Standalone Migration Demo

Run the complete URL-to-AEM workflow from a command window without opening VS Code. The launcher reads `prompt_new.md` and the five stage files, while the source URL is supplied at runtime and is never written into the reusable prompt.

## Prerequisites

- Local AEM author is running. This demo defaults to port `4504`.
- Node.js is available on `PATH`.
- GitHub Copilot CLI is installed (`npm install -g @github/copilot`) and authenticated (`copilot login`). Copilot Free is supported, subject to its monthly request limits.
- Run only from a trusted repository. The launcher grants Copilot CLI autonomous tool, path, and URL access so it can create components, run builds, deploy packages, and collect browser evidence. Destructive Git operations are explicitly denied.

## Double-Click Demo

Double-click `run-migration.cmd`, paste the live page URL, and press Enter. The window displays stage messages, assistant updates, and tool activity. On successful completion it opens the generated AEM page and leaves all evidence under `design/scratch/migration-<run_id>/`.

The launcher uses Copilot's free-compatible `auto` model routing by default. A complete multi-stage migration can consume several requests; when a Copilot Free monthly limit is exhausted, the run stops and retains its evidence for diagnosis or resumption.

## Command Line

```powershell
design\site-url\run-migration.cmd --url "https://www.notion.com/customers/cursor" --aem-port 4504
```

Use a known target path when you want the launcher to have a deterministic fallback URL to open:

```powershell
design\site-url\run-migration.cmd --url "https://www.notion.com/customers/cursor" --target-path "/content/demo-ai-site/us/en/customers/cursor"
```

Validate prerequisites and generated inputs without starting the AI agent:

```powershell
design\site-url\run-migration.cmd --url "https://www.notion.com/customers/cursor" --aem-port 4504 --dry-run --no-open
```

Validate the exact Copilot CLI connection and progress stream without allowing migration work:

```powershell
design\site-url\run-migration.cmd --url "https://www.notion.com/customers/cursor" --aem-port 4504 --agent-smoke-test --no-open
```

Run `design\site-url\run-migration.cmd --help` for all options. Use Ctrl+C to stop an active run. A stopped or failed run retains its raw agent stream, progress events, stderr log, and `run-state.json` in its evidence directory.