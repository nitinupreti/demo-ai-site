# DESIGN_SOURCE
FIGMA_URL:   "https://www.figma.com/design/BgE2ATtqKCnLEUmPWyctc9/Minimal-Landing-Page-Design-%7C-Website-Home-Page-Design-%7C-Agency-Website-UI-Design--Community---Copy-?node-id=212-816&t=oQ9zb8JNr1wrmZDI-0"
DESIGN_FILE: <path to .pdf or .fig — optional>
# Optional companions: DESIGN_SCREENSHOTS_DIR, DESIGN_SVG_DIR, DESIGN_TOKENS_JSON 
# If neither FIGMA_URL nor DESIGN_FILE is set, STOP and ask.

# Build every AEM component required to author the page defined in DESIGN_SOURCE

## Goal
Build every reusable AEM as a Cloud Service component (Java Sling Models, HTL, Granite UI Coral 3, BEM CSS, shared design tokens) required to author the page in DESIGN_SOURCE. When authored on a real page with the design's content, the rendered result MUST match the design pixel-for-pixel in both author mode and disabled mode at every design-defined breakpoint.

## MANDATORY — no component may be skipped
Every distinct reusable block visible in DESIGN_SOURCE (every section, strip, card cluster, carousel, form, footer, header, rating badge, pricing panel, and any other authored region — INCLUDING those that require interactive JS such as carousels, tabs, accordions, and modals) MUST be delivered as a working authorable component in this run and authored onto the demo page. Deferring any block to "residual gaps", "future work", "out of scope", or a follow-up run is a defect. The `reuse_decisions` YAML block MUST contain one row per Figma block with `tier` and `additions`; the `instance_authoring_map` MUST contain one row per Figma instance; the deployed demo page MUST render EVERY block with 0 SightlyExceptions before the final summary is written. If a block genuinely cannot be built (e.g. an unresolvable Figma node), STOP and ask the user with a screenshot region reference — do NOT silently drop it. The final summary's "residual gaps" section MUST be empty except for items the user has explicitly approved to defer.

## P0 — Design fidelity is non-negotiable
Rendered output MUST match DESIGN_SOURCE for typography (family, weight, size, line-height, letter-spacing, color), color (backgrounds, text, borders, accents, opacity, gradients), backgrounds (page, section, component, per-variant), and look-and-feel (spacing, radii, borders, shadows, iconography, image ratios, alignment, per-instance offsets, interaction states). Verify in BOTH:
1. **Disabled mode** — rendered-DOM check (Step 10) + visual parity (A4/A11).
2. **Author mode** — `/editor.html<demo-page-path>.html`; ignore only editor chrome and empty-state placeholders.

**Iteration on mismatch:** fix at token layer → component CSS layer → redesign component (change HTL/dialog/split) → redeploy → re-verify BOTH modes. Green build + wrong colors/font/background = NOT DONE.

## Input modes
| Set                                    | Mode | Source of truth                                    |
| -------------------------------------- | ---- | -------------------------------------------------- |
| FIGMA_URL only                         | A    | Figma MCP tools                                    |
| DESIGN_FILE only (PDF; not `.fig`)     | B    | Local parser (PDF text/geometry/images)            |
| Both                                   | C    | Figma MCP wins; PDF is safety net                  |
| Neither / `.fig` without URL / no PDF  | —    | STOP and ask                                       |

## Mandatory skills / tools
Read `.agents/skills/` first and follow each SKILL.md whose stated domain overlaps the task. In particular:
- **`create-component`** — sole owner of new-component scaffolding, dialog authoring, HTL, Sling Model + tests, per-component clientlib, and Core Component extension patterns. Invoke ONCE per Tier-4 (new) component and for Tier-2/3 (extensions) — pass the reuse decision as input. Do not paraphrase its mechanical details in this prompt.
- **`ensure-agents-md`** — run FIRST if `AGENTS.md` is missing.
- **`code-assessment`** — invoke on all generated Java/OSGi/Maven before declaring done.
- **`migration`, `dispatcher`, `aem-workflow`, `content-distribution`, `aem-rde`** — load on-demand when relevant.

**Figma MCP (Mode A/C)** — load `/figma-design-to-code` skill, then call in order per top-level frame:
`get_metadata` → `get_design_context` → `get_variable_defs` → `get_screenshot` → `download_assets`. Treat responses as a REFERENCE to adapt to the project's tokens/components, not final code.

**Figma URL parsing:** `figma.com/design/:fileKey/:fileName?node-id=1-2` → fileKey=`:fileKey`, nodeId=`1:2` (dash→colon). `branch/:branchKey/…` → use branchKey as fileKey. `/board/` = FigJam (use `get_figjam`); `/slides/` = Slides (STOP and ask); `/make/` = Make.

## Rules
- **DESIGN_SOURCE is source of truth.** When design and existing code disagree, design wins. No assumed styling, no invented variants (A3).
- **Reuse before create** (see Step 1.5). Tier order: (1) reuse project component as-is; (2) extend project component via `sling:resourceSuperType`; (3) extend Core Component; (4) create new. Duplicating a component is a defect. Same conceptual block + different look → **`style` (theme) variant on the SAME component**, NOT a sibling or new-prefixed component. Extension naming (only for true structural variants that can't be theme-switched): `<parent>-<qualifier>`.
- **Reuse must not disturb authors.** Any extension of an existing component MUST be additive and MUST NOT bloat the dialog, break existing authored instances, or change the pre-change default rendering. See the **Author-experience preservation contract**.
- **Generic component names — non-negotiable (A25).** Every component folder / Sling Model / clientlib category / BEM class MUST use a semantic kebab-case name that describes the *block role*, never the design, brand, campaign, or source Figma file. FORBIDDEN: any prefix or suffix derived from a brand, product, campaign, design-system nickname, Figma file slug, page name, version tag, or the project itself — for example `<brand>-hero`, `<design-key>-header`, `<slug>-footer`, `<name>-v2`, `<project-prefix>-cards`. ALLOWED names describe the role only: `hero`, `header`, `footer`, `services`, `destinations`, `steps`, `testimonials`, `logos`, `subscribe`, `pricing`, `faq`, `contact-form`, `rating-strip`, `portfolio`, etc. If discovery (Step 0) finds any existing branded/prefixed component, Step 1.5 MUST rename it to the generic role name (folder + `<Name>Model.java` + clientlib category + BEM classes + every `sling:resourceType` in authored content) BEFORE proceeding — this rename is part of the run, not deferred. Different designs of the same block coexist via `style` variant, never via prefix.
- **Reuse templates and policies.** Never create a new template unless page structure demands it. Add components to existing policy `allowedComponents`, don't fork policy trees.
- **Exact values (A19):** copy hex, px, weights, line-heights, letter-spacing byte-for-byte from Figma. No rounding, no scale-snapping.
- **No hardcoded literals** in component CSS — reference tokens. Add a shared token if the design needs a new value.
- **BEM:** `.cmp-<name>__<el>--<mod>`. Vanilla CSS in existing clientlib structure. No new build tooling.
- **Assets on DAM** — upload every extracted image to `/content/dam/<project>/design/`. No remote/temporary URLs.
- **Icons = inline SVG with `currentColor` (A7/A21).** Never substitute Unicode/emoji (`→`, `★`, `✓`, etc.) for a designed glyph.
- **No image `filter:` effects** (grayscale, opacity, blend) unless the design shows them (A16).
- **i18n static labels** via `${'…' @ i18n}`.
- **Empty-state placeholder** for every component when `!model.hasContent && wcmmode.edit`.
- **Never modify** `target/`, `dist/`, `node_modules/`, `.m2/`, Core Component libraries, or `templates/*/initial|structure` (add policies only).
- Ask ONLY if DESIGN_SOURCE is missing/unreadable or a specific node can't be resolved; otherwise proceed autonomously.

## Parallelism — run independent work concurrently
Where work is independent, issue it in a SINGLE tool-call block (agent) or a SINGLE PowerShell command with parallel jobs (shell). Sequential execution of independent work is a defect.

**Discovery (Step 0)** — one tool block containing all of:
- `AGENTS.md`, `CLAUDE.md`, `README.md`, `.aem-skills-config.yaml` reads.
- `list_dir` for `.agents/skills/`, `apps/<project>/components/`, `conf/<project>/settings/wcm/templates/`, `conf/<project>/settings/wcm/policies/`.
- Figma calls for the target node: `get_metadata`, `get_design_context`, `get_variable_defs`, `get_screenshot`, `download_assets`.

**Scaffolding (Step 4)** — one batched call emits every file for EVERY Tier-4 / Tier-2 / Tier-3 component AND the shared tokens clientlib together. Do not scaffold components one at a time — each is independent of the others.

**Sample content (Step 9)** — every component's `_jcr_content/...` node under the demo page is written in the same batched call as the component files, or immediately after in a second batched call.

**Build (Step 10.1–10.2)** — one multi-threaded Maven invocation that skips the modules that don't change during component work:
```
mvn -T 1C install -PautoInstallSinglePackage -DskipTests ^
    -pl all,core,ui.apps,ui.apps.structure,ui.config,ui.content -am ^
    -Dvault.skipValidation=true
```
`-T 1C` = one thread per CPU core. Skips `ui.frontend`, `it.tests`, `ui.tests`, `dispatcher`. Typical wall-clock ~90 s vs. ~5 min for the full reactor. Run `mvn -pl core test` BEFORE this invocation so a red model test aborts before deploy.

**Verify (Step 10.3–10.6)** — ONE parallel fetch + ONE batched grep:
```powershell
$base = 'http://localhost:4502'
$cred = New-Object System.Management.Automation.PSCredential('admin', (ConvertTo-SecureString 'admin' -AsPlainText -Force))
$page = '<demo-page-path>'          # e.g. /content/demo-ai-site/us/en/noble-finances/home
$proj = 'demo-ai-site'
$components = @('hero','service-cards','faq','contact-form')   # per run
$urls = [ordered]@{
  disabled = "$base$page.html?wcmmode=disabled"
  editor   = "$base/editor.html$page.html"
  siteCss  = "$base/etc.clientlibs/$proj/clientlibs/clientlib-site.css"
  tokenCss = "$base/etc.clientlibs/$proj/clientlibs/clientlib-tokens.css"
}
foreach ($c in $components) { $urls["cl-$c"] = "$base/etc.clientlibs/$proj/components/$c/clientlibs/clientlib-$c.css" }

# PS 7: ForEach-Object -Parallel. PS 5.1 fallback: replace with Start-Job / Wait-Job.
$results = $urls.GetEnumerator() | ForEach-Object -Parallel {
  try {
    $r = Invoke-WebRequest -Uri $_.Value -Credential $using:cred -Authentication Basic `
                            -Headers @{Referer="$using:base/"} -UseBasicParsing -ErrorAction Stop
    [pscustomobject]@{Name=$_.Key; Status=[int]$r.StatusCode; Body=$r.Content}
  } catch { [pscustomobject]@{Name=$_.Key; Status=0; Body=''} }
} -ThrottleLimit 8

# One batched grep sweep across every body:
$disabled = ($results | ? Name -eq 'disabled').Body
foreach ($cls in @('cmp-hero','cmp-service-cards','cmp-faq','cmp-contact-form')) {
  $n = ([regex]::Matches($disabled, [regex]::Escape($cls))).Count
  "{0,-30} {1}" -f $cls, $n
}
# Also assert: variant modifier counts, SightlyException count == 0, every clientlib Status == 200.
```
Expected wall-clock: 5–8 s for a full page.

## Dialog authoring contract (atomic-intent)
- One authoring concept → one field. Merge fields that always change together; keep independent ones separate.
- Every enumerated field has a sensible default. Required fields: `required="{Boolean}true"`. Non-obvious fields: `fieldDescription`.
- **Color-like properties** offer a curated palette + `"other"` option that reveals a free-form hex textfield via `cq-dialog-dropdown-showhide`.
- **Repeating elements** → `granite/ui/components/coral/foundation/form/multifield` with `composite="{Boolean}true"`.
- **Image sources** → `pathfield` with `rootPath="/content/dam"`.
- **Body copy that spans multiple sentences / has emphasis (A8)** → `richtext`, not `textfield`. HTL renders with `context='html'`.
- **Tabs:** content → Properties; visual choices (color, alignment, density, side, offset, gutter) → Style.
- **Direction vs. Amount:** if side (`left|right`) and magnitude (`none|sm|md|lg`) vary independently, they are two fields. Direction → `justify-content` / `grid-template-areas`; amount → scoped CSS custom property.

## Sling Model contract
- `@Model(adaptables = Resource.class, defaultInjectionStrategy = OPTIONAL)`.
- `@ValueMapValue` per dialog field with `@Default` matching dialog defaults.
- Multifield → `@ChildResource List<ChildItemModel>`; child exposes `hasContent()`; filter empty items in `@PostConstruct`.
- Expose `getBackgroundStyle()` returning `"background-color: <hex>;"` ONLY when color=`"other"` AND hex is non-blank; else `null`.
- Expose `isHasContent()` for the empty-state guard.

## HTL contract
- Root: `<section class="cmp-<name> cmp-<name>--<enum1>-${model.enum1} ..." style="${model.backgroundStyle @ context='styleString'}">`.
- Context annotations always: `attribute`, `uri`, `styleString`, `html`.
- Include per-component clientlib via `data-sly-use.clientlib` + `clientlib.css @ categories='<category>'`.
- Guard optional blocks with `data-sly-test`.

**HTL iteration rule (prevents an entire bug class):**
- `data-sly-list` on a CONTAINER (`<ul>`, `<ol>`, `<tbody>`, `<div class="…__list">`) — host once, children N times.
- `data-sly-repeat` on the PER-ITEM element (`<li>`, `<article>`, `<tr>`, `<figure>`) — element itself repeated N times.
- If CSS/JS needs one DOM node per item, use `data-sly-repeat` on the element OR `data-sly-list` on its container — never `data-sly-list` on the per-item element itself (that renders ONE host containing all children and silently breaks accordions/tabs/carousels).

## Interactive-component contract (accordion, tabs, carousel, modal)
- JS hook via `data-cmp-is="<name>"` (NOT the BEM class).
- Scope every query to the component root; never `document.querySelectorAll`.
- Idempotent init via `data-cmp-initialized`.
- Multiple instances on one page must not interfere.
- Initial state matches the design frame — encoded at render time in class list AND ARIA attrs (`aria-expanded` / `aria-selected` / `aria-current`), not solely in JS.
- Semantic HTML: `<button type="button">` for triggers; `role="tabpanel"` / `role="region"` + `aria-labelledby` on panels.
- IIFE + `DOMContentLoaded`. No inline handlers, no globals.
- Load via per-component clientlib (`js.txt` + `js/<name>.js`), same category as the CSS.
- Smoke test after deploy: rendered item count == `getItems().size()`; JS URL returns 200; grep for `data-cmp-is` and the toggle class.

## Style-variant contract (multi-design reuse) — MANDATORY when a shared block appears in more than one design
When the same conceptual block (hero, header, footer, services, …) exists in a second design with a different look, do NOT create a second component. Extend the existing generic one:
- **Model:** add `@ValueMapValue @Default(values = "<style-key-a>") private String style;` and a `getStyle()`. Value keys are short, kebab-case, role-neutral labels chosen by the run (e.g. `style-a`, `style-b`, `default`, `alt`) — never derived from a brand, product, campaign, or Figma file slug.
- **Model fields:** superset both designs. Fields used by only one style keep sensible `@Default`s and are guarded in HTL by `data-sly-test="${model.style == '<key>'}"`. Multifield children may also carry a per-item `style` field when the same list renders differently between designs. Before adding ANY new field, exhaust reuse of existing semantically-equivalent slots (see Author-experience preservation contract).
- **Dialog:** add a `Design Style` select at the top of the Style tab with all supported keys and a `selected` default matching the first design; **hide style-specific fields with `cq-dialog-dropdown-showhide` off the Design Style select** so authors only see fields that apply to the chosen style; only when showhide is impractical (e.g. shared containers), label design-specific fields with a `(<style-key>)` suffix in `fieldLabel`; use `fieldDescription` when the intent isn't obvious. Never make a new style-specific field required.
- **HTL:** the root element carries **both** `cmp-<name>` and `cmp-<name>--style-${model.style @ context='attribute'}`. Structure that differs between designs lives inside sibling `<sly data-sly-test="${model.style == '<key>'}">` blocks — never in JS, never selected at render by CSS alone.
- **CSS:** each style's rules are scoped under `.cmp-<name>--style-<key>` selectors (or land in a separate `<name>-<key>.css` file added to the same `css.txt`). Never redefine base `.cmp-<name>__…` rules to switch look; add a modifier scope instead.
- **Tokens:** design-specific tokens are declared under a design-scoped `:root` block (e.g. `--<style-key>-*`) in the shared tokens clientlib and consumed only inside that style's scoped selectors. Do NOT put design-specific values in the site-wide `body,html` block.
- **Site clientlib global resets:** never write `[class^="cmp-"]` selectors that would bleed into AEM Core Components. Scope resets either to an explicit list of this project's block roots (`.cmp-hero, .cmp-header, …`) or to a `--style-<key>` modifier.
- **Authoring:** each authored instance sets `style="<key>"` explicitly (or omits it to accept the model default). The `instance_authoring_map` records the `style` value per instance.
- **Reuse decision row:** when the shared block already exists in the project, Step 1.5 records it as Tier 2 with `additions: ["style variant '<key>'", "<style-key>-only field 1", …]` and the `gap` states "new design theme; same conceptual block, extended via `style` variant". Creating a second component (Tier 4) with a duplicate concept is a defect.

## Author-experience preservation contract — MANDATORY on every reuse (Tier 1/2/3)
Extending an existing component must feel invisible to authors of pre-existing content. Enforce every rule below:
- **Additive only.** Never remove or rename an existing dialog field, model getter, BEM class, style option, resource-type node name, or property key. Downstream authored content depends on them. Renaming = migration work the run does not own.
- **Reuse dialog slots aggressively.** Before adding a new field, map the design's data to existing fields with a semantically equivalent role: `image` covers photo / portrait / illustration / hero visual; `tagline` covers eyebrow / kicker / label; `description` covers subhead / lede / body copy; `ctaLabel` + `ctaLink` cover any single primary CTA; `backgroundImage` covers any full-bleed image. Only introduce a new field when NO existing slot can carry the value without conflicting with another style.
- **Every new field is optional.** New fields MUST have a sensible `@Default` in the model AND MUST NOT set `required="{Boolean}true"` in the dialog. The component MUST render acceptably when the new field is blank.
- **Style-scoped visibility.** Hide style-specific fields from the dialog when they don't apply, using `cq-dialog-dropdown-showhide` bound to the Design Style select. The author sees only what's relevant to the chosen style. Fallback (only if showhide isn't possible for that field's container): suffix `fieldLabel` with `(<style-key>)`.
- **Preserve the shipped default.** The Design Style select's `selected="{Boolean}true"` MUST stay on the pre-change default option. Never demote or re-order existing options such that a previously authored instance switches look.
- **Zero regression on existing instances.** Every previously authored instance (any style value, including empty/default) MUST render byte-identically at every breakpoint after the change. Verify by rendering EVERY pre-existing demo page that uses the component (`travel-landing`, `furniture-home`, etc.) alongside the new page and diffing the output — HTML, computed styles on the root and two nested elements, and screenshots.
- **No new required steps.** Do not add mandatory dialog tabs, mandatory container structure, mandatory clientlib includes, or mandatory policy changes to the existing component. Existing pages must open in the editor without new validation errors.
- **Author-facing labels stay generic.** Style option `text` values describe the visual role or layout ("Split + Illustration", "Full-bleed", "Centered"), never a brand, product, campaign, page name, or Figma file slug. The internal `value` key follows the same rule (see A25 / generic-name enforcement).
- **Don't fork templates or policies to expose a variant.** The new style must appear wherever the component is already allowed. Do not create a new template solely to host it; do not fork the policy tree.
- **Interactive contracts survive.** The `data-cmp-is` hook, `data-cmp-initialized` guard, ARIA state, and any keyboard handlers MUST continue to work for existing instances with no code changes on the author's side.
- **Editor-mode verification.** Load `/editor.html<pre-existing-page>.html` for every pre-existing page that hosts the component, open the component's dialog, and confirm: (a) the dialog opens with no console errors, (b) previously authored values populate the same fields, (c) no orphan fields are visible for the current style, (d) the empty-state placeholder still fires when appropriate.

Any violation of the above blocks the run — fix the extension, not the audit.

## Per-instance spatial-authoring rule
For every visual delta between sibling instances (alternating offset, variable side gutter, section padding, alignment, vertical stagger, column-order swap):
- Dialog field: select with token-named options (`none / sm / md / lg`) or numeric, sensible default matching the most common Figma instance.
- Sling Model: `@ValueMapValue` + `@Default` + getter.
- HTL: `cmp-<name>--<field>-${model.<field> @ context='attribute'}`.
- CSS: modifier class sets a scoped CSS custom property; layout reads that variable. Tablet/mobile media queries reset the variables to a centered default.
- Sample content authors each sibling instance with the EXACT per-instance values shown in the design.

## CSS contract
- One CSS file per component under `ui.apps/.../clientlibs/clientlib-<name>/css/`.
- One selector per modifier class — don't stack unrelated concerns.
- "Card hugs one side": use `justify-content: flex-start | flex-end` (or grid `justify-self`), NOT margins/translates. Card `max-width` = `calc(var(--das-container-max) - var(--das-space-N))`.
- "Image other side": swap `grid-template-areas` or `flex-direction: row-reverse` in the modifier class.
- Tablet ≤1024px collapses side-by-side to stacked+centered; mobile ≤640px reduces padding. Use design-frame widths if multiple exist.
- **A15 — proportional inner container.** If the design frame's usable content width is materially smaller than the project container-max, cap the component's inner container to a shared narrower token FIRST — before adjusting `justify-content` / `gap` / margins — otherwise `space-between` / `flex-wrap` / `1fr` distribute unbounded remaining space and siblings drift apart visually.

## Page-level styles (A9)
Body background, base font-family/color/size/line-height, section vertical rhythm, default link color and focus-outline live on the site clientlib (`body` or `.das-page` wrapper), NOT per component. If a component's CSS repeats a `body`-level style, move it to the site clientlib.

## Web-font loading (A6)
Recording a font family as a token is not enough. For every non-system font in DESIGN_SOURCE, wire an `@font-face` (self-hosted `.woff2` under `clientlib-tokens/fonts/`) OR licensed CDN `<link>` in the tokens clientlib. `font-display: swap`. Ship only the weights the design uses. Verify computed `font-family` in the browser matches the token.

## Image rendering (A10)
For every image slot: `aspect-ratio: <w> / <h>` from the design, `object-fit: cover | contain` per intent, wrapper `overflow: hidden` when the design shows rounded media corners.

## Accessibility floor (A12)
Enforced even when the design is silent: `:focus-visible` ring, 44×44 CSS px hit-targets on mobile, WCAG 2.1 AA contrast (≥4.5:1 body, ≥3:1 large), semantic landmarks, heading order, `<button>` for actions, `<a>` for navigation, meaningful `alt` (empty for decorative). If the design's contrast fails AA, adjust the color token to the nearest compliant value and flag in the Final summary.

## Unit-test contract
JUnit 5 + wcm.io AEM Mocks, `AppAemContext.newAemContext()`, one test class per component:
- `defaultsWhenEmpty` — empty resource; assert defaults, `getBackgroundStyle() == null`, multifield empty, `isHasContent()` matches empty expectation.
- `configuredFully` — every field set including color=`"other"` + valid hex + populated multifield; assert every getter and `getBackgroundStyle() == "background-color: <hex>;"`.

Run `mvn -pl core test -Dtest=<ModelName>Test` before deploying.

## Content-package gotcha
`ui.content` typically uses `mode="merge"` — adds missing nodes but does NOT update properties on existing ones. If a schema changed and stale instances remain, delete them via authenticated Sling POST (CSRF token required) OR temporarily switch to `mode="update"` OR re-author via dialog. Plain merge works fine for net-new content.

## Step 0 — Discover
- Read `AGENTS.md`, `CLAUDE.md`, `README.md` → build command, module layout, package prefix, component group, clientlib naming, content root.
- List `.agents/skills/` and record each SKILL.md `name` + `description`.
- Inventory `ui.apps/.../apps/<project>/components/`: for each, capture folder, `jcr:title`, `componentGroup`, `sling:resourceSuperType`, top-level dialog tabs/fields. Note Core Components already in use.
- Inventory `conf/<project>/settings/wcm/templates/` and `.../policies/`.
- Determine mode (A/B/C). Mode A/C: parse URL → fetch Figma via the tool sequence above and pull assets to a local scratch folder. Mode B/C: parse DESIGN_FILE (page count, per-page text/fonts/colors/geometry/embedded images).
- Record raw values; do not paraphrase.

## Step 1 — Decompose the design
Per distinct reusable block: semantic kebab-case name, variants/modifiers (→ dialog selects), author-editable fields, interactive state and initial/active behavior, repeating children (→ composite multifield + child model).

## Step 1.5 — Reuse-first decision (MANDATORY before Step 4)
Pick the highest tier that satisfies the design without loss of fidelity:

| Tier | Meaning                    | Emit                                                                                             |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| 1    | Reuse project component    | Sample content only; optionally one dialog option overlay via Sling Resource Merger.             |
| 2    | Extend project component   | `.content.xml` with `sling:resourceSuperType`, delta dialog overlay, delegating model.           |
| 3    | Extend Core Component      | Same mechanics via `@Self @Via(type = ResourceSuperType.class)` + `implements ComponentExporter`.|
| 4    | Create new                 | Full deliverable via `create-component` skill.                                                   |

Tier 4 requires the `gap` string to rule out tiers 1–3 explicitly. Same-fields-different-look → variant select on ONE component. Different fields/structure → sibling extension via `sling:resourceSuperType`, named `<parent>-<qualifier>`. Two components in the same group with >80% dialog overlap = defect.

**Author-facing disambiguation.** When a base + sibling extension coexist: distinct `jcr:title` and `jcr:description`, both listed in the policy's `allowedComponents` in order (base first), distinct `cq:icon` where possible.

Emit the decision as a `design-facts` YAML block **inline in the response** (do not create a file):
```yaml
reuse_decisions:
  - design_block: "<name>"
    tier: 1 | 2 | 3 | 4
    reuse_target: "<project>/components/<name>" | "core/wcm/components/<name>/vN/<name>" | null
    gap: "<one-line justification if tier > 1, else 'none'>"
    additions: ["<delta dialog field>", "<delta variant>", "<delta CSS modifier>"]
template_decision:
  reuse_template: "<template-name>" | null
  new_template_gap: "<justification if new>"
policy_decisions:
  - policy_path: "<existing-policy-path>"
    additions: ["<resource-type added to allowedComponents>"]
instance_authoring_map:
  - figma_instance: "<frame or short label>"
    resource_type: "<project>/components/<name>"
    parent_path: "<content path under the template's editable region>"
    node_name: "<unique node name — e.g. teaser_hero>"
    dialog_values:
      style: "hero"
      title: "<exact copy from Figma>"
      # ...every non-default field from that instance
```
Rules: one row per Figma instance in reading order; `resource_type` MUST match `reuse_target` or a Tier-4 new component (no orphans); same resource_type + different dialog values = correct outcome for "same component, different look"; `node_name` hints at the variant, never `_1` / `_2`.

## Step 2 — Extract design facts
Per component: outer container width, page gutter (per instance), section padding, internal gaps, per-element padding/margin, radius/border/shadow, per-text-style font (family/weight/size/line-height/letter-spacing/color), background/text/border/accent color hex, icon dimensions, image aspect ratios, hover/focus/active states, responsive intent. Cross-check ambiguous PDF geometry against the matching PNG. **Per-instance spatial deltas** across N sibling instances = dialog fields (per the spatial-authoring rule).

## Step 3 — Shared design tokens
Create or update the shared tokens clientlib. If DESIGN_TOKENS_JSON exists, map 1:1 to CSS custom properties. Otherwise derive tokens from Step 2 repeated values. Add tokens for every unique value including spatial-offset tokens.

## Step 4 — Realise blocks via reuse tier
- **Tier 1:** no code — only sample content in Step 9 (plus optional dialog overlay).
- **Tier 2/3:** invoke `create-component` with the parent as `sling:resourceSuperType`; emit ONLY delta files (dialog overlay, delta model, optional CSS modifier). Do NOT re-emit parent HTL/dialog/model/clientlib.
- **Tier 4:** invoke `create-component` in full with the spec (name, group, dialog fields with types / required / defaults / descriptions, variants including spatial fields and color `other` / hex, Properties / Style tabs, tokens, breakpoints, interactive behavior). Per-component clientlib depends on the shared tokens clientlib.

## Step 5 — CSS parity
Apply design values via tokens. For every component that renders multiple times: diff the N instances (offset, stagger, alignment, side margin, column order, gutter) and confirm dialog field + BEM modifier + CSS custom property + layout property reading it. Confirm tablet/mobile media queries reset per-instance vars to the centered default.

## Step 6 — HTL structural validation
Apply the HTL iteration rule for every multifield/list. Every per-item element that JS/CSS addresses individually carries `data-index="${itemList.index}"`. After Step 9, verify rendered DOM has N sibling per-item elements.

## Step 7 — Interaction correctness
Scope queries to root; on state change clear siblings first; support multiple instances; `data-cmp-initialized` guard; first item active on load; ARIA reflects state at render.

## Step 8 — Clientlibs
Every per-component clientlib depends on the shared tokens clientlib. Site-level wiring (embed OR HTL include) delivers all styling on any page.

## Step 9 — Author the demo page
Under the project's content root, create a sample page. Reuse the best-matching existing template. Drop components in the design's reading order, populated with the design's copy and images. Upload every extracted image to `/content/dam/<project>/design/`. When the design shows N sibling instances with alternating variants/offsets, author those EXACT per-instance values in the same order. Author under the template's editable region path (inner responsive-grid container, NOT the page root). If schema changed on already-authored nodes, apply the content-package gotcha recovery.

## Step 10 — Build, install, verify
1. `mvn -pl core clean test` — green before deploying.
2. Local install (`mvn install -PautoInstallSinglePackage -DskipTests` or equivalent). BUILD SUCCESS with 0 analyser warnings.
3. **Fetch demo page** with `?wcmmode=disabled`, Basic auth `admin:admin`, `Referer` header. Verify in ONE batched grep pass:
   - Every component's BEM root class appears.
   - List-driven components: per-item element count == authored multifield size.
   - Stateful components: exactly ONE per-item element carries the initial `--active` modifier + matching `aria-selected="true"`.
   - Each per-instance spatial variant modifier class count matches DESIGN_SOURCE.
   - `other`+hex color instances emit inline `style="background-color: #…"` on the root.
   - Zero `SightlyException`.
4. **Fetch deployed clientlib CSS** for each per-component clientlib and confirm modifier rules are present (defends against stale-cache).
5. **Visual parity (A4/A11).** Side-by-side against the design at native width and every design-defined breakpoint. If browser tooling exists, automate the diff.
6. **Author-mode parity (A17).** Load `/editor.html<demo-page-path>.html` and verify computed `font-family`, `background-color`, `color`, gradients / shadows / borders / radii match the design at every breakpoint. Ignore only editor chrome and empty-state placeholders.
7. Iterate on any mismatch: token → CSS → dialog option → component redesign. Cap at 3 attempts per gap (A23); after that STOP CSS-tweaking, re-read Steps 1–2, and if unresolvable escalate to the user with a screenshot pair and a specific A/B question — never spin silently.

## Deliverables per block
| Tier | Files                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Sample authored content only. Optional dialog overlay via merger. No new component files.                                            |
| 2/3  | `.content.xml` (with `sling:resourceSuperType`), delta `_cq_dialog/.content.xml`, delegating `<Name>Model.java`, delta CSS/JS if any, `<Name>ModelTest.java` (delta getters), sample content per variant. |
| 4    | Full: `.content.xml`, `_cq_dialog/.content.xml` (Properties + Style), `<component>.html`, `<Name>Model.java` + child models, `clientlib-<name>/` (`.content.xml`, `css.txt`, `css/*.css`, optional `js.txt`, `js/*.js`), `<Name>ModelTest.java` (`defaultsWhenEmpty` + `configuredFully`), sample content per variant, resource type added to existing policy `allowedComponents`. |

## Final summary
Include: skills loaded from `.agents/skills/`; Step 0 inventories; reuse-decision table (tier + gap + additions per block); component decomposition; skills invoked (must match tiers 2/3/4); design inputs consumed; tokens created / updated; per-component file paths (tier 1 says "no new files (reused <parent>)"); template + policy decisions; HTL iteration audit; per-instance spatial-field audit; unit-test results; rendered-DOM check results; deployed-clientlib check results; interaction guards applied; demo page path; build status; residual gaps.

**Evidence per component (A22):** screenshot pair (design + rendered) at every breakpoint, computed-style excerpt from DevTools/Playwright (`font-family`, `font-weight`, `font-size`, `line-height`, `background-color`, `color`, `padding`, `border-radius`, `box-shadow` on root and 2–3 nested elements), cross-referenced to the `design-facts` block. Deltas > 1px or > 1 hex digit = failure, iterate. If browser tooling unavailable, substitute rendered HTML + clientlib CSS excerpts + manual measurement callouts and state so explicitly.

## Discipline (do these on EVERY iteration)
- **Exact values (A19):** copy hex / px / weight / line-height / letter-spacing byte-for-byte. No rounding.
- **Figma auto-layout → CSS (A20):** direction → `flex-direction`; item spacing → `gap`; main-axis alignment → `justify-content`; cross-axis → `align-items`; sizing (Hug / Fill / Fixed) → intrinsic / `flex: 1` / explicit px; wrap → `flex-wrap`. Absolute children → `position: absolute` on child + `relative` on parent.
- **`design-facts` block (A18)** posted inline before writing code and updated before every iteration. Every CSS/HTL/dialog line traces to a row in the current block.
- **Additive changes (A5):** add a new token / dialog option / BEM modifier rather than mutating existing ones. Downstream authored content depends on them.
- **Unclassifiable elements (A13):** STOP and ask with a screenshot region reference. Never substitute a lookalike Core Component.
- **Reuse enforcement (A24):** every design block has a `reuse_decisions` row with tier + gap. Tier 4 requires the gap to rule out 1–3. Extension diff must contain only declared `additions`. No new policy tree without a new template.
- **Generic-name enforcement (A25):** before Step 4, grep the target project for any component folder / model / clientlib category / BEM class whose name contains a brand, product, campaign, design-system nickname, Figma file slug, page name, or version tag as a prefix or suffix (i.e. anything other than the pure block role name). Rename each to the generic role name in the same run. A component named after a design, brand, or source file is a defect — the correct outcome is a single generic component with a `style` variant per design. Same conceptual block authored twice under different prefixes = duplication defect.
