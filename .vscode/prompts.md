# Prompt — Build AEM Components from Figma with Pixel-Parity Authoring

## Input (only one — nothing else required)
- **FIGMA_URL**: <paste a node-specific figma.com/design/... URL here>

## Goal
Build EVERY reusable AEM component required to author the page shown at **FIGMA_URL** on an AEM as a Cloud Service project. When those components are dragged onto a real page and populated with the design's content, the rendered result MUST match Figma pixel-for-pixel (layout, spacing, typography, color, radius, shadow, iconography, responsive behavior, interaction states, **per-instance alignment and offset**).

Discover everything else — component list, dialog fields, variants, tokens, breakpoints, build commands, package prefix, module layout — from Figma and from the repo. Do not hardcode assumptions about counts, names, or types.

## Mandatory skills / tools (must be used, not paraphrased)
- **`create-component` skill** — MUST be invoked once per discovered component. The skill owns the full deliverable set: component `.content.xml`, `_cq_dialog/.content.xml`, HTL, Sling Model + JUnit test, per-component clientlib with the project's design-tokens clientlib as a dependency.
- **Figma MCP tools** — MUST be used first: `get_metadata`, `get_design_context`, `get_screenshot`, `get_variable_defs` (and `search_design_system` / `get_libraries` if a shared library is present). If rate-limited, fall back to the screenshot + previously-fetched metadata and say so explicitly.
- **Repo agent docs** — MUST be read first (`AGENTS.md`, `CLAUDE.md`, `README.md`) to discover build commands, module layout, package prefix, component group, tokens clientlib category, and per-component clientlib naming convention.

## Rules (must follow)
- Source of truth is Figma. When Figma and code disagree, Figma wins.
- Build **reusable, author-friendly** components: every visual variant that appears in Figma becomes a dialog select / checkbox, not a duplicate component.
- Discover the component list from Figma — do not assume a fixed count or set of names.
- Establish/refresh shared **design tokens** first (colors, typography scale + line-heights + letter-spacing, spacing scale, radii, shadows, container widths, breakpoints). Reference tokens from component CSS.
- Vanilla CSS only inside the existing clientlib structure. No Tailwind, no React, no CSS-in-JS, no new build tooling.
- Use BEM (`.cmp-<name>__<el>--<mod>`).
- Do not modify anything under `target/`, `dist/`, `node_modules/`, `.m2/`, or Core Component libraries.
- Do not hardcode Figma temporary asset URLs — images route through Core Image / DAM references.
- Every component must render a friendly empty-state placeholder inside a clickable wrapper immediately after being dropped in edit mode, so authors can open its dialog.
- Static labels use i18n (`${'…' @ i18n}`).
- Ask for clarification only if Figma access fails or the URL is invalid; otherwise proceed autonomously.

## HTL iteration rule (prevents a whole class of runtime bugs)
When authoring any HTL that loops over a multifield or list:
- **`data-sly-list` iterates the HOST ELEMENT'S CONTENT** — the host is rendered once, its children are repeated N times. Use it when the host is a **container** (`<ul>`, `<ol>`, `<div class="…__list">`, `<tbody>`, etc.) and there is exactly ONE child template inside that should be repeated.
- **`data-sly-repeat` iterates the HOST ELEMENT ITSELF** — the host and its contents are repeated N times. Use it when the host IS the per-item element (`<li>`, `<article>`, `<tr>`, `<figure>`, card wrappers, tile wrappers, tab buttons, quote panels, etc.).
- Equivalent to `data-sly-repeat`: wrap the per-item element in `<sly data-sly-list.<var>="${...}">…</sly>`.
- Decision rule: if the CSS/JS relies on there being one DOM node per data-source item (per-item modifier classes, `data-index` attributes, sibling selectors, `nth-child`, or `querySelectorAll` returning N elements), **the loop must be on a container whose only child is that element, OR use `data-sly-repeat` on the element itself**. Never both.

## Per-variant positional invariants rule (added — prevents flattening design intent to a default)
When Figma shows two or more sibling instances of the same component with **visibly different horizontal or vertical positioning** (alternating left/right offset, staggered stacking, asymmetric side margin, zig-zag layout, alternating alignment, offset baseline, alternating column order, alternating card side, etc.):
- That positional difference is a **design invariant tied to a variant**, not decoration and not accidental. Never centre/flatten it to a shared default just because it is easier.
- Identify the property in the design that toggles the position (image side, feature side, index parity, orientation, alignment token, etc.) and **expose it as a dialog control**, then bind it to a BEM modifier class on the component root (e.g. `.cmp-<name>--<positional-modifier>`).
- In the component's CSS, **bind the positional layout property to that modifier class** — typical properties are `justify-content`, `justify-self`, `align-self`, `margin-inline-start` / `margin-inline-end`, `grid-column`, `order`, `flex-direction: row-reverse`, or asymmetric outer padding. Do NOT rely on `margin: 0 auto` or centred defaults for any component whose Figma frame shows off-centre placement.
- If the offset requires the component to be narrower than its parent container to have room to shift, cap the component's `max-width` at `container-max − <offset token>` and let the parent be a `display: flex` row whose `justify-content` is driven by the modifier class. This keeps the offset consistent across viewport widths.
- On breakpoints where the design collapses to a single centred column (typically tablet / mobile), reset the positional modifiers to the centred default inside the media query.
- Sanity check per component: if the Figma frame shows N sibling instances at N different positions, the rendered demo page MUST show those same N distinct positions — never N identical centred instances.

## Step 0 — Discover
1. Read the repo's agent docs to capture: build command, module layout, package prefix, component group, tokens clientlib category, per-component clientlib naming convention, and content root path.
2. Parse **FIGMA_URL** → extract `fileKey` and `nodeId`.
3. Call the Figma MCP tools listed above on the frame and record raw values. Do not paraphrase.

## Step 1 — Decompose the design
From the Figma frame, identify every distinct **reusable** section/block that would be authored as its own AEM component. For each, capture:
- Semantic name (kebab-case, derived from the frame's layer name or visual purpose).
- All variants/modifiers visible in the frame (background style, image position, theme, size, **positional/alignment variant per instance**, etc.) — these become dialog selects.
- Author-editable fields (text, rich text, image, link, path, multifield of child items).
- Any interactive state (tabs, carousel, accordion) and its initial/active behavior.
- Repeating child items → composite multifield with a dedicated child Sling Model.

## Step 2 — Extract Figma facts per component (per-instance comparison required)
For every component's Figma node, record before editing:
- Outer container width, horizontal page gutter, section top/bottom padding
- Internal grid/flex gaps, per-element padding & margin
- Border-radius, border, shadow
- Font family + fallbacks, weight, size, line-height, letter-spacing (per text style)
- Exact color hex / opacity for background, text, borders, accents
- Icon dimensions, image aspect ratio, object-fit intent
- Hover / active / focus state hints visible in the frame
- Responsive intent if multiple frames exist; otherwise document the fallback assumption inline as a CSS comment
- **Per-instance positional deltas** — if the same component appears N times in the frame, measure each instance's horizontal offset from the container centre, vertical stagger, alignment, side padding, and column order. Record the delta between instances and identify which authored property drives it. Any non-zero delta must be encoded as a variant modifier (see the "Per-variant positional invariants rule" above), never averaged away.

## Step 3 — Establish shared design tokens
Create or update the shared tokens clientlib (using the project's naming convention discovered in Step 0). Add tokens for every unique value captured in Step 2 — including any **positional-offset tokens** (e.g. side gutter, zig-zag inset) so alternating layouts stay consistent across breakpoints and components.

## Step 4 — Create every component via the skill (one invocation per component)
For each component identified in Step 1, invoke the **`create-component` skill** with a spec derived from the Figma facts (name, group, dialog fields with correct field types + required flags + defaults, variants/modifiers **including any positional/alignment variant**, tokens to consume, breakpoints, interactive behavior). Let the skill produce the full deliverable set. The generated per-component clientlib MUST depend on the shared design-tokens clientlib.

## Step 5 — Per-component CSS parity pass (with sibling-comparison checklist)
For each component's CSS file, apply the Figma-derived values using tokens wherever possible. Verify outer padding, container max-width, gutters, card inner padding, radius/background/border/shadow, every variant, pill/label/chip sizing, typography per element, and responsive behavior at each Figma-defined breakpoint. Then, for any component that renders multiple times on the page, run this **sibling-comparison checklist**:
1. Line up the N Figma instances side-by-side and diff their positions (horizontal offset, vertical stagger, alignment, side margin, column order).
2. For every non-zero positional delta, confirm there is a dialog field + BEM modifier class that toggles it, and confirm the CSS binds a positional layout property (`justify-content`, `justify-self`, `align-self`, `margin-inline-*`, `order`, `flex-direction`, `grid-column`, asymmetric padding, etc.) to that modifier.
3. Confirm the collapse behaviour at tablet/mobile media queries resets those positional modifiers to a sensible centred default.

## Step 6 — HTL structural validation (mandatory before Step 7)
For every component that has ANY multifield or list:
1. Grep the component's `.html` for `data-sly-list` and `data-sly-repeat`. For each hit, apply the "HTL iteration rule" above and confirm the host element type matches its intended semantic role (container vs. per-item).
2. If the component relies on per-item DOM (BEM `--active` toggles, `data-index`, `aria-selected`, `nth-child`, per-item event handlers), you MUST verify — after Step 9 install — that the rendered DOM contains **N sibling per-item elements**, where N is the multifield item count. If it contains 1 element with N repeated inner blocks, the iteration attribute is on the wrong element; fix it before proceeding.
3. Every per-item element that the JS or CSS addresses individually MUST carry `data-index="${itemList.index}"` (or an equivalent stable identifier).

## Step 7 — Interaction correctness (for stateful components only)
- Scope all DOM queries to the **component root**, never `document`.
- On state change, clear the active class / `aria-selected` on all sibling items inside that root, then apply it only to the target item (identified by `data-index` or equivalent).
- Support multiple instances of the same component on one page independently.
- Guard against double-initialization (`data-cmp-initialized`).
- Keep the first item active on initial render.

## Step 8 — Wire clientlibs
Ensure every per-component clientlib depends on the shared tokens clientlib, and the site-level wiring (embed OR HTL `clientlib.css`/`clientlib.js` include) is in place so authors get all styling on any page without extra work.

## Step 9 — Author a demo page to prove parity
Under the project's content root (as discovered in Step 0), create a sample page and drop the components in Figma order, populated with the design's actual copy and images (DAM placeholders where the real asset isn't available). **When Figma shows the same component repeated with alternating variants, the demo page MUST author those exact variants in the exact same order** so the rendered result matches Figma's zig-zag / alternating pattern instance-for-instance. **Critical:** author the components under the template's editable region path (typically an inner responsive-grid container, NOT directly under the page's `root` node). If components author correctly in the JCR but do not render, the authored path does not match the template's structure — fix the content path before continuing.

## Step 10 — Build, install & verify (rendered-DOM check is mandatory)
1. Run the project's standard build + local install command (as discovered in Step 0). Must end in BUILD SUCCESS with 0 analyser warnings and all unit tests green.
2. **Fetch the demo page as rendered HTML** (e.g. via HTTP GET with `?wcmmode=disabled` and Basic auth) and confirm:
   a. Every authored component instance appears in the response body (grep for its BEM root class).
   b. For every list-driven component, count the per-item sibling elements in the response and verify the count equals the authored multifield item count.
   c. For every stateful component, confirm exactly ONE per-item element has the initial `--active` modifier and matching `aria-selected="true"`.
   d. **For every component that has a positional/alignment variant, grep the response for each variant modifier class (`--<positional-modifier>`) and confirm the expected count of each variant matches the Figma frame** (e.g. if Figma shows the modifier alternating across N instances, the response must contain the expected number of each variant, not N identical instances).
3. Open the demo page in the browser and compare side-by-side with the Figma frame at the Figma-defined width, then at each smaller breakpoint. **Explicitly verify sibling instances land at their Figma-specified positions** (e.g. alternating side margins, staggered offsets, zig-zag stacks) — a centred stack where Figma shows offsets is a Step 5 failure that must be fixed.
4. Open the same page in edit mode and confirm every component is author-friendly (empty-state placeholders render, dialogs open, no console errors).
5. Iterate on tokens + component CSS until parity is reached. Do not modify unrelated components.

## Deliverable
Post a concise summary containing:
- Component decomposition (name → dialog fields → variants, **including positional/alignment variants**).
- Skills invoked and for which components.
- Figma MCP calls made (and any rate-limit fallbacks).
- Shared tokens created/updated.
- Every per-component file set produced (paths).
- HTL iteration audit (which loops use `data-sly-list` vs. `data-sly-repeat` and why).
- **Positional-variant audit** (per component: which BEM modifier binds which positional CSS property, and the sibling-comparison result from Step 5).
- Rendered-DOM check results (per-item sibling counts for every list-driven component, **and per-variant instance counts for every positional variant**).
- Interaction-bug guards applied.
- Demo page path.
- Build status.
- Any residual gaps that require Figma clarification or additional design frames.