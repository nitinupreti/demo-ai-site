# Build an AEM Component From a Figma Design

**Figma URL:** <paste figma.com/design/... URL here>

Build a new AEM as a Cloud Service component that matches the provided Figma frame pixel-by-pixel. Use the project's existing conventions (Java stack, Sling Models, HTL, Granite UI Coral 3, BEM CSS, design tokens).

---

## 1. Read the design first

- Fetch the design using the Figma MCP `get_design_context`, `get_screenshot`, and `get_variable_defs` tools for the exact node in the URL.
- Extract every design token that already exists in the project's `clientlib-tokens` (spacing scale, colors, typography, radii, container max-width) and reuse them. Do NOT hardcode px values that a token already covers.
- Identify the **author-visible variants** in the design (e.g. two column layouts that mirror each other, alternate color themes, alternate density). List them explicitly before writing any code.

## 2. Design the dialog: one authoring concept → one field

**Rules — enforce these strictly:**

- Every field must map to a single, atomic design intent. If two fields always change together, merge them into one select.
- Never split "which side is empty" and "which side the image sits on" into two fields — one field encodes both.
- Every enumerated field must have a sensible `value` default so an empty-authored component still renders correctly.
- For each color-like property offer a curated palette **plus** an "Other" option that reveals a free-form hex/CSS textfield via `cq-dialog-dropdown-showhide`. This is what makes pixel-perfect matches possible when the design uses a color outside the token palette.
- Repeating elements (buttons, links, list rows) belong in a `granite/ui/components/coral/foundation/form/multifield` with `composite="{Boolean}true"` whose child is a `container` of the sub-fields. Each sub-field must be an authorable atom (e.g. a CTA row = `ctaTitle` textfield + `ctaLink` pathfield — never a plain-text label when the design shows a link).
- Image sources use `pathfield` with `rootPath="/content/dam"`, not the Core Image proxy, unless the design needs rendition/lazy-crop behavior.
- Mark required fields with `required="{Boolean}true"` and add a `fieldDescription` for anything non-obvious.
- Put visual-only choices (color, alignment, density) in a **Style** tab; put content (text, image, links) in a **Properties** tab.

## 3. Sling Model

- `@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)`.
- One `@ValueMapValue` per dialog field. Provide `@Default` values that mirror the dialog defaults.
- Multifield → `@ChildResource` returning a `List<ChildItemModel>`; create a small `@Model` for the item with `hasContent()` returning true only when all required sub-fields are non-blank. Filter empty items in a `@PostConstruct`.
- Expose a `getBackgroundStyle()` (or equivalent) helper that returns `"background-color: <hex>;"` **only** when the color select is "other" AND the hex field is non-blank; otherwise `null`. HTL uses `context='styleString'`.
- Expose an `isHasContent()` that is true when the component has any renderable content — used by HTL for the empty-state placeholder.
- Never leak implementation-only properties (e.g. `imagePosition` + `horizontalOffset` + `sideGutter`) — the model should expose the same clean concepts the dialog does.

## 4. HTL template

- Root element uses BEM: `<section class="cmp-<name> cmp-<name>--<enum1>-${model.enum1} cmp-<name>--<enum2>-${model.enum2}" style="${model.backgroundStyle @ context='styleString'}">`.
- Always use context annotations: `@ context='attribute'` for attribute values, `@ context='uri'` for links/images, `@ context='styleString'` for inline styles.
- Include the component's clientlib once via `<sly data-sly-use.clientlib="/libs/granite/sightly/templates/clientlib.html"><sly data-sly-call="${clientlib.css @ categories='<clientlib-category>'}"/></sly>`.
- Guard every optional block with `data-sly-test`. Iterate multifield children with `data-sly-list`.
- Empty state: render a placeholder only when `!model.hasContent && wcmmode.edit`.

## 5. CSS (BEM + tokens)

- One CSS file per component under `ui.apps/.../clientlibs/clientlib-<name>/css/`; wired via `css.txt` and a `.content.xml` clientlib category matching the HTL.
- One selector per modifier class. Do not stack unrelated concerns in the same selector.
- For layouts where the design shows a card that hugs one side of a container with breathing room on the other, use `justify-content: flex-start` / `flex-end` (or CSS grid `justify-self`) driven by the modifier class — NOT margins, translates, or negative offsets. The card's own `max-width` should equal `calc(var(--das-container-max) - var(--das-space-N))` where N matches the desired empty gutter.
- For "image on the other side" variants, swap `grid-template-areas` (or `flex-direction: row-reverse`) in the modifier class. Never duplicate the whole component's rules.
- Include a tablet (`≤1024px`) breakpoint that collapses side-by-side layouts to stacked+centered, and a mobile (`≤640px`) breakpoint that reduces padding.
- Only reference existing design tokens (`--das-space-*`, `--das-color-*`, `--das-radius-*`, `--das-container-max`). If the design demands a value no token covers, either add a new token or use the free-form hex field — do NOT hardcode literals in component CSS.

## 6. Unit tests (JUnit 5 + wcm.io AEM Mocks)

- One test class using `AppAemContext.newAemContext()`.
- Test 1 — `defaultsWhenEmpty`: adapt an empty resource, assert every default value, assert `getBackgroundStyle()` returns `null`, assert multifield lists are empty.
- Test 2 — `configuredFully`: create a resource with every field set including a non-default color = "other" + valid hex + a populated multifield, assert every getter and assert `getBackgroundStyle()` returns the exact `"background-color: <hex>;"` string.

## 7. Build, deploy, verify

- Run `mvn -pl core clean test -Dtest=<ModelName>Test` first — fix any failures before deploying.
- Deploy with `mvn install -PautoInstallSinglePackage -DskipTests`.
- After deploy, curl the rendered page with `?wcmmode=disabled` (basic auth `admin:admin`, add a `Referer` header) and assert every expected modifier class appears in the HTML (`cmp-<name>--<enum>-<value>`).
- Also curl `/etc.clientlibs/<project>/clientlibs/clientlib-<name>.css` and assert every modifier class is defined.

## 8. Content-package gotcha (read this before troubleshooting "why don't my edits show up")

The project's `ui.content` filter typically uses `mode="merge"`, which **only adds missing nodes — it does NOT update properties on existing nodes**. If you change the schema of a component that already has authored instances, redeploying `ui.content` will silently leave the old properties in place and the rendered page will look unchanged.

Recovery in order of preference:

1. Delete each stale instance node via Sling POST, then redeploy:
2. Or temporarily switch the affected filter entry to `mode="update"`, deploy, then revert.
3. Or re-author the component through the dialog (which writes the new properties directly).

For net-new sample content that never existed, plain `merge` works fine.

## 9. Deliverables checklist

- [ ] `_cq_dialog/.content.xml` — Properties + Style tabs, dropdown-showhide for "other" color, multifield for repeating rows, required flags, field descriptions
- [ ] `<ComponentName>Model.java` + one child `@Model` per multifield type
- [ ] `<component>.html` — BEM classes, context annotations, empty state, clientlib include
- [ ] `clientlibs/clientlib-<name>/` — `.content.xml`, `css.txt`, `css/<component>.css`
- [ ] `<ComponentName>ModelTest.java` — defaults + fully-configured tests
- [ ] One sample authored instance in `ui.content` demonstrating every variant visible in the Figma design (including any zig-zag / alternating layout)
- [ ] Verified: model tests green, page HTML contains every expected modifier class, clientlib CSS contains every modifier class

## 10. Ground rules

- Reuse existing tokens, existing patterns, and existing Core Component supers wherever the design allows.
- No new abstractions or helpers for one-time operations.
- Never add fields "in case an author wants them" — every field must correspond to a variant visible in the Figma frame.
- If the design's spacing, color, or typography does not match a token, prefer adding one shared token over hardcoding, but expose a hex override for one-off exceptions.