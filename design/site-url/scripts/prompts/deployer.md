# Deterministic Deployment Contract

This is a reference contract for the **deterministic deployment worker**, not an
LLM prompt. Python receives the union of changed files, selects configured scopes,
deploys in dependency order and verifies live evidence. No Copilot session is
started. Repair instructions describe work delegated to existing source owners,
not permission for the deployment worker to edit application code.

## Run inputs

| Key | Value |
|---|---|
| `run_id` | `{{run_id}}` |
| Attempt | `{{attempt}}` of `{{max_attempts}}` |
| AEM host | `{{aem_host}}` |
| AEM port | `{{aem_port}}` |
| Disabled URL | `{{disabled_url}}` |
| Author URL | `{{author_url}}` |
| Credentials | read from the `{{credentials_env}}` environment variable |
| Evidence dir | `{{evidence_dir}}` |
| Result file | `{{result_path}}` |
| Contract | `{{contract_file}}` |

Never print, log, or persist the credentials.

`JAVA_HOME` is already resolved and exported into your environment as
`{{java_home}}`. Run `mvn` directly — do not check it with `mvn -v`, search for JDKs,
or prefix commands with `$env:JAVA_HOME=...`.

## Changed files from the component agents

```json
{{changed_files_json}}
```

## Prepared Shared Frontend

```json
{{frontend_build_json}}
```

When frontend source changed, the coordinator has already run the configured
frontend install/build in isolation, applied the verified clientlibs and included
them in your changed-file list. Read its receipt/logs for evidence. Do not rerun
the frontend build, invoke the clientlib generator or modify those inputs/outputs;
deploy the prepared `ui.apps` package after normal compile and HTL checks. A failed
frontend build prevents this agent from starting. Report frontend defects to the
coordinator instead of repairing or rebuilding them during deployment.

## MUST — Pre-deploy hygiene (once, before any build)

{{deploy_hygiene}}

## Deploy selection

Pick the smallest scope covering the changed paths. A full reactor build is
authorized **only** when a new cross-module artifact or dependency requires reactor
assembly, or an earlier scoped deploy demonstrably failed to reflect on the target
port and you can show the HTTP/JSON diff. Changing several modules is not a reason to
use a shared profile — deploy each module with its own profile in dependency order.

{{deploy_table}}

Rules:

{{deploy_rules}}

Never use a deploy command as a compile check. If the validation build above passes
and a deploy then fails to compile, suspect stale `ui.apps/target/generated-sources/htl/`
and `ui.apps/target/classes/` again before changing component code — a generated
script referencing a model that does not exist in source is a stale artifact, not a
defect in this run.

## Before deploying

1. Complete the pre-deploy hygiene above. The validation build must pass before any
   deploy command runs.
2. Run the focused tests reported by the component agents for every touched model or
   component. A failing focused test blocks the deploy.
3. Run `code-assessment` on generated Java/OSGi/Maven code. Treat its findings as
   blocking, not advisory — in particular bare `@Inject` in Sling Models, deprecated
   APIs, unbounded queries, and outbound calls without timeouts. MUST load:
   {{required_skills}}.
4. Verify every DAM asset referenced by an authored instance is already readable in
   AEM — the assets phase uploaded them over HTTP before you ran. Do not download,
   upload, or package any binary: assets are deliberately outside the FileVault
   package. A missing asset is an assets-phase failure to report, not something to
   fix by adding it to `filter.xml`.

## After deploying

Fetch with basic auth plus a `Referer` header and assert:

- HTTP 200 and zero `SightlyException` on the disabled page and the author page;
- the site/token CSS and every touched component clientlib actually load;
- expected component roots, modifiers, instance counts, and source order;
- authored multifield cardinality and order;
- semantic wrappers, non-empty links and actions, ARIA, and server-rendered initial
  state;
- live repository JSON equals the checked-in intent — `ui.content` is FileVault
  `mode="merge"`, so stale properties and child order can survive an install;
- every referenced DAM asset returns 200, non-zero bytes, correct MIME, and decodes
  in the browser;
- the bundle is active and every Sling Model adapts;
- every planned target selector resolves to its intended live instance with the
  expected match count and signature at every breakpoint where the planner recorded
  it visible. A breakpoint where it is intentionally hidden must verify as zero
  visible matches, not as missing;
- a component delivered as an Experience Fragment renders through
  `{{xf_component}}`, so assert the fragment's own markup appears on the page and
  that `fragmentVariationPath` resolves — an empty `experiencefragment` wrapper is a
  failure, not a pass.

A `BUILD SUCCESS`, a checked-in file, or a class name appearing in markup is **not**
deployed evidence.

## Required output

Write valid JSON to `{{result_path}}`:

```json
{
  "agent": "deployer",
  "run_id": "{{run_id}}",
  "status": "PASS",
  "outputs": {
    "deploy_commands": [{"id": "ui-apps", "command": "<exact command>", "exit_code": 0, "evidence": "<log path>"}],
    "target_url": "{{disabled_url}}",
    "author_url": "{{author_url}}",
    "focused_tests": [{"command": "<command>", "status": "PASS"}],
    "runtime_sweep": "<path under evidence dir>",
    "repository_reconciliation": "<path under evidence dir>",
    "asset_manifest": "<path under evidence dir>",
    "clientlib_report": "<path under evidence dir>",
    "code_assessment": "<path under evidence dir>"
  },
  "checks": [
    {"name": "focused_tests_pass", "status": "PASS", "evidence": "<path>"},
    {"name": "scoped_deploy_succeeded", "status": "PASS", "evidence": "<path>"},
    {"name": "packages_and_bundles_active", "status": "PASS", "evidence": "<path>"},
    {"name": "disabled_and_author_runtime_valid", "status": "PASS", "evidence": "<path>"},
    {"name": "target_selectors_resolve_uniquely", "status": "PASS", "evidence": "<path>"},
    {"name": "assets_reachable_and_decoded", "status": "PASS", "evidence": "<path>"},
    {"name": "live_repository_matches_intent", "status": "PASS", "evidence": "<path>"}
  ],
  "failures": []
}
```

Return `FAIL` for anything repairable in this run. Return `BLOCKED` only when an
external prerequisite is unavailable — for example the AEM instance is not running.
A local code or configuration defect is never `BLOCKED`.

Do not ask interactive questions. Do not commit, branch, reset, or revert.
