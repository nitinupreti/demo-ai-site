================================================================
# DESIGN_SOURCE — provide AT LEAST ONE of the following. Both may be provided (see "Input modes" for precedence).
FIGMA_URL:   "<paste a figma.com/design/… or figma.com/board/… URL here — must include node-id for the frame to build>"
DESIGN_FILE: <path to a .pdf or .fig exported from Figma>
# Optional companion assets (any that exist — use if present, ignore if absent):
#   DESIGN_SCREENSHOTS_DIR: <path to a folder of .png / .jpg frame exports>
#   DESIGN_SVG_DIR:         <path to a folder of .svg exports>
#   DESIGN_TOKENS_JSON:     <path to a Figma-exported tokens/variables .json>
#
# This prompt is design-agnostic. Do NOT hardcode component names, counts, tokens,
# or copy from any previous run. Every decision below must be derived from the
# DESIGN_SOURCE the caller supplies. If FIGMA_URL is left as the placeholder text
# above, STOP and ask the user to provide a real URL or DESIGN_FILE.

# Build every AEM component required to author the page defined in DESIGN_SOURCE

## Goal
Build every reusable AEM as a Cloud Service component (Java stack, Sling Models, HTL, Granite UI Coral 3, BEM CSS, design tokens) required to author the page shown in DESIGN_SOURCE. When those components are dragged onto a real page and populated with the design's content, the rendered result MUST match the design pixel-for-pixel: layout, spacing, typography, color, radius, shadow, iconography, responsive behavior, interaction states, per-instance alignment, offset, and outer gutter.

Discover everything else — component list, dialog fields, variants, tokens, breakpoints, build commands, package prefix, module layout, content root — from DESIGN_SOURCE (+ optional companion assets) and from the repo. Do not hardcode assumptions about counts, names, or types.

## Input modes
- **Mode A — Figma URL (`FIGMA_URL` set):** use the Figma MCP tools (`get_design_context`, `get_metadata`, `get_screenshot`, `get_variable_defs`, `download_assets` / `upload_assets`) as the authoritative source. Parse the URL per A14 to derive `fileKey` + `nodeId`. Preferred when reachable, because vector geometry, variables, and typography are exact.
- **Mode B — Local design file (`DESIGN_FILE` set):** parse the local PDF (or fall back to a `.fig` per the format rules) plus any companion assets. Use when the environment has no Figma MCP access, when the file is confidential, or when the URL is stale.
- **Mode C — Both set:** Figma MCP is authoritative for vector geometry, variables/tokens, and per-node measurements; the local PDF is used as a safety net for text extraction, offline diffing, and reproducibility. If the two disagree, prefer Figma MCP but flag the discrepancy in the Final summary.
- **Neither set → STOP** and ask the user for one of the two.

## Accepted design-source formats
- **Figma URL** (Mode A): a `figma.com/design/…` or `figma.com/board/…` URL pointing at the frame(s) or file to build. Requires an available Figma MCP server. Preferred when reachable — vector geometry and variables are exact.
- **PDF** (Mode B primary): parseable for text, fonts, colors, geometry, and per-page frames. Read with local PDF tooling (e.g. `pdftotext`, `pdfimages`, `pdftocairo`, or a PDF library). One PDF page per Figma frame is the expected export shape.
- **`.fig` file**: Figma's proprietary binary/zip format. It cannot be parsed by ordinary tooling — only the Figma desktop app can open it. If only a `.fig` is provided and no `FIGMA_URL`, STOP and ask the user to either supply the Figma URL OR export a PDF (File → Export frames to PDF) and, ideally, PNG frame exports. Do not attempt to guess the design's contents from the `.fig` alone.
- **PNG / JPG screenshots** (companion): use for visual reference, per-instance spatial diffs, and to disambiguate what the PDF geometry describes. Also produced on-demand from `get_screenshot` when in Mode A.
- **SVG frame exports** (companion): use for exact vector geometry, gradients, and icon paths when available. In Mode A, `download_assets` produces these on demand.
- **Tokens JSON** (companion): if the user exported Figma variables/tokens, use it as the authoritative source for the shared design-tokens clientlib in Step 3. In Mode A, `get_variable_defs` returns the same information live.

## Mandatory skills / tools (must be used, not paraphrased)
- **create-component skill** — invoke ONCE per discovered component. It owns the full deliverable set: component `.content.xml`, `_cq_dialog/.content.xml`, HTL, Sling Model + JUnit test, per-component clientlib with the project's design-tokens clientlib as a dependency.
- **Figma MCP tools** — USE WHEN `FIGMA_URL` IS SET (Mode A or C). Load `/figma-design-to-code` skill first. Then call `get_design_context` (primary — returns geometry, variables, tokens), `get_metadata` (component tree), `get_screenshot` (per-node PNGs), `get_variable_defs` (design tokens), `download_assets` (SVG icons, raster images). Treat the response as a REFERENCE to adapt to the project's tokens/components, not final code. Do NOT invoke Figma MCP in Mode B (no URL provided).
- **Local design-file parsers** — USE WHEN `DESIGN_FILE` IS SET (Mode B or C). For PDFs: extract text + fonts + colors + per-element geometry per page; extract embedded images; render page thumbnails if visual diffing is needed. For PNG/JPG/SVG: read directly from the filesystem. Record raw values; do not paraphrase.
- **Repo agent docs** — read FIRST (AGENTS.md, CLAUDE.md, README.md) to discover build command, module layout, package prefix, component group, tokens clientlib category, per-component clientlib naming convention, and content root path.

## Rules (must follow)
- **Source of truth is DESIGN_SOURCE** — `FIGMA_URL` (Mode A), `DESIGN_FILE` (Mode B), or both (Mode C, Figma MCP wins per "Input modes"). When the design and existing code disagree, the design wins.
- Build reusable, author-friendly components: every visual variant that appears in the design becomes a dialog select / checkbox / numeric input, not a duplicate component.
- Discover the component list from the design — do not assume a fixed count or set of names.
- Establish/refresh shared design tokens first (colors, typography scale + line-heights + letter-spacing, spacing scale, radii, shadows, container widths, breakpoints, positional-offset scale). Prefer the exported tokens JSON if present; otherwise derive tokens from the PDF's repeated values. Reuse existing tokens; **never hardcode a px/hex/font value that a token already covers.**
- Vanilla CSS only inside the existing clientlib structure. No Tailwind, React, CSS-in-JS, or new build tooling.
- Use BEM: `.cmp-<name>__<el>--<mod>`.
- Never modify `target/`, `dist/`, `node_modules/`, `.m2/`, or Core Component libraries.
- No remote / temporary asset URLs — images route through Core Image / DAM references. Upload the design's embedded images (extracted from the PDF/SVG or supplied in the screenshots folder) to `/content/dam/<project>/design/` and reference them by DAM path.
- Every component renders a friendly empty-state placeholder inside a clickable wrapper in edit mode: `!model.hasContent && wcmmode.edit`.
- Static labels use i18n: `${'…' @ i18n}`.
- No new abstractions for one-time operations. Never add a field "in case an author wants it" — every field must correspond to a variant actually visible in the design.
- If the design demands a value no token covers, prefer adding one shared token over hardcoding; use a free-form hex override (see "Other" rule) only for genuine one-off exceptions.
- Reuse Core Component supers wherever the design allows.
- Ask for clarification ONLY if DESIGN_SOURCE is missing (neither `FIGMA_URL` nor `DESIGN_FILE` set), the `FIGMA_URL` is unreachable AND no `DESIGN_FILE` is supplied, `DESIGN_FILE` is unreadable, a `.fig` is supplied without a Figma URL or PDF companion, or a specific page/frame/node that neither Figma MCP nor the parser can resolve; otherwise proceed autonomously.

## Dialog authoring contract (atomic-intent)
- **One authoring concept → one field.** If two properties always change together, merge them into a single select. If they vary independently, keep them separate (see Direction vs. Amount below).
- Every enumerated field has a sensible `value` default so an empty-authored component still renders correctly.
- Required fields get `required="{Boolean}true"`; non-obvious fields get a `fieldDescription`.
- **Color-like properties** offer a curated palette + an `"other"` option that reveals a free-form hex/CSS textfield via `cq-dialog-dropdown-showhide`. This is what makes pixel-perfect matches possible when the design uses a color outside the token palette.
- **Repeating elements** (buttons, links, list rows, chips) belong in `granite/ui/components/coral/foundation/form/multifield` with `composite="{Boolean}true"` whose child is a `container` of sub-fields. Each sub-field is an authorable atom — e.g. a CTA row = `ctaTitle` textfield + `ctaLink` pathfield, never a plain text label when the design shows a link.
- **Image sources** use `pathfield` with `rootPath="/content/dam"`, not the Core Image proxy, unless rendition/lazy-crop behavior is required.
- **Tab layout:** content (text, image, links) → **Properties** tab; visual-only choices (color, alignment, density, side, offset, gutter) → **Style** tab.
- **Direction vs. Amount:** if "which side" (e.g. `imagePosition: left|right`) AND "how much" (e.g. `horizontalOffset: none|sm|md|lg`) each vary independently, they are two fields. Direction drives `justify-content` / `flex-direction` / `grid-template-areas`; amount drives a scoped CSS custom property. When amount is `none`, CSS forces center regardless of direction. **Counter-case:** if "hug side" and "image side" always mirror together as one flip, encode as one atomic select — do not split.

## Sling Model contract
- `@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)`.
- One `@ValueMapValue` per dialog field with `@Default` values that mirror the dialog defaults exactly.
- Multifield → `@ChildResource` returning `List<ChildItemModel>`. Child `@Model` exposes `hasContent()` (true only when required sub-fields are non-blank); filter empty items in `@PostConstruct`.
- Expose `getBackgroundStyle()` returning `"background-color: <hex>;"` ONLY when the color select is `"other"` AND the hex field is non-blank; otherwise `null`. HTL consumes it via `context='styleString'`.
- Expose `isHasContent()` — true when the component has any renderable content. HTL uses it for the empty-state placeholder.
- Never leak implementation-only properties (e.g. `imagePosition` + `horizontalOffset` + `sideGutter`) through the model API — the model exposes the same clean concepts the dialog does.

## HTL contract
- Root: `<section class="cmp-<name> cmp-<name>--<enum1>-${model.enum1} cmp-<name>--<enum2>-${model.enum2}" style="${model.backgroundStyle @ context='styleString'}">`.
- Always use context annotations: `@ context='attribute'` for attribute values, `@ context='uri'` for links/images, `@ context='styleString'` for inline styles.
- Include the per-component clientlib via
  `<sly data-sly-use.clientlib="/libs/granite/sightly/templates/clientlib.html"><sly data-sly-call="${clientlib.css @ categories='<clientlib-category>'}"/></sly>`.
- Guard every optional block with `data-sly-test`.
- Empty state: render placeholder only when `!model.hasContent && wcmmode.edit`.

### HTL iteration rule (prevents a whole class of runtime bugs)
- `data-sly-list` iterates the HOST'S CONTENT — host rendered once, children repeated N times. Use when the host is a container (`<ul>`, `<ol>`, `<div class="…__list">`, `<tbody>`) with exactly ONE child template inside.
- `data-sly-repeat` iterates the HOST ITSELF — host + contents repeated N times. Use when the host IS the per-item element (`<li>`, `<article>`, `<tr>`, `<figure>`, card/tile/tab wrappers).
- Equivalent to `data-sly-repeat`: wrap the per-item element in `<sly data-sly-list.<var>="${...}">…</sly>`.
- **Decision rule:** if CSS/JS relies on one DOM node per item (per-item modifier classes, `data-index`, sibling selectors, `nth-child`, `querySelectorAll` returning N), the loop is on a container whose only child is that element, OR uses `data-sly-repeat` on the element itself. Never both.

Anti-pattern to flag in code review — putting `data-sly-list` on the per-item element causes every iteration's markup to render **inside a single host element**, silently breaking interactive components (accordions, tabs, carousels) whose JS assumes one DOM node per item:
```html
<!-- BROKEN: renders ONE <li> containing N buttons + N panels.
     querySelectorAll('.cmp-x__item') returns 1, not N.
     Only the first item can be toggled; siblings are collateral. -->
<ul class="cmp-x__list">
    <li class="cmp-x__item ${itemList.first ? 'cmp-x__item--active' : ''}"
        data-sly-list.item="${model.items}">
        <button class="cmp-x__header">${item.title}</button>
        <div class="cmp-x__panel">${item.body}</div>
    </li>
</ul>

<!-- FIXED: renders N <li> elements, one per item. -->
<ul class="cmp-x__list">
    <li class="cmp-x__item ${itemList.first ? 'cmp-x__item--active' : ''}"
        data-sly-repeat.item="${model.items}">
        <button class="cmp-x__header">${item.title}</button>
        <div class="cmp-x__panel">${item.body}</div>
    </li>
</ul>
```

### Interactive-component contract (accordion, tabs, carousel, modal, disclosure, toggle)
Any component whose design shows an interactive state change (open/close, active/inactive, sliding, expand/collapse, hover-persistent, click-driven) MUST satisfy every item below. The rendered-DOM check in the verification step is not enough — the interactive behavior itself must be smoke-tested.

- **Hook the JS via a root data attribute**, not a class: `<section data-cmp-is="<name>">…</section>`. Component JS queries `document.querySelectorAll('[data-cmp-is="<name>"]')` and initialises each root independently. Never use the BEM class as the JS hook, because visual-only refactors of the class would silently break behaviour.
- **Scope every query to the root**: `root.querySelectorAll('.cmp-<name>__item')`, never `document.querySelectorAll`. Multiple instances of the same component on the same page MUST NOT interfere with each other.
- **Idempotent init**: skip if `root.getAttribute('data-cmp-initialized') === 'true'`; set the attribute before wiring listeners. Prevents double-binding when the Universal Editor / Page Editor re-renders the fragment.
- **Load JS through the per-component clientlib** (`js.txt` + `js/<name>.js`). The clientlib folder's `.content.xml` sets `jsProcessor="[default:none,min:none]"` alongside `cssProcessor` and lists the same category the site clientlib embeds.
- **HTL iteration rule (above) MUST hold**: rendered DOM has ONE node per item. Verify by counting `.cmp-<name>__item` occurrences in the deployed HTML — must equal `getItems().size()`.
- **Initial state matches the design frame**: if the design shows one panel open at load, one tab active, or a specific slide index, encode that as either a per-item `openByDefault` dialog field OR a rule such as "first item is active" implemented via the iteration index (`itemList.first`) and reflected in both the class list AND `aria-expanded` / `aria-selected` / `aria-current` attributes at render time — never solely in JS after DOMContentLoaded.
- **Accessibility floor** for every state toggle: `<button type="button">` (never `<div onclick>`), `aria-expanded` / `aria-selected` / `aria-controls` on the trigger, `role="region"` / `role="tabpanel"` and `aria-labelledby` on the panel, focus-visible outline preserved, keyboard operable (Enter / Space activate the toggle by virtue of being a button; arrow keys navigate between siblings for tab-like components).
- **No inline event handlers, no globals**: JS lives inside an IIFE (`(function(){ 'use strict'; … })();`) or ES module. Register on `DOMContentLoaded` if `document.readyState === 'loading'`, otherwise init immediately.
- **Smoke test in the verification step**: after deploy, in addition to the rendered-DOM check, fetch the deployed component JS from the clientlib URL and grep for the expected symbols (`data-cmp-is`, `data-cmp-initialized`, the toggle class name). Then, if a headless browser is available, open the page, click the first trigger, and assert the panel becomes visible / the class changes. If no browser is available, at minimum assert the JS URL returns 200 and the JS body contains the expected initialisation function.


## Per-instance spatial-authoring rule (MANDATORY)
For every component whose design frame shows any of these, the property MUST be a per-instance dialog field (never baked into a single fixed CSS value):
- Alternating horizontal offset (zig-zag, staggered stacks, asymmetric side margin, alternating card side).
- Variable outer padding / side gutter between the component and the page edge.
- Variable top/bottom section padding.
- Alignment (left/center/right) of the component within the page container.
- Vertical stagger between sibling instances.
- Column order swap (image side, feature side, alternating orientation).
- Any spacing token whose value visibly changes between sibling instances of the same component.

**Contract:**
- Dialog field: select with token-named options (`none / sm / md / lg`) or numeric input bound to a defined scale. Include `fieldLabel`, `fieldDescription`, sensible default matching the most common Figma instance.
- Sling Model: matching `@ValueMapValue` with `@Default(values="…")` and a getter.
- HTL root appends `cmp-<name>--<field>-${model.<field> @ context='attribute'}`.
- CSS: the modifier class sets a scoped CSS custom property (e.g. `--cmp-<name>-offset`); every layout property that depends on the value reads that custom property. Never bind the layout property directly to the modifier class if two+ properties (max-width calc, padding, margin-inline-*, justify-content) react to the same value.
- Responsive collapse: tablet/mobile media queries reset the per-instance custom properties to neutral defaults so the design collapses to a centred column.
- Sample content authors each sibling instance with the EXACT per-instance values the design shows.

**Sanity check:** if the design shows N sibling instances at N different positions/paddings/alignments, the rendered demo page shows those same N distinct values — never N identical instances collapsed to a shared default.

## CSS contract (BEM + tokens)
- One CSS file per component under `ui.apps/.../clientlibs/clientlib-<name>/css/`, wired via `css.txt` and a `.content.xml` clientlib category matching the HTL include.
- One selector per modifier class. Do not stack unrelated concerns in the same selector.
- For "card hugs one side" layouts, use `justify-content: flex-start` / `flex-end` (or CSS grid `justify-self`) driven by the modifier class — NOT margins, translates, or negative offsets. The card's `max-width` = `calc(var(--das-container-max) - var(--das-space-N))` where N matches the desired empty gutter.
- For "image on the other side" variants, swap `grid-template-areas` (or `flex-direction: row-reverse`) in the modifier class. Never duplicate the whole component's rules.
- Include a tablet (`≤1024px`) breakpoint that collapses side-by-side layouts to stacked+centered, and a mobile (`≤640px`) breakpoint that reduces padding. If DESIGN_FILE contains multiple frames at different widths, use those widths as the breakpoints instead.
- Only reference existing tokens (`--das-space-*`, `--das-color-*`, `--das-radius-*`, `--das-container-max`, etc.). If the design demands a value no token covers, add a new token or use the free-form hex field — never hardcode literals in component CSS.

## Unit-test contract
JUnit 5 + wcm.io AEM Mocks, one test class per component using `AppAemContext.newAemContext()`:
- **`defaultsWhenEmpty`**: adapt an empty resource; assert every default value, `getBackgroundStyle()` returns `null`, multifield lists are empty, `isHasContent()` matches the empty-state expectation.
- **`configuredFully`**: resource with every field set including a non-default color = `"other"` + valid hex + populated multifield; assert every getter and that `getBackgroundStyle()` returns the exact `"background-color: <hex>;"` string.

Run `mvn -pl core clean test -Dtest=<ModelName>Test` FIRST and fix any failures BEFORE deploying.

## Content-package gotcha (read this before troubleshooting "why don't my edits show up")
The project's `ui.content` filter typically uses `mode="merge"`, which ONLY ADDS missing nodes — it does NOT update properties on existing nodes. If you change the schema of a component that already has authored instances, redeploying `ui.content` silently leaves the old properties in place and the rendered page looks unchanged.

Recovery in order of preference:
1. Delete each stale instance node via Sling POST, then redeploy.
2. Or temporarily switch the affected filter entry to `mode="update"`, deploy, then revert.
3. Or re-author the component through the dialog (writes the new properties directly).

For net-new sample content that never existed, plain `merge` works fine.

## Step 0 — Discover
- Read repo agent docs → capture build command, module layout, package prefix, component group, tokens clientlib category, per-component clientlib naming convention, content root path.
- **Determine mode** (A / B / C) from which of `FIGMA_URL` and `DESIGN_FILE` are set. If neither, STOP and ask.
- **Mode A or C (Figma URL set):** parse the URL per A14 → `fileKey`, `nodeId`, `branchKey` (if any), surface (`design` / `board` / `make` / `slides`). Load the `/figma-design-to-code` skill. Call `get_metadata` for the component tree, then `get_design_context` for each top-level frame to capture geometry + text + variables. Call `get_variable_defs` for the token layer. Call `download_assets` to pull every SVG icon and raster image into a local scratch folder (they will be uploaded to DAM in Step 9). If any node cannot be resolved, ask the user for the specific `node-id`.
- **Mode B or C (DESIGN_FILE set):** resolve DESIGN_FILE on the filesystem. Confirm the file exists and is readable. If it is a `.fig` and there is no `FIGMA_URL`, STOP and ask for a PDF export or a URL (see "Accepted design-source formats"). If it is a PDF, record the page count and each page's pixel/point dimensions. Enumerate every companion asset (screenshots, SVGs, tokens JSON) that is present. Parse DESIGN_FILE: extract per-page text runs (with font family, weight, size, line-height, color), vector shapes (with fill, stroke, radius, position, size), and embedded images (write each to a local scratch folder for later DAM upload). If a tokens JSON is provided, load it as-is.
- **Record raw values; do not paraphrase.** In Mode C, when Figma MCP and the PDF disagree on a value, log both and prefer the Figma MCP value; flag the discrepancy in the Final summary.

## Step 1 — Decompose the design
For every distinct reusable section/block visible in DESIGN_FILE, capture:
- Semantic kebab-case name.
- All variants/modifiers visible in the design — these become dialog selects per the Dialog authoring contract.
- Author-editable fields (text, rich text, image, link, path, multifield of child items).
- Any interactive state (tabs, carousel, accordion) and its initial/active behavior. If DESIGN_FILE is a static PDF/PNG that cannot express interaction, infer state from repeated frames, adjacent hover/active/focus artboards, or annotations visible on the page; document each inference inline.
- Repeating children → composite multifield with a dedicated child Sling Model.

## Step 2 — Extract design facts per component (per-instance comparison required)
For every component in DESIGN_FILE, record before editing:
- Outer container width, horizontal page gutter (per instance if it varies), section top/bottom padding.
- Internal grid/flex gaps, per-element padding & margin.
- Border-radius, border, shadow.
- Font family + fallbacks, weight, size, line-height, letter-spacing per text style.
- Exact color hex / opacity for background, text, borders, accents.
- Icon dimensions, image aspect ratio, object-fit intent.
- Hover / active / focus state hints visible in the design (adjacent frames, annotation callouts, or overlay artboards).
- Responsive intent if multiple frame widths exist in DESIGN_FILE; otherwise document the assumption inline as a CSS comment.
- **Per-instance spatial deltas** — if the same component appears N times across DESIGN_FILE, measure each instance's horizontal offset, vertical stagger, alignment, side padding, column order. Every non-zero delta becomes a dialog field per the per-instance spatial-authoring rule.

When the PDF's parsed geometry is ambiguous, cross-check against the matching PNG screenshot at the pixel level; when it still cannot be resolved, ask the user for one clarifying screenshot rather than guessing.

## Step 3 — Establish shared design tokens
Create or update the shared tokens clientlib (using the project's naming convention). If DESIGN_TOKENS_JSON is present, treat it as authoritative and map its variables 1:1 to CSS custom properties. Otherwise, derive tokens from the values captured in Step 2. Add tokens for every unique value — including spatial-offset tokens so per-instance authoring options map to a consistent token vocabulary across components.

## Step 4 — Create every component via the skill (one invocation per component)
For each component from Step 1, invoke the create-component skill with a spec including: name, group, dialog fields (correct types + required flags + defaults + fieldDescriptions), variants/modifiers including every per-instance spatial field and every color's `other`/hex escape hatch, Properties vs. Style tab split, tokens to consume, breakpoints, interactive behavior. The generated per-component clientlib depends on the shared design-tokens clientlib. The generated Sling Model / HTL / CSS / test satisfy their respective contracts above.

## Step 5 — Per-component CSS parity pass (with sibling-comparison checklist)
Apply design-derived values using tokens. Verify outer padding, container max-width, gutters, card inner padding, radius/background/border/shadow, every variant, pill/label/chip sizing, typography per element, and responsive behavior at each design-defined breakpoint. For any component that renders multiple times on the page:
- Line up the N instances in DESIGN_FILE and diff their positions (horizontal offset, vertical stagger, alignment, side margin, column order, outer gutter).
- For every non-zero delta, confirm dialog field + BEM modifier + CSS custom property + at least one layout property reading that custom property.
- Confirm tablet/mobile media queries reset per-instance custom properties to a neutral centred default.

## Step 6 — HTL structural validation (mandatory before Step 7)
For every component with ANY multifield or list, apply the HTL iteration rule and confirm the host element matches its intended semantic role. Every per-item element JS or CSS addresses individually carries `data-index="${itemList.index}"` or an equivalent stable identifier. After Step 9 install, verify the rendered DOM contains N sibling per-item elements where N is the authored multifield item count.

## Step 7 — Interaction correctness (stateful components only)
- Scope all DOM queries to the component root, never `document`.
- On state change, clear active class / `aria-selected` on all sibling items inside that root, then apply only to the target.
- Support multiple instances on one page independently.
- Guard against double-initialization (`data-cmp-initialized`).
- Keep the first item active on initial render.

## Step 8 — Wire clientlibs
Every per-component clientlib depends on the shared tokens clientlib. Site-level wiring (embed OR HTL `clientlib.css`/`clientlib.js` include) is in place so authors get all styling on any page without extra work.

## Step 9 — Author a demo page to prove parity
Under the project's content root, create a sample page and drop the components in DESIGN_FILE's reading order, populated with the design's actual copy and images. Upload every extracted image from Step 0 to `/content/dam/<project>/design/` and reference them from `ui.content`; use DAM placeholders only where an asset is truly missing. When DESIGN_FILE shows the same component repeated with alternating variants, the demo page authors those EXACT variants — including per-instance offset, gutter, alignment, and section padding values — in the same order so the rendered result matches the design's zig-zag / alternating pattern instance-for-instance. Author under the template's editable region path (inner responsive-grid container, NOT directly under the page's root node). If components author correctly in the JCR but do not render, the authored path does not match the template's structure — fix the content path before continuing. If sample instances overwrite existing authored content, obey the Content-package gotcha above.

## Step 10 — Build, install & verify (rendered-DOM check is mandatory)
- Run `mvn -pl core clean test` first. Must be green before deploying.
- Run the project's standard local install command (`mvn install -PautoInstallSinglePackage -DskipTests` or equivalent from AGENTS.md). Must end in BUILD SUCCESS with 0 analyser warnings.
- **Fetch the demo page** via HTTP GET with `?wcmmode=disabled`, Basic auth `admin:admin`, and a `Referer` header, and confirm:
  a. Every authored component instance appears in the response body (grep for its BEM root class).
  b. For every list-driven component, sibling per-item element count == authored multifield item count.
  c. For every stateful component, exactly ONE per-item element has the initial `--active` modifier and matching `aria-selected="true"`.
  d. For every per-instance spatial field, grep the response for each variant modifier class (e.g. `--offset-lg`, `--gutter-md`, `--align-left`, `--side-right`) and confirm the count of each variant matches DESIGN_FILE — never N identical instances where the design shows N distinct values.
  e. For every color select that used the `other` + hex escape hatch, confirm `style="background-color: #…"` appears inline on the root.
- **Fetch the deployed per-component clientlib CSS** (`/etc.clientlibs/<project>/clientlibs/clientlib-<name>.css`) and confirm all modifier rules for the spatial fields and variant classes are present (defensive check the CSS was rebuilt, not served from stale cache).
- Open the demo page in the browser and compare side-by-side with the design at its native width (open the PDF page or the matching screenshot), then at each smaller breakpoint. Verify sibling instances land at their design-specified positions, gutters, and alignments.
- Open the same page in edit mode and confirm every component is author-friendly (empty-state placeholders render, dialogs open, no console errors).
- Iterate on tokens + component CSS until parity is reached. Do not modify unrelated components.

## Deliverables checklist (per component)
- [ ] `_cq_dialog/.content.xml` — Properties + Style tabs, dropdown-showhide for `other` color, multifield for repeating rows, required flags, field descriptions
- [ ] `<ComponentName>Model.java` + one child `@Model` per multifield type, with `getBackgroundStyle()` and `isHasContent()`
- [ ] `<component>.html` — BEM classes, context annotations, empty state, clientlib include, correct `data-sly-list` vs. `data-sly-repeat` choice
- [ ] `clientlibs/clientlib-<name>/` — `.content.xml` (category + dependency on tokens clientlib), `css.txt`, `css/<component>.css`
- [ ] `<ComponentName>ModelTest.java` — `defaultsWhenEmpty` + `configuredFully` tests
- [ ] Sample authored instances in `ui.content` demonstrating every variant visible in DESIGN_FILE (including any zig-zag / alternating layout), authored under the template's editable region path
- [ ] Verified: model tests green, page HTML contains every expected modifier class and inline `background-color` where applicable, clientlib CSS contains every modifier class

## Final summary to post
- Component decomposition (name → dialog fields → variants, including every per-instance spatial field and every color-with-`other` escape hatch).
- Skills invoked and for which components.
- Design inputs consumed: DESIGN_FILE (path, format, page count) and every companion asset used (screenshots, SVGs, tokens JSON).
- Shared tokens created/updated.
- Every per-component file set produced (paths).
- HTL iteration audit.
- Per-instance spatial-field audit (per component: dialog field → BEM modifier → CSS custom property → which layout properties consume it, and the sibling-comparison result from Step 5).
- Unit-test results (`defaultsWhenEmpty` + `configuredFully` per component).
- Rendered-DOM check results (per-item sibling counts, per-variant instance counts, inline `background-color` presence).
- Deployed-clientlib check result.
- Interaction-bug guards applied.
- Demo page path.
- Build status.
- Any residual gaps that require additional design frames, a clearer screenshot, a re-exported PDF, or `ui.content` `merge`-mode recovery (deleted stale nodes / temp `update` mode / re-authored via dialog).

## Addendum — Field-tested recipes (append-only; do not override earlier rules)
These are concrete recipes distilled from prior runs on this repo. They REFINE — never contradict — the rules above. If any earlier rule conflicts with an item here, the earlier rule wins.

### A1. Concrete Sling POST recovery for the Content-package gotcha
When `ui.content` uses `mode="merge"` and a stale authored node must be dropped so the redeploy can re-seed it, the delete request MUST carry a CSRF token or AEM returns HTTP 403. Recipe (PowerShell, local SDK):
```powershell
$base = 'http://localhost:4502'
$cred = New-Object System.Management.Automation.PSCredential 'admin', (ConvertTo-SecureString 'admin' -AsPlainText -Force)
$csrf = (Invoke-RestMethod -Uri "$base/libs/granite/csrf/token.json" -Credential $cred -Authentication Basic).token
Invoke-WebRequest -Uri "$base<path-to-stale-node>" `
  -Method Post `
  -Credential $cred -Authentication Basic `
  -Headers @{ 'CSRF-Token' = $csrf; 'Referer' = "$base/" } `
  -Body @{ ':operation' = 'delete' }
# expect: StatusCode 200. Then rerun `mvn install -PautoInstallSinglePackage -DskipTests -pl all -am`.
```
Do this ONLY for demo/sample nodes the agent owns. Never delete customer-authored content without explicit user consent.

### A2. Rendered-DOM verification recipe (Step 10 helper)
The mandatory rendered-DOM check in Step 10 is executed with the same auth + Referer combo:
```powershell
$out = "$env:TEMP\demopage.html"
Invoke-WebRequest -Uri "$base<demo-page-path>.html?wcmmode=disabled" `
  -Credential $cred -Authentication Basic `
  -Headers @{ 'Referer' = "$base/" } `
  -OutFile $out
# Then grep the file for each expected BEM modifier class and each design-copy string.
Select-String -Path $out -Pattern 'cmp-<name>__<el>--<variant>' | Measure-Object | % Count
```
Counts must equal the number of authored instances of that variant, per Step 10 rule (d). A `SightlyException` match count MUST be zero.

### A3. Design is authoritative — no assumed styling, no invented variants
Never introduce a visual treatment (border-radius, shape, shadow, spacing, color, layout variant, image crop, aspect ratio, etc.) that is not directly observable in DESIGN_FILE. Do not "improve", "round off", "modernize", or infer styling that the design does not show. Every token value, every dialog option, every BEM modifier MUST trace back to something measured in DESIGN_FILE per Step 2. If DESIGN_FILE is ambiguous, ask for one clarifying screenshot per Step 2 — do not guess.

### A4. Mandatory final visual parity check before declaring done
After Step 10's rendered-DOM check passes, perform an explicit side-by-side visual parity check BEFORE reporting completion:
- Open the deployed demo page in a browser at the design's native frame width.
- Open DESIGN_FILE (or its PNG frame export) at the same width.
- Compare, component-by-component and instance-by-instance: layout, spacing, typography (family, weight, size, line-height, letter-spacing), color (background, text, borders, accents), border-radius, shadow, image aspect ratio and crop, icon sizing, per-instance offset/alignment/gutter, and every interactive state.
- Record any mismatch, then fix at the correct layer (token → variant CSS → dialog option → authored content) per the iteration loop, redeploy (with A1 recovery if content changed), and repeat the parity check until zero mismatches remain.
- Repeat at each smaller breakpoint defined by DESIGN_FILE (or, if none, at the project's standard tablet and mobile widths).
- Only after the parity check is clean at every breakpoint may the run be reported as complete.

### A5. Do not disturb existing tokens or component APIs when appending fixes
When iterating to close a design-fidelity gap:
- Prefer adding a new token over changing an existing one — downstream components may rely on the current value.
- Prefer adding a new dialog select option over renaming or removing an existing one — existing authored content references the old value.
- Prefer adding a new BEM modifier class over widening the base selector.
- Never delete or rename an existing Sling Model getter without a matching HTL/CSS/test update in the same change.
- Run `mvn -pl core clean test` after any model change and re-run the Step 10 rendered-DOM check after any HTL/CSS/content change.

### A6. Web-font loading is MANDATORY when the design uses a non-system font
Recording the font family in a token is not enough — if the browser cannot resolve it, the page silently falls back to the system default and every measurement in the design is wrong. For every custom font family observed in DESIGN_FILE:
- Add an `@font-face` rule (self-hosted `.woff2` under `ui.apps/.../clientlib-tokens/fonts/`) OR a `<link rel="stylesheet">` to a licensed CDN, wired via the shared tokens clientlib so every page loads it.
- Use `font-display: swap` to avoid invisible text.
- Include every weight and style the design actually uses; do not ship weights the design does not use.
- After deploy, verify in the rendered DOM that the computed `font-family` on a sample element matches the token (browser DevTools → Computed → font-family, or `getComputedStyle` via `run_playwright_code`). If it falls back, the font is not loading.

### A7. Icons render as inline SVG with `currentColor`, not raster
Icons observed in DESIGN_FILE (arrows, chevrons, social glyphs, UI icons) MUST be delivered as inline SVG so they inherit `color` and scale crisply:
- Prefer the SVG export from `DESIGN_SVG_DIR` when present; otherwise vectorise from the PDF.
- Store under `ui.apps/.../clientlibs/clientlib-<name>/resources/icons/` or a shared icon clientlib.
- Set `fill="currentColor"` (or `stroke="currentColor"`) on the SVG paths and drive color from a token via CSS `color:`; never hardcode the icon color in the SVG.
- Author-driven icon choices (e.g., a per-item social-icon select) live as a dialog select whose values map to filenames the HTL resolves via `data-sly-resource` or a static switch.
- Never ship a design icon as a rasterised PNG unless the design element is genuinely a photo.

### A8. Long-form prose uses a `richtext` field, not `textfield`
Any body copy observed in DESIGN_FILE that spans multiple sentences, contains line breaks, or has inline emphasis MUST be authored via `granite/ui/components/coral/foundation/form/richtext` (RTE) — not `textfield`. The Sling Model exposes it as a `String` and HTL renders it with `context='html'`. Otherwise paragraph breaks, bold/italic, and inline links from the design cannot survive round-trip.

### A9. Page-level tokens & section rhythm live on the site clientlib, not per component
The following are page-scope, not component-scope, and MUST be applied on a global site clientlib rule (typically `body` or a `.das-page` wrapper) so components stay reusable:
- Body background color, base body `font-family`, base body `color`, base body `font-size` and `line-height`.
- Section vertical rhythm: derive `--das-section-py` from the design's most common section top/bottom padding and apply once on a shared `.das-section` (or the AEM responsive-grid `> .aem-Grid > .aem-GridColumn`) wrapper. Per-component CSS only overrides when a specific component's frame shows a different rhythm.
- Link default color / underline behavior and focus outline defaults (see A12).

If a component's CSS repeats a `body`-level style it should NOT own, delete it from the component and add it to the site clientlib instead.

### A10. Image aspect-ratio, object-fit, and container overflow are enforced in CSS
For every image slot observed in DESIGN_FILE:
- Set `aspect-ratio: <w> / <h>` on the image (or its wrapper) matching the design's crop; do NOT rely on the DAM asset's native dimensions.
- Set `object-fit: cover` (or `contain`, per design) so the image fills the slot without distortion.
- If the design shows the image with `overflow: hidden` corners (rounded card media), the wrapper MUST have `overflow: hidden` — do not rely on the image itself receiving the radius when it sits inside a card whose corners are clipped.
- Never allow `width: auto; height: auto` on a slot where the design defines a fixed ratio.

### A11. Automated screenshot-based visual diff (when browser tooling is available)
When the agent has browser-automation tools (`screenshot_page`, `open_browser_page`, `run_playwright_code`, or equivalent), the A4 parity check MUST be automated in addition to visual inspection:
- Load the deployed demo page at the design's native frame width; take a full-page screenshot.
- Load DESIGN_FILE's matching PNG frame export (or render the PDF page at the same width).
- Overlay or side-by-side diff the two; record per-region delta (typography, spacing, color) and fix at the correct layer.
- Repeat at every design-defined breakpoint.
- If no browser tooling is available in the environment, fall back to the manual A4 check and report that fact explicitly in the Final summary.

### A12. Accessibility floor — enforced even when the design is silent on it
The design almost never draws focus rings, `:hover`, or `:active` states, but the rendered site MUST still satisfy WCAG 2.1 AA. For every interactive component (link, button, tab, accordion header, carousel control):
- `:focus-visible` outline is present (use a shared token, e.g. `--das-focus-ring: 2px solid var(--das-color-focus)`).
- Hit-target minimum 44×44 CSS px on mobile.
- Text/background contrast ratio ≥ 4.5:1 for body, ≥ 3:1 for large text; if the design violates this, flag it in the Final summary and adjust the color token to the nearest compliant value (do not silently ship inaccessible contrast).
- Semantic HTML: `<button>` for actions, `<a>` for navigation, `<nav>`/`<main>`/`<footer>` landmarks, heading levels in document order.
- All decorative images `alt=""`; all meaningful images have an authored `alt` field on the dialog.
This is additive to A3 (design authority), not a contradiction: colors/styling come from the design, but accessibility affordances that the design omits are still required.

### A13. Unclassifiable design elements — stop and ask, never substitute a lookalike
If DESIGN_SOURCE contains an element the discovery pass in Step 1 cannot confidently classify (unusual widget, bespoke illustration, custom chart, animation frame, unknown interaction), STOP and ask the user for clarification with a specific question and a screenshot region reference (use `get_screenshot` in Mode A, or a cropped PNG from `DESIGN_SCREENSHOTS_DIR` in Mode B). Do not:
- Substitute a similar-looking Core Component.
- "Interpret" the element as a card / banner / list because it superficially resembles one.
- Skip the element and hope the user won't notice.
The Final summary must list every element that was flagged and how the user resolved it.

### A14. Figma URL parsing and Mode-A tool sequence
When `FIGMA_URL` is supplied, parse it exactly:
- `figma.com/design/:fileKey/:fileName?node-id=:nodeId` → use `:fileKey` and convert `:nodeId` from `1-234` to `1:234` (dash → colon).
- `figma.com/design/:fileKey/branch/:branchKey/:fileName` → use `:branchKey` as `fileKey`.
- `figma.com/make/:makeFileKey/:makeFileName` → use `:makeFileKey`.
- `figma.com/board/:fileKey/:fileName?node-id=:nodeId` → this is a FigJam board; use `get_figjam` instead of `get_design_context`, and STOP if the user actually wants an AEM page (FigJam is for whiteboarding, not screens).
- `figma.com/slides/:fileKey/:fileName?node-id=:nodeId` → Figma Slides; STOP and ask what to build from it.

Mode-A tool call sequence per top-level frame:
1. `get_metadata(fileKey, nodeId)` → child hierarchy + node types.
2. `get_design_context(fileKey, nodeId)` → geometry, text, fills, strokes, radius, shadow, layout constraints, per-instance overrides.
3. `get_variable_defs(fileKey)` → design-token variables; feed Step 3.
4. `get_screenshot(fileKey, nodeId)` → PNG for the A11 automated visual diff.
5. `download_assets(fileKey, [nodeIds])` → SVG icons and raster images to the local scratch folder.

If any Figma MCP call fails (network, auth, rate-limit, missing node), do NOT silently fall back to guessing. Either ask the user for a `DESIGN_FILE` companion, or ask for the specific `node-id` that failed. In Mode C, only fall back to `DESIGN_FILE` for the specific failing node — do not abandon the URL for the entire run.

### A15. Design-frame width vs. target render width — cap the component's inner container proportionally
When the DESIGN_SOURCE frame's width is materially different from the width at which the component will actually render (a very common case: a mobile-preview or tablet-preview frame designed to appear on a desktop page whose container-max is much wider), the component's inner container MUST cap at a `max-width` that preserves the design's internal proportions. Otherwise CSS layout primitives that distribute *remaining space* — `justify-content: space-between`, `justify-content: space-around`, `flex-wrap`, `align-self`, `margin-inline: auto`, `grid-template-columns: … 1fr …`, and `grid-template-columns: repeat(N, 1fr)` — will silently produce visibly different spacing than the design shows, because remaining space grows unboundedly with the container.

Symptom to watch for: the DOM structure is correct, per-element sizes look correct, every CSS rule passes lint, but sibling elements that sit close together in the design (e.g., two items in a bounded row, a logo strip next to a link, an icon next to a heading) end up separated by a large empty gap in the rendered page. The visual parity check (A4 / A11) fails even though the rendered-DOM check (Step 10) passes.

Contract (applies to EVERY component, not just those that show the symptom):
- In Step 2, record the design frame's usable content width (frame width minus outer gutters) and every primary element width and gap inside it. Convert those to ratios of the usable content width.
- In Step 5, compare the design's usable content width against the project's default page container-max. If the design width is materially smaller, set the component's inner container's `max-width` to a shared token whose value preserves the design's usable content width proportionally (prefer an existing narrower content token over introducing a new one; if none exists, add one per A5). Never leave a component to inherit the full page container-max when the design frame is materially smaller.
- Fixed sidebar / media columns should be sized in `px`, `%`, or `minmax()` bounds derived from the design's ratios, not left as bare `1fr` on both sides of a grid when the design shows a stable image-column vs. text-column ratio.
- After the fix, re-verify per A4 / A11 — the same `justify-content` / `align-self` rules will then produce the design's intended spacing without further per-instance overrides.

Iteration order when the visual parity check flags "too much space between siblings" or "the two columns look wildly out of proportion":
1. Confirm the design frame's usable content width and compare it to the rendered container width in the browser (DevTools → element box → `.getBoundingClientRect().width` on the component's inner container).
2. If they differ materially, cap the inner container's `max-width` FIRST — do NOT reach for `margin`, `translate`, negative offsets, hardcoded `gap: 8px`, or overriding the distribution primitive with `justify-content: flex-start` + `margin-left: auto`. Those hide the root cause and break other breakpoints.
3. Only AFTER the inner container is proportionally capped, decide whether any residual spatial variation between sibling instances warrants a per-instance dialog field per the per-instance spatial-authoring rule.

Anti-patterns (do not do these to "close the gap"):
- Adding `max-width` in `px` inside a component when a shared width/container token exists or should be added.
- Wrapping the whole layout in a nested extra `<div>` with hardcoded `max-width` and `margin: auto` when the existing `__inner` element could take that responsibility.
- Replacing `justify-content: space-between` with `flex-start` + hand-tuned `gap` values to force a specific pixel gap — the fix disappears the moment the container size changes.
- Enlarging the sidebar/media column arbitrarily to "fill" the extra space — this breaks the design's image / text ratio.

### A16. No image `filter:` effects unless the design shows them
Never apply CSS `filter:` (or any other visual transform — `mix-blend-mode`, `mask-image`, `-webkit-filter`, `opacity` below 1 on the base state, `background-blend-mode`) to author-supplied images (logos, avatars, product shots, hero photos, testimonial portraits, icon slots) unless the DESIGN_SOURCE frame explicitly shows the treatment on the exact same element. In particular do NOT default to any of these "conventional" treatments on logo strips, partner grids, testimonial rails, sponsor rows, or client walls:
- `filter: grayscale(1)` / `grayscale(100%)` — desaturating logos to a monochrome strip.
- `filter: opacity(0.7)` / `opacity: 0.7` on the base image state — muting logos so they "read as secondary".
- `filter: brightness()` / `contrast()` / `sepia()` / `hue-rotate()` — recoloring authored images.
- `mix-blend-mode: multiply` / `luminosity` — blending logos into a tinted background.
- `filter: grayscale(1)` on rest with `filter: none` on `:hover` — the "colored-on-hover" pattern.

These treatments look professional in isolation but they DESTROY the author's uploaded artwork: an author who uploads a full-color brand logo, product photo, or customer portrait sees it rendered in monochrome/muted with no way to opt out, and no error is emitted anywhere. The rendered-DOM check (Step 10) passes because the `<img>` tag is present; the visual parity check (A4 / A11) fails because the color is wrong, but the root cause is easy to misdiagnose as an asset problem when it is actually component CSS.

Contract:
- Author-supplied media is rendered with `object-fit`, `aspect-ratio`, and sizing constraints only. Color, saturation, and opacity of the base state come from the source asset — the component CSS does not touch them.
- If the design frame genuinely shows a desaturated / tinted / blended image treatment (rare but possible — e.g. a hero image with a dark overlay, a partner logo intentionally rendered in a single brand color), encode that as a dialog select whose values map to opt-in modifier classes (`cmp-<name>__image--treatment-<value>`), default `none`, so authors can turn it on per instance. Never make it the unconditional base style.
- When the design shows what look like grayscale logos, first verify with `get_screenshot` at a higher `maxDimension` and by inspecting the SVG / raster export directly — many "monochrome" partner logos in Figma are actually the brand's own single-color mark exported as-is, not a grayscale CSS filter on a colored source.
- Interactive states (`:hover`, `:focus-visible`) MAY animate a subtle transform / shadow / underline, but must never change the color rendering of an author-supplied image unless the design shows both rest and hover states of that image with explicitly different renderings.

Anti-pattern to flag in code review:
```css
/* Do NOT ship this on a logo strip / partner grid / testimonial rail. */
.cmp-<name>__logo,
.cmp-<name>__logo-item img {
    filter: grayscale(1) opacity(0.7);
}
.cmp-<name>__logo:hover {
    filter: grayscale(0) opacity(1);
}
```
If this pattern already exists on a component and the design does not explicitly require it, remove it as part of the visual parity iteration loop (A4). Do not "improve" it into a smoother animation — remove it entirely.
================================================================