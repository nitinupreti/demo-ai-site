# AEM Site And Page Migration

## Inputs

```yaml
SITE_URL: "https://credera.com/en-in" # Required entry URL and default source path scope
SITE_URLS: [] # Optional explicit page URLs
SITEMAP_URL: null # Optional explicit sitemap or sitemap-index URL
USE_SITEMAP: auto # auto | always | never
SOURCE_PATH_SCOPE: null # Optional path override; defaults to the SITE_URL path
URL_INCLUDE_PATTERNS: [] # Optional regular expressions matched against absolute URLs
URL_EXCLUDE_PATTERNS: [] # Optional regular expressions matched after includes
MAX_PAGES: null # Optional positive limit; never truncate silently
TARGET_ROOT_PATH: null # Required for multi-page output
TARGET_PAGE_PATH: null # Optional single-page compatibility
# Optional: BREAKPOINTS, EVIDENCE_DIR
```

`SITE_URL` is required and must be readable. It defines the allowed source origin and, unless `SOURCE_PATH_SCOPE` is supplied, the sitemap path scope. Every resolved page URL must be readable or STOP with the failing URL and browser/network evidence. `TARGET_PAGE_PATH` is valid only when the final page set contains exactly one URL.

## URL Set Resolution

Resolve and freeze the complete source page set before Stage 1. Emit a `page_manifest` containing `page_id`, discovered URL, final URL after redirects, discovery source, canonical URL, source-relative path, and target AEM path.

1. Normalize and deduplicate `SITE_URL` and `SITE_URLS`; remove fragments. Explicit URLs are always candidates.
2. When `SITEMAP_URL` is supplied, parse that exact XML document; this explicit input takes precedence over `USE_SITEMAP`. When it is absent and `USE_SITEMAP` is `auto` or `always`, request `<SITE_URL-origin>/sitemap.xml`. A `404` or `410` in `auto` mode means no sitemap and is not a failure. Missing, unreadable, or malformed sitemap data is blocking when `SITEMAP_URL` is explicit or `USE_SITEMAP` is `always`.
3. Support both sitemap URL sets and sitemap indexes. Follow only same-origin child sitemap URLs listed by the selected sitemap/index, prevent cycles, and parse XML structurally. Do not discover pages by following HTML links.
4. Accept only `http` or `https` page URLs on the `SITE_URL` origin. Sitemap pages must be at or below `SOURCE_PATH_SCOPE`, or the `SITE_URL` path when no override is supplied: `/en-in` admits `/en-in` and `/en-in/...`; `/` admits the full origin. Explicit `SITE_URLS` remain eligible outside that path scope, but must use the same origin.
5. Apply `URL_INCLUDE_PATTERNS`, then `URL_EXCLUDE_PATTERNS`, to absolute URLs. Exclude sitemap entries that are non-page resources based on URL and response content type. Record every exclusion and reason.
6. Resolve redirects with Playwright, deduplicate equivalent final/canonical URLs, and retain a deterministic sitemap order. Never silently skip an eligible URL. If `MAX_PAGES` is exceeded, STOP and report the count so the user can narrow filters or explicitly raise the limit.
7. For multiple pages, map the effective source path scope root to `TARGET_ROOT_PATH` and append each normalized source-relative path. Map the scope root itself to `TARGET_ROOT_PATH`. Produce stable, JCR-safe names and STOP on unresolved target-path collisions. For one page, use `TARGET_PAGE_PATH` when supplied; otherwise use `TARGET_ROOT_PATH` plus its source-relative path.

If no usable sitemap exists, process the explicit candidates only. If resolution produces no page URLs, STOP with the sitemap status, filters, and exclusion evidence.

## Objective

Reproduce every page in the frozen `page_manifest` as reusable, authorable AEM as a Cloud Service components: global chrome, all main regions, headless/decorative bands, responsive-only variants, overlays, consent UI, floating utilities, and interactions. Design each component at its first occurrence around a generic semantic role, authored configuration, and reusable variants so later pages can use or safely extend it without cloning page-specific implementations. Linked pages are out of scope unless present in the manifest; rewrite links between manifest pages to their mapped AEM paths and preserve other links as external source URLs.

Deliver Sling Models, HTL, Coral 3 dialogs, BEM CSS, shared tokens, clientlibs, focused tests, deployable assets, policy updates, and one populated AEM page per manifest row. Validate disabled and author modes for every page at every observed breakpoint (default `375`, `768`, `1440`). A successful build is not completion; each page's Visual Parity Gate and the aggregate site gate control completion.

## Stage Router

Read only the reference needed for the active stage. Do not load every reference up front.

Treat `SITE_URL` in each stage reference as the active manifest row's final source URL. Namespace every stage artifact by `page_id`, and include `page_id` plus `source_url` in every stage result. All page results use the same site-level `run_id`.

Process manifest rows sequentially in their frozen order. One page is the active work unit; do not inspect, implement, author, deploy, or validate the next page until the active page reaches its completion checkpoint.

For each active page:

1. **Source discovery and coverage** — read [01-source-discovery.md](01-source-discovery.md). Complete and freeze source evidence for the active page before inspecting its target page.
2. **Reuse, component implementation, and authoring** — read [02-component-authoring.md](02-component-authoring.md). Compare every discovered block with the persistent `component_registry` from completed pages. Reuse a compatible component unchanged first, extend it with backward-compatible authored options or variants second, and create a new generic component only when the recorded contract gap proves reuse or extension incorrect.
3. **Assets, build, deployment, and runtime checks** — read [03-assets-runtime.md](03-assets-runtime.md). Deduplicate shared assets and validate the active populated target page.
4. **Visual parity and remediation** — read [04-visual-parity.md](04-visual-parity.md). Run until every active-page gate passes. If this page changed a component used by a completed page, rerun focused tests and the full visual gate for every affected completed page before proceeding.
5. **Page completion checkpoint** — mark the page `COMPLETE` only when Stages 1–4 pass, all its source blocks are authored, its target page is populated, all current-run evidence is present, and any affected earlier pages pass regression validation. Persist its results and update `component_registry`; only then activate the next manifest row.

After every manifest row is `COMPLETE`, read [05-completion-output.md](05-completion-output.md) and prepare the aggregate completion report. Repeat its required tables and artifacts per page, then report site-wide minima and reconciliation against the frozen manifest.

If a later stage exposes missing or stale evidence, return to the owning stage, refresh that evidence, and continue. Never compensate for missing discovery or content by tuning CSS.

## Non-Negotiable Rules

- `MUST`, `FAIL`, and `STOP` are completion-blocking. STOP only for unreadable/missing sources, conflicting authorities, unresolved external blockers, or explicit user input requirements. Other failures require in-turn remediation.
- Every eligible manifest page must have exactly one populated AEM target page and complete current-run evidence. A page may not be dropped because it is difficult, repetitive, or visually similar to another page.
- Page processing is strictly sequential. Starting work on another page while the active page or an affected earlier-page regression is incomplete is a workflow failure.
- Existing compatible components must be reused. Page names, routes, campaigns, copied markup, or minor visual differences do not justify duplicate components.
- Shared components must remain route-independent: no page-specific component names, BEM classes, Sling Model branches, clientlib selectors, hardcoded content, or path-based styling. Model differences as authored fields, composite multifields, policies, style-system choices, or cohesive variants.
- Extensions required by later pages must preserve existing properties, defaults, markup contracts, and completed-page rendering. If compatibility cannot be preserved without unrelated conditional behavior, create a separately named generic component and record the exact contract gap.
- No visible block may be omitted, including headless blocks such as marquees, tickers, announcement bars, background-media strips, and overlays.
- Every business-editable value must be authored. Do not hardcode copy, links, assets, item counts, or visual choices unless the component contract explicitly permits it.
- Every color role uses a curated token select with `other`; choosing `other` reveals a validated custom-hex field. Models sanitize custom values and HTL exposes them only through protected CSS custom properties.
- Author DAM paths, never remote or temporary URLs. Preserve media class: video remains video, animation remains animation, and a poster is not a substitute.
- Use Playwright/Chromium for live source and target evidence. Property equality alone cannot establish visual parity.
- Every component instance, component-type minimum, page composite, and site-wide page minimum must be strictly `>95%` at every required breakpoint. `95.000%` fails.
- A component passes only when exhaustive source coverage, geometry, property, screenshot, interaction/media, and authorability checks all pass.
- User rejection invalidates the affected evidence and score; recapture and remediate.
- Never modify generated/vendor paths: `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or template `initial`/`structure` trees.

## Required Project Workflows

1. Read `AGENTS.md`, `CLAUDE.md`, and `.aem-skills-config.yaml` when present.
2. Use `create-component` for every Tier 2/3/4 component. Run `code-assessment` on generated Java/OSGi/Maven code before completion.
3. Inspect only manifest page URLs, selected sitemap documents, and exact resources referenced by a manifest page's DOM, CSS, or captured network traffic. Do not crawl HTML links, submit forms, forward cookies, or inspect unrelated embeds.
4. Site modes: use Node.js Playwright/Chromium to open each exact manifest URL and inspect only that page and its referenced resources. The screenshot comparison pipeline MUST run in Node.js. Use locator.screenshot() for component captures, pixelmatch for pixel comparison, and pngjs (preferred) or sharp only for lossless PNG decoding, padding, masks, and side-by-side composition. An alternate-origin resource may be fetched only when its exact URL appears in rendered DOM, computed CSS, or captured network traffic. Never crawl HTML links, submit forms, forward cookies, or inspect unrelated embeds.
5. Keep an inline `design-facts` block current throughout implementation:

```yaml
component_registry:
  - semantic_role: <generic-role>
    resource_type: <resource-type>
    introduced_on_page: <page_id>
    used_on_pages: [<page_id>]
    supported_variants: [<variant>]
    authorable_capabilities: [<field-or-behavior>]
    extension_history: [<page_id>:<backward-compatible-delta>]
reuse_decisions:
  - page_id: <page_id>
    design_block: <generic-role>
    tier: 1|2|3|4
    reuse_target: <resource-type>|null
    gap: none|<why higher reuse tiers fail>
    additions: [<exact deltas>]
template_decision:
  reuse_template: <name>|null
  new_template_gap: none|<reason>
policy_decisions:
  - policy_path: <path>
    additions: [<resource-types>]
instance_authoring_map:
  - page_id: <page_id>
    design_instance: <source selector/heading/rect>
    resource_type: <resource-type>
    parent_path: <editable-container>
    node_name: <semantic-unique-name>
    dialog_values: {<all non-default authored values>}
```

Every implementation and remediation change must trace to this block.

## Execution Discipline

- Freeze the `page_manifest`, then complete its rows one at a time. For each row, finish source discovery before inspecting that row's target so target implementation cannot bias source denominators.
- Parallelize independent reads/downloads only within the active page; never process multiple manifest pages in parallel.
- Keep `component_registry` current after every reuse, extension, or creation decision. Before creating any component, explicitly prove why every registry candidate fails the required semantic, authoring, markup, interaction, or responsive contract.
- A later-page change to a shared component reopens every completed page that uses it. Keep those pages reopened until focused tests, deployment checks, and visual parity pass again with fresh evidence.
- After the first implementation edit, run the cheapest focused executable validation before further edits.
- Keep FileVault validation enabled. Reconcile checked-in content with live repository JSON after deployment because merge-mode packages may preserve stale properties or order.
- Do not finish with missing manifest pages, target-path collisions, missing evidence, unclaimed source regions, failed component rows, or unapproved residual gaps.
