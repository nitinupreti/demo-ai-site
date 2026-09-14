# Verified Project Facts

Repository-verified behaviors that previous runs proved by failure. Read once in Stage 2 before authoring and reuse in Stage 3; treat each row as known, not as something to rediscover. These are facts about THIS repository, never substitutes for stage gates, evidence, or runtime inputs.

Contains no host, port, or credential. Always take those from runtime inputs.

Re-verify a row only when a command contradicts it; then correct the row in the same run.

## Template And Parsys

- The `page-content` editable region is `jcr:content/root/container/container`. Structural children of the outer container (header experience fragment, structural title container) are template-locked. Components authored outside the inner container do not render.
- Create pages with `POST /bin/wcmcommand` (`cmd=createPage`, `parentPath`, `template`, `title`, `label`) so the template materializes its real structure nodes, THEN `:operation=import` components under the inner container. A page created by raw import with arbitrary children under `root` renders nothing.
- `:operation=import` silently creates missing intermediate segments as bare `nt:unstructured` nodes with no `sling:resourceType`. One extra `container` segment produces a stray non-rendering node instead of an error. Confirm the actual depth from a fresh `.infinity.json` before posting; do not trust a saved snapshot's indentation.
- `:order=before <sibling>` returning 409 usually means the parent path did not exist at request time, not that ordering is unsupported. Retry against the verified parsys path.

## Component Reuse Screening

Some `ui.apps` component folders contain only `_cq_dialog/` and `clientlibs/` with no `.content.xml` resource type and no HTL. They render nothing and are NOT Tier 1 reuse candidates; treat them as Tier 4 work. Derive the current list with one glob over `ui.apps/src/main/content/jcr_root/apps/*/components/*` rather than assuming a component exists because its folder does.

Core-backed project components that ARE authorable have both a `.content.xml` with `sling:resourceSuperType` and either their own HTL or a Core supertype that supplies it.

## Core Component Property Gotchas

| Component | Correct property | Failure when wrong |
|---|---|---|
| Title v3 | `jcr:title` | `text` is ignored; every title silently renders the page title |
| Button v2 | `jcr:title` | `text` leaves the label empty; the link still works |
| Text v2 | `text` + `textIsRich` | — |
| Teaser v2 | `jcr:title`, `description`, plus explicit `titleFromPage=false` and `descriptionFromPage=false` with `@TypeHint=Boolean` | Both flags default to true when absent, so authored values are ignored and the page title renders |
| Image v3 | `fileReference` + `alt` | For non-decorative images the rendered `alt`/`title` come from DAM metadata (`dc:title`), not the authored `alt` |

A freshly uploaded DAM asset renders through its original rendition immediately; no wait for asset processing is required for Image v3.

## Sling POST And Assets HTTP API

- Every write needs BOTH a `CSRF-Token` header from `/libs/granite/csrf/token.json` AND a `Referer` header. This includes DAM upload via `POST <damFolder>.createasset.html` with a multipart `file` part.
- CSRF tokens expire in roughly ten minutes. Re-fetch immediately before each POST batch.
- Create a child with the parent's `/*` endpoint plus `:name=<child>`. POSTing the parent path updates the parent itself.
- Multipart `:operation=import` (`:contentType=json`, `:content` as a file part) reliably authors a whole nested component tree in one call.

## Packages, Clientlibs, And Build Hygiene

- `ui.content` installs in FileVault `merge` mode: removing a node from source XML does not delete it from a modified parent. Reconcile deletions and stale properties explicitly with scoped Sling POST.
- The site CSS baseline is the webpack-built `demo-ai-site.site` clientlib (source `ui.frontend/src/main/webpack/site/`). The template policy loads it AFTER `demo-ai-site.base`, so any `body` rule in the base clientlib loses. To make design tokens win: add the tokens clientlib to the site clientlib `dependencies`, rewrite the checked-in `body, html` rule to read `var(--*)`, and update the SCSS source so the next frontend build does not regress it.
- No routine `mvn clean`. `ui.apps/target` commonly holds file locks after a deploy.
- A stale `ui.apps/target/generated-sources/htl` produces `cannot find symbol` compile errors naming model classes that do not exist in source. Delete only the implicated generated output, then retry the scoped deploy.

## Tooling Behavior

- Quote dotted Maven properties in PowerShell, for example `"-Dvault.skipValidation=true"`.
- Write anything beyond a trivial one-liner to a script file under the evidence or scratch directory and invoke it by path; inline multi-line shell input is frequently truncated to its first line here.
- A dedicated Node.js Playwright runner honors `setViewportSize` for `innerWidth`, `getBoundingClientRect`, `getComputedStyle`, and clipped screenshots. A shared editor browser page can silently ignore it and collapse the emulated viewport. Read back `window.innerWidth`/`innerHeight` after every viewport change and reject any capture that disagrees with the requested breakpoint.
- Inside the browser evaluation sandbox there is no filesystem access; land captures on disk with `page.screenshot({ path: <absolute path> })`.
