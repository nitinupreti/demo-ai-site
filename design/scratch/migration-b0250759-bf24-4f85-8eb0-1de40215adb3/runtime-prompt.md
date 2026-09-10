# Standalone AEM Migration Run

Execute this migration end to end without VS Code. The runtime values below are authoritative and override placeholders or examples in repository prompt files.

```yaml
SITE_URL: "https://www.notion.com/customers/cursor"
TARGET_PAGE_PATH: null
BREAKPOINTS: [375, 768, 1440]
AEM_HOST: "localhost"
AEM_PORT: 4504
RUN_ID: "b0250759-bf24-4f85-8eb0-1de40215adb3"
EVIDENCE_DIR: "design/scratch/migration-b0250759-bf24-4f85-8eb0-1de40215adb3"
RUN_STATE: "design/scratch/migration-b0250759-bf24-4f85-8eb0-1de40215adb3/run-state.json"
```

Read `design/site-url/prompt_new.md` first and execute its Stage Router in exact order. Read each numbered stage file only when that stage becomes active. Follow `AGENTS.md`, `CLAUDE.md`, `.aem-skills-config.yaml`, and every required AEM skill. Use Node.js Playwright/Chromium for browser evidence.

Standalone execution rules:
- Do not edit `design/site-url/prompt_new.md` or its numbered stage specifications to inject runtime values.
- Do not commit, switch branches, reset, clean, or revert existing user changes.
- Do not ask interactive questions. For genuinely required user input or an external blocker, persist a truthful `BLOCKED` result and stop.
- Before each stage, print one line exactly as `MIGRATION_PROGRESS {"stage":"<stage-id>","status":"STARTED","message":"<short message>"}`.
- After each stage, print the same format with `PASS`, `FAIL`, or `BLOCKED`, and persist the full stage_result envelope to RUN_STATE before continuing.
- Keep RUN_STATE current throughout the run. Preserve its `launcher` and `inputs` fields.
- On terminal completion, set top-level `status` to `COMPLETE`, `FAIL`, or `BLOCKED`, set `current_stage`, and set `target_url` to the final disabled AEM URL when one exists.
- A build success is not completion. Finish only under the completion contract in the canonical prompt.
