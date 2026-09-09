# Assets, Build, Deployment, And Runtime

This file owns asset reproducibility, build/deployment order, and deployed runtime validation.

## Stage Execution Contract

- Inputs: accepted Stage 1 and Stage 2 results, file/content matrices, asset URLs, and the same `run_id`.
- Execute acquisition, focused tests, build, deployment, and live AEM runtime assertions. Reading commands without running them is not execution.
- Required outputs: asset manifest, command results, deployed package/bundle status, HTTP assertion sweep, repository reconciliation, clientlib evidence, and media decode report.
- Exit gate: assets are reproducible and decoded; required tests/build/deploy succeed; disabled/author pages, repository data, and clientlibs match Stage 2 intent.

## Assets And Motion

- Enumerate every visible raster image, SVG/data URI/symbol, icon, logo, CSS background, video/audio/poster, animated image, Lottie/JSON, canvas, font, and embed from source evidence.
- Fetch only exact URLs observed in source DOM, CSS, or network traffic.
- Store assets reproducibly under project-owned source and deploy them under `/content/dam/<project>/design/` (or the project-specific migration folder consistently).
- Author DAM paths; never ship remote URLs, data URIs, placeholders, or one substituted asset reused for distinct source slots.
- Record source URL, local path, DAM path, MIME, bytes, and deployment method.
- Verify source HEAD (GET fallback), target GET 200, MIME, non-zero bytes, and browser decode.
- Preserve media class and source controls. Background video uses playable muted looping inline video when observed. Reduced motion pauses/hides autoplay and exposes its real poster.

Missing or undecoded media gives Media 0 and caps Content at 80 for the affected instance; remediate before scoring.

## Build Order

```powershell
mvn -pl core clean test
mvn -T 1C install -PautoInstallSinglePackage -DskipTests -pl all,core,ui.apps,ui.apps.structure,ui.config,ui.content -am
```

Keep FileVault validation and relevant analyzers enabled. Run focused component/model tests before the reactor build. Run `code-assessment` before completion.

## MUST — Scoped Deploy (never full-reactor for isolated changes)

Do **not** run a full reactor build+deploy on every edit. The reactor cycle takes many minutes and blocks the Remediation Loop; every remediation iteration MUST use the smallest scope that covers the changed module. The full-reactor `-PautoInstallSinglePackage` command above is authorized only when either (a) a new cross-module artifact or dependency requires reactor assembly, or (b) an earlier scoped deploy failed to reflect on `:<aem.port>` and the mismatch is proven with an HTTP/JSON diff. Changing multiple modules alone is not a reason to use an incorrect shared profile; deploy each changed module with its own profile in dependency order.

| Change scope | MUST deploy with | Notes |
|---|---|---|
| Component CSS / HTL / dialog only (`ui.apps/.../components/**`) | `mvn install -pl ui.apps -PautoInstallPackage "-Daem.port=<PORT>" -DskipTests` | Fastest. Applies to per-component clientlibs and `_cq_dialog`. |
| Shared clientlib (`clientlib-base`, `clientlib-site`, tokens) | `mvn install -pl ui.apps -PautoInstallPackage "-Daem.port=<PORT>" -DskipTests` | Same command; scope is decided by what changed on disk. |
| Java / Sling Model / OSGi service (`core/src/main/java/**`) | `mvn install -pl core -PautoInstallBundle "-Daem.port=<PORT>" -DskipTests` | Bundle-only redeploy; no FileVault package. |
| Authored content (`ui.content/src/main/content/**`) | `mvn install -pl ui.content -PautoInstallPackage "-Daem.port=<PORT>" -DskipTests` | Note: `ui.content` is `mode="merge"`; also run the Sling POST reconcile to remove stale children when needed. |
| OSGi configuration (`ui.config/src/main/content/**`) | `mvn install -pl ui.config -PautoInstallPackage "-Daem.port=<PORT>" -DskipTests` | |
| Multiple modules in one iteration | Run each applicable row's command sequentially in dependency order | Example: deploy `core` with `autoInstallBundle`, then `ui.apps` with `autoInstallPackage`; never parallelize installs to one AEM instance. |
| Frontend webpack change (`ui.frontend/**`) | `cd ui.frontend && npm run build` **then** `mvn install -pl ui.apps -PautoInstallPackage "-Daem.port=<PORT>" -DskipTests` | Webpack output is copied into `ui.apps` by its assembly. |

Additional rules:

- MUST combine non-conflicting, already-diagnosed fixes for the same module into one build/deploy batch. Do not rebuild or redeploy that module separately for each component in the batch.
- MUST pass `-Daem.port=<PORT>` from the run inputs on every deploy. Never let it default to `4502` when the run targets another port.
- MUST NOT `mvn clean` a module unless a stale `target/` is proven to cause a failure. Prefer incremental `install`.
- MUST rerun the cheapest Stage 3 validation after a scoped deploy — the HTTP sweep and `_jcr_content.json` fetch — before re-entering Stage 4. A successful Maven `BUILD SUCCESS` alone is not proof the change is live.
- MUST NOT parallelize scoped deploys against the same `:<aem.port>` — package installs contend on `crx/packmgr`.
- If a scoped deploy is used and the target still renders stale markup, first suspect stale `ui.apps/target/generated-sources/htl/` and stale `ui.apps/target/classes/`. Delete them and rerun the scoped deploy before falling back to a full-reactor build.

## Deployment And Runtime Sweep

When local AEM is available, deploy affected modules and fetch with Basic auth plus Referer:

- disabled page;
- author/editor page;
- site/token CSS and every touched component clientlib;
- live repository JSON;
- every referenced DAM asset.

Assert:

- HTTP 200 and zero `SightlyException`;
- expected root/modifier/instance counts and source order;
- authored multifield cardinality/order;
- semantic wrappers, non-empty links/actions, ARIA and initial state;
- local clientlib selectors actually loaded;
- project DAM paths and decoded assets;
- active bundle/model adaptation;
- live authored values equal checked-in intent.
- every Stage 2 target selector resolves to its intended live instance with the expected match count and text/media signature at every breakpoint where Stage 1 records that instance as visible; an intentionally hidden breakpoint is verified as zero visible matches rather than treated as missing.

Checked-in files, a successful build, and class-name presence are not deployed evidence.

## Required Stage Result

Return the orchestrator's required `stage_result` envelope with:

```yaml
stage_result:
  stage: 03-assets-runtime
  run_id: <same run_id>
  status: PASS|FAIL|BLOCKED
  inputs_consumed: [01-source-discovery:<result-id>, 02-component-authoring:<result-id>]
  outputs:
    asset_manifest: <artifact>
    test_build_deploy_results: <artifact>
    runtime_assertion_sweep: <artifact>
    repository_reconciliation: <artifact>
    clientlib_and_media_report: <artifact>
  checks:
    - {name: assets_reachable_and_decoded, status: PASS|FAIL, evidence: <artifact>}
    - {name: focused_tests_and_reactor_build, status: PASS|FAIL, evidence: <commands/output>}
    - {name: packages_and_bundles_active, status: PASS|FAIL, evidence: <artifact>}
    - {name: disabled_and_author_runtime_valid, status: PASS|FAIL, evidence: <artifact>}
    - {name: target_selectors_resolve_uniquely, status: PASS|FAIL, evidence: <artifact>}
    - {name: live_repository_matches_intent, status: PASS|FAIL, evidence: <artifact>}
  failures: []
  next_stage: <04-visual-parity when PASS; null when FAIL/BLOCKED>
```

Return `FAIL` and remediate when any command, HTTP assertion, asset, bundle, content row, or runtime check fails. Use `BLOCKED` only for an external prerequisite that cannot be repaired in the run.
