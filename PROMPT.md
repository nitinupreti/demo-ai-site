# AEM Component Build Prompt (Design-Source Agnostic)

Use this prompt when you want an agent to turn **any** design source — a Figma
file/link, an exported PDF, a set of screenshots, or a live URL — into a fully
working AEM as a Cloud Service implementation: reusable components, a token
layer, an authored demo page, tests, and a rendered verification pass.

Nothing in this prompt is hard-coded to a specific design, section list, or
component count. Whatever sections the design contains, the agent should
discover them, name them, and build the smallest reusable set that covers them.

---

## Prompt to paste to the agent

> You are working inside an AEM as a Cloud Service Maven project (see
> `AGENTS.md` for module layout and build commands).
>
> **Design source:** `<DESIGN_FILE_OR_LINK>` (Figma URL, `.fig`, PDF, image
> folder, or existing URL). Treat this as the single source of truth for
> layout, copy, imagery, spacing, radii, shadows, and typography.
>
> ### Deliverables
>
> 1. **Design token clientlib** at
>    `ui.apps/src/main/content/jcr_root/apps/<projectPrefix>/clientlibs/clientlib-tokens/`
>    exposing CSS custom properties for:
>    - colors (`--<prefix>-color-*`)
>    - typography (`--<prefix>-font-*`, `--<prefix>-fs-*`, `--<prefix>-lh-*`, `--<prefix>-ls-*`)
>    - spacing scale (`--<prefix>-space-*`)
>    - **radii, including at minimum `sm`, `md`, `lg`, `xl`, `pill`, and `full` (`50%`)**
>    - shadows (`--<prefix>-shadow-*`)
>    - container widths (`--<prefix>-container-*`)
>    - small helper classes (e.g. `.<prefix>-container`, `.<prefix>-eyebrow`)
>    - **global rounded-image rules for Core Components image**
>      (`.cmp-image__image { border-radius: var(--<prefix>-radius-lg); }`) so
>      any authored image inherits the design system's corner treatment
>      without a custom component.
>    Marked `allowProxy="true"`, category `"<projectPrefix>.tokens"`.
>
> 2. **The minimal reusable component set** needed to author every distinct
>    section detected in the design source. Decompose the design into
>    reusable, atomic-intent components (e.g. banner, intro, grid, hub,
>    columns, CTA, footer, etc. — actual names depend on the design). Do
>    **not** limit yourself to a fixed count; do **not** create a component
>    per page section if two sections are structurally the same variant of
>    one component.
>
>    For each component under
>    `ui.apps/src/main/content/jcr_root/apps/<projectPrefix>/components/<name>/`:
>    - `.content.xml` (`cq:Component`, `jcr:title`, `componentGroup="<Project> - Content"`).
>    - `_cq_dialog/.content.xml` — Coral 3 TouchUI dialog with **Properties**
>      and **Style** tabs. Every authorable string, link, image ref, size,
>      alignment, and background token is exposed as a field. For color
>      pickers use a select with a final `other` option that reveals a
>      free-text hex field via `cq-dialog-dropdown-showhide`.
>    - HTL template using `data-sly-test="${model.hasContent || wcmmode.edit}"`
>      to render an author-time placeholder when empty. BEM class names
>      (`cmp-<name>__<element>--<modifier>`). Use `${properties.xxx}` +
>      Sling Model for derived values.
>    - `clientlibs/clientlib-<name>/` with `css.txt`, `js.txt` (may be empty),
>      `dependencies="[<projectPrefix>.tokens]"`, `categories="[<projectPrefix>.<name>]"`,
>      `allowProxy="true"`. CSS must reference only tokens — **no hardcoded
>      colors, radii, spacing, shadows, or font sizes**.
>    - Sling Model at `core/src/main/java/com/<org>/core/models/<Name>Model.java`
>      using `@Model(adaptables = SlingHttpServletRequest.class, ...)`,
>      `@ValueMapValue` (or `@ChildResource` for multifields), plus a
>      `hasContent()` helper.
>    - JUnit 5 test at `core/src/test/java/.../<Name>ModelTest.java` using
>      `com.<org>.core.testcontext.AppAemContext.newAemContext()` and
>      `AemContextExtension` covering: happy path, empty state, style-tab
>      overrides.
>
> 3. **A demo page** at
>    `ui.content/src/main/content/jcr_root/content/<projectPrefix>/us/en/<page>/`
>    that instantiates the components in the exact order shown in the design,
>    with **verbatim copy, imagery, alignment, color, and variant selection
>    from the design source**. Use `demo-ai-site/components/image` (Core
>    Components image) for hero/inline images so the global rounded-image
>    rule applies. Reference DAM assets under
>    `/content/dam/<projectPrefix>/…`.
>
> 4. **OSGi build guardrails.** In `core/pom.xml`, ensure the maven-bundle
>    plugin's `<Import-Package>` widens version ranges for any Adobe/Apache
>    package whose default narrow range can prevent the bundle from
>    resolving against the running SDK. At minimum, force wide ranges when
>    the code uses these packages:
>    ```
>    org.apache.commons.lang3;version="[3,4)",
>    com.day.cq.wcm.api;version="[1.0,2)",
>    *
>    ```
>    Add similar entries for any additional AEM/Sling API used.
>
> ### Process
>
> 1. **Parse the design source.** For Figma links use the Figma MCP
>    (`get_design_context`, `get_screenshot`, `get_variable_defs`). For PDF/
>    image sources, extract page thumbnails and read them with the image
>    viewer. Enumerate every distinct section: layout, imagery, copy,
>    background color, radii, shadow style, typographic hierarchy.
> 2. **Design token pass first.** Extract the shared palette, type ramp,
>    spacing, radii, shadow set. Create the tokens clientlib before any
>    component. Every subsequent CSS file must consume tokens exclusively.
> 3. **Component decomposition.** Group visually/structurally similar
>    sections under a single reusable component with variants (dialog
>    `size` / `variant` selects). A card grid with three visually distinct
>    card shapes is **one** component with three variants, not three
>    components.
> 4. **Author each component** end-to-end (dialog → HTL → CSS → Model →
>    test) before moving to the next. Run `mvn -pl core test` after each
>    component to keep the model layer green.
> 5. **Author the demo page** with real copy/imagery from the design.
> 6. **Build and deploy:**
>    ```
>    mvn install -PautoInstallSinglePackage -DskipTests
>    ```
>    Confirm `Package installed` and `BUILD SUCCESS`. If a bundle stays in
>    `Installed` instead of `Active`, inspect `Import-Package` mismatches
>    and widen bnd ranges accordingly.
> 7. **Verify the rendered DOM.** Fetch the page over HTTP with Basic auth
>    plus a `Referer` header, save the response, and grep the body for
>    every expected BEM root, modifier, and inline `background-color`. Fail
>    the run if any expected class is missing, if `SightlyException` appears,
>    or if any authored copy is absent:
>    ```powershell
>    $pair="admin:admin"; $b64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair));
>    $h=@{Authorization="Basic $b64"; Referer="http://localhost:4502/"};
>    Invoke-WebRequest -Uri "http://localhost:4502/content/<path>.html?wcmmode=disabled" `
>      -Headers $h -UseBasicParsing -OutFile "$env:TEMP\page.html";
>    ```
> 8. **Content redeploy note.** `ui.content` filters typically use
>    `mode="merge"`, so existing pages are **not** overwritten. When
>    updating the demo page after the first install, delete the page node
>    first (Sling POST `:operation=delete` with a CSRF token) and reinstall.
>
> ### Design fidelity checklist (must pass before declaring done)
>
> For each component and for the page as a whole, compare against the
> design source and confirm:
> - [ ] **Layout order and alignment** match the design at desktop width.
> - [ ] **Copy** matches verbatim (title, eyebrow, body, CTA labels, footer
>       address/phone/legal — no invented text).
> - [ ] **Imagery** is authored; hero/inline images render through Core
>       Components image so `.cmp-image__image` supplies rounded corners.
> - [ ] **Radii** come from `--<prefix>-radius-*` tokens. Card corners,
>       image corners, button corners, and any pill/circle avatar shapes
>       exactly match the design (use `--<prefix>-radius-full` for circular
>       avatars/spotlight-style treatments).
> - [ ] **Every variant/shape** shown in the design (e.g. wide hero card,
>       standard card, circular avatar card, split hero, etc.) is
>       represented as a `size`/`variant` option in the dialog and has a
>       matching CSS modifier block.
> - [ ] **Colors** use tokens; custom hex only via the `other` dialog
>       option and applied as an inline `background-color` in HTL.
> - [ ] **Spacing** (section padding, gaps, gutters) uses `--<prefix>-space-*`.
> - [ ] **Typography** uses `--<prefix>-font-*` / `--<prefix>-fs-*`.
> - [ ] **Shadows** use `--<prefix>-shadow-*`.
> - [ ] **All 19+ unit tests pass** (`mvn -pl core test`).
> - [ ] Rendered page grep shows **every** expected BEM root and modifier
>       ≥ 1 and **zero** `SightlyException`.
>
> ### Iteration loop
>
> After the first deploy + grep, re-open the design source and diff it
> against a screenshot of the rendered page. For each mismatch (missing
> variant, wrong shape, wrong copy, wrong image treatment, wrong color):
> 1. Identify whether the fix belongs in the **token layer**, the
>    **component variant CSS**, the **dialog** (missing option), or the
>    **authored content** (wrong copy/variant selection).
> 2. Apply the minimal change at the correct layer.
> 3. Redeploy, delete stale page content if needed, and re-run the grep.
> 4. Repeat until every checklist item passes.
>
> ### Non-goals / do not do
>
> - Do **not** hardcode colors, radii, spacing, font sizes, or shadows in
>   component CSS. Everything flows through tokens.
> - Do **not** create one component per page section when variants suffice.
> - Do **not** invent copy, imagery, or section counts that are not in the
>   design source.
> - Do **not** ship with a bundle in `Installed`/`Resolved` state — it must
>   be `Active`.
> - Do **not** declare done before the rendered-DOM grep passes.
