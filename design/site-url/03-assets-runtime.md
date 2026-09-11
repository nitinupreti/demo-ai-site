# Assets, Build, Deployment, And Runtime

Owns asset acquisition, build/deploy scope, and live runtime validation. Consume accepted Stages 1/2 and their asset/file/content/selector manifests. Follow [skill routing](references/skill-routing.md) for code assessment and [capture gates](references/capture-gates.md) for deployed assets/media. Run checks; listing commands is not execution.

## Assets

- Acquire every source-manifest raster, SVG/data URI/symbol, icon, logo, CSS background, video/audio/poster, animated image, Lottie/JSON, canvas dependency, font, and scoped embed. Fetch only exact observed URLs.
- Keep reproducible project-owned source assets, deploy under `/content/dam/<project>/design/` (or one consistent project migration folder), and author DAM paths. No remote/temporary URLs, shipped data URIs, placeholders, or one substitute reused for distinct slots.
- Manifest fields: source URL, local/DAM paths, MIME, bytes, SHA-256 where exactness is checked, license/availability, and deployment method. Verify source HEAD/GET, target GET 200, MIME, non-zero bytes, and browser decode.
- Preserve source media class, controls, autoplay/visibility, motion, and reduced-motion/poster behavior. If an accessibility change is necessary, document it and resolve parity rather than silently changing source behavior.
- Missing/undecoded assets FAIL readiness; withhold visual scores. Numeric fallback penalties cannot authorize invalid screenshots.

## Validate Then Deploy

Run focused component/model tests (for example `mvn -pl core test`), required module builds, and local `code-assessment` on generated/changed Java/OSGi/Maven files. Keep FileVault validation and relevant analyzers enabled. Record commands, exit codes, logs, and assessment limitations; fix applicable blocking findings before PASS.

Batch non-conflicting diagnosed fixes per module. Build/deploy each changed module once per batch in dependency order, never concurrently against one AEM instance. Use the smallest applicable scope below; all Maven deploys include quoted runtime `"-Daem.host=<HOST>" "-Daem.port=<PORT>"`, never an implicit 4502.

| Changed scope | Deployment (append host/port above) |
|---|---|
| Component HTL/dialog/CSS/JS or shared clientlibs/tokens | `mvn install -pl ui.apps -PautoInstallPackage -DskipTests` |
| Java/Sling Model/OSGi service | `mvn install -pl core -PautoInstallBundle -DskipTests` |
| Authored content/assets/policies | `mvn install -pl ui.content -PautoInstallPackage -DskipTests` |
| OSGi config | `mvn install -pl ui.config -PautoInstallPackage -DskipTests` |
| Frontend webpack source | Run its configured build from `ui.frontend`, then deploy `ui.apps` as above |
| Multiple modules | Execute each applicable row sequentially; do not share an incorrect install profile |

Full-reactor assembly/deploy is allowed only for a new cross-module artifact/dependency needing assembly, or a proven HTTP/JSON mismatch after scoped recovery. Multiple changed modules alone do not justify it. When justified, use `mvn install -PautoInstallSinglePackage -DskipTests -pl all,core,ui.apps,ui.apps.structure,ui.config,ui.content -am` with runtime host/port and required frontend build.

No routine `mvn clean`. If logs/diffs prove stale generated HTL/classes, clean only implicated build outputs and retry scoped deployment before reactor fallback. Never hand-edit generated files. After EVERY deployment rerun the HTTP sweep and live repository `_jcr_content.json` check before Stage 4. Reconcile merge-mode stale properties/children/order explicitly with scoped Sling POST when needed; never assume deleted source XML removed live content.

## Deployment And Runtime Sweep

Fetch using approved environment-held credentials plus Referer (never log secrets):

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

## Required Stage Result

Persist the shared envelope with `stage: 03-assets-runtime`, Stage 1/2 result IDs, and:

- **outputs:** `asset_manifest`, `test_build_deploy_results`, `code_assessment_report`, `runtime_assertion_sweep`, `repository_reconciliation`, `clientlib_and_media_report`.
- **checks:** `assets_reachable_and_decoded`, `focused_tests_and_required_builds`, `code_assessment_reviewed`, `packages_and_bundles_active`, `disabled_and_author_runtime_valid`, `target_selectors_resolve_uniquely`, `live_repository_matches_intent`.
- **next_stage:** `04-visual-parity` only on PASS; otherwise null.

Any failed command, HTTP assertion, asset, bundle, content row, or runtime check requires remediation; unavailable external prerequisites are BLOCKED.