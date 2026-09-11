# Source Discovery And Coverage

Owns discovery, coverage, selectors, and frozen scoring denominators. Input: runtime URL, breakpoints, evidence directory, and `run_id`. Complete source evidence before inspecting the target.

## Readiness

Execute [capture gates](references/capture-gates.md) against the source at every required breakpoint, including video frame presentation BEFORE freezing motion. Freeze geometry only after the final discovery union is stable. Save readiness and network failures, not inferred success.

## Exhaustive Block Discovery

Assign stable `instance_id`s in reading order. Run ALL signals at EVERY runtime breakpoint and union candidates; headings or landmarks alone are insufficient.

1. Semantic landmarks and ARIA: `header`, `footer`, `main`, `nav`, `aside`, `article`, `section`, `form`, `figure`, `dialog`, `details`, region/list/status/dialog roles, and elements with labeling attributes.
2. Heading anchors: `h1` through `h6` and their nearest visual owners.
3. Class-family signals: visible elements wider than 200 px and taller than 8 px whose classes match `/(section|wrapper|container|block|panel|band|strip|bar|marquee|ticker|scroller|carousel|slider|announce|promo|cta|hero|footer|header|feature|nav|banner|consent|cookie|toast|snackbar|modal|drawer|sticky|float)/i`.
4. Vertical-band scan: sample the full page in 20 px y-steps and associate every distinct painted band with the smallest owner at least 60% of page width. This must catch headless decorative regions.
5. Interaction/media signals: video, audio, canvas, iframe, embed, object, component/tracking data attributes, non-`none` animation names, and changing transforms.
6. Floating/overlay signals: visible `fixed` or `sticky` elements and positive-z-index elements overlapping the viewport.
7. Repetition signals: parents with two or more visually equivalent direct children. Record the parent as a block and each child as an instance row.
8. Missable-pattern catalog: explicitly search classes/IDs/data attributes for `promo`, `marquee`, `ticker`, `announcement`, `cookie`, `consent`, `back-to-top`, `breadcrumb`, `logo-strip`, `stats`, `quote`, `divider`, `pinned`, `newsletter`, `region-selector`, `search-overlay`, `mega-menu`, `skip-link`, `preloader`, `progress`, and `chat`.
9. Scroll-triggered and viewport-conditional signals: elements that only appear after specific scroll depths, hover triggers on the source, or CSS media queries other than the current breakpoint. Scroll the page top→bottom→top before capturing; record any element whose `getBoundingClientRect().height` becomes non-zero mid-scroll.
10. Dynamic-injection signals: elements added to the DOM after `document.fonts.ready`, from `data-*` toggles, from `IntersectionObserver` triggers, from React/Vue portals, or from XHR-loaded partials. Wait at least 3 000 ms after `load` and re-run signals 1–9 before freezing evidence.
11. Third-party embed signals: iframe hosts (`youtube.com`, `vimeo.com`, `player.*`, `embed.*`), Segment/Amplitude/analytics injectors, chat widgets, consent management platforms (`onetrust`, `cookiebot`, `usercentrics`, `didomi`, `trustarc`, `truste`), A/B-test containers (`optimizely`, `vwo`, `abtasty`), and marketing-form hosts (`hubspot`, `marketo`, `salesforce`, `chilipiper`).

An omitted block invalidates discovery: add it, rerun signals 1–11, and refresh affected downstream evidence in the same run.

## No-Omission Component Inventory (mandatory)

Produce one `inventory_audit` row per catalog member below. `yes` requires selector + rect + screenshot region and a manifest owner. `no` requires signal number, exact selector/class/ARIA/data query, zero visible/non-empty matches at each breakpoint, and scroll states checked. “Not seen” and blank rows are invalid.

| Block category | Catalog member | Present? | Evidence (selector / rect / screenshot) or negative citation |
|---|---|:-:|---|
| Global chrome | skip link, announcement / promo bar, ticker, sticky top nav, mega-menu overlay, secondary utility bar, breadcrumb, search overlay, region/language selector | | |
| Hero and marquee | primary hero, secondary hero, headless media band, background-video strip, animated background canvas | | |
| Content bands | intro / lead paragraph, two-column text section, feature grid, stat strip, quote / pull-quote, media-with-caption, carousel / slider, tabs, accordion, comparison table, pricing grid, FAQ, timeline, roadmap | | |
| Social proof | logo strip / brand reel, customer story teaser, testimonial marquee, review stars, awards / badges | | |
| Conversion | inline CTA button strip, CTA band, newsletter signup, contact / demo form, download panel, calendly / chili-piper widget | | |
| Related / cross-sell | related articles, related case studies, product carousel, "also on this site" grid | | |
| Footer chrome | pre-footer CTA, footer quote/tagline, footer nav grid, secondary links row, copyright bar, social icons row, legal links strip |  | |
| Floating / overlays | cookie consent, GDPR banner, chat widget, back-to-top, floating CTA, notification toast, video-lightbox trigger, gated-content modal, geo/redirect prompt | | |
| Responsive-only variants | mobile-only bottom nav, mobile CTA sticky bar, mobile mega-menu drawer, tablet-only sidebar | | |

## Cross-Breakpoint Reconciliation

Union `yes` rows across the runtime breakpoint list, not its intersection. In `score_manifest`, record `visibility_by_bp: {<width>: yes|no}` for each block. Visibility differences drive Stage 2 variants, not omissions. This includes replacement `BREAKPOINTS`, not only the defaults.

## Source Selector Map

Publish one row per visible source instance for Stage 4 runner configuration:

| Instance ID | Breakpoint | Stable source selector | Match index | Expected matches | Text/media signature | Source rect |
|---|---:|---|---:|---:|---|---|

The selector plus match index MUST resolve to exactly the intended instance in the frozen source DOM. Prefer stable semantic, ID, or data-attribute selectors. When hashed classes are unavoidable, record the exact observed selector and a text/media signature that detects a wrong match. A component-type selector without an instance index is insufficient when more than one instance matches.

## Coverage Proof

Emit a `coverage_report` at every breakpoint:

| From y | To y | Instance ID or `UNCLAIMED` | Class chain | Discovery signals |
|---:|---:|---|---|---|

Assign intentional whitespace to its neighboring/owning block. Sorted merged block ranges must cover `[0, document.documentElement.scrollHeight]` with no unclaimed gap of 20 CSS px or more. Any such gap blocks scaffolding.

Also assert:

- every candidate from every discovery signal maps to exactly one manifest owner;
- every manifest owner marked visible has a non-empty rect at the active breakpoint; verify hidden owners against `visibility_by_bp`;
- every class/ID matching the missable-pattern catalog is claimed;
- source block order and adjacency match the screenshot bands.

## Frozen Evidence

Before target inspection, retain per breakpoint:

- full-page screenshot;
- `score_manifest` with block/instance order and source rects;
- ownership and exactly-once coverage maps;
- source-DOM manifest: visible node tag, first 60 text characters, classes, attributes, relationships, absolute/section-relative rects, and computed styles;
- responsive/state matrix: layout class, visible order/count, overflow, clipping, controls, pagination, and initial/hover/focus/active states;
- one complete carousel transition or marquee/ticker animation cycle where applicable;
- media manifest including resolved network URLs and all relevant media attributes;
- source metadata: title, description, canonical, and OG values.

Computed-style capture includes typography, all color properties, background image, opacity, borders, radius, shadow, display/position, spacing, flex/grid properties, aspect ratio, object fit, overflow, and raw rect geometry. Do not round raw evidence.

## Frozen Score Denominators

- Content 25%: every visible role, copy unit, heading, media slot, CTA, and control.
- Typography 25%: family, size, weight, style, line-height, letter-spacing, transform.
- Color 20%: foreground/background/border/decoration/icon colors, opacity, shadow.
- Layout 15%: relative x/y, dimensions, spacing, borders/radius/gap, display/position, flex/grid.
- Section order 10%: every direct source region in reading order.
- Media/interaction 5%: media class, asset, fit/aspect, controls, initial state, transitions.

N/A is permitted only when source evidence proves the role/property absent.

## Required Stage Result

Persist the router's envelope with `stage: 01-source-discovery`, runtime inputs, and:

- **outputs:** `readiness_report`, `score_manifest`, `coverage_report`, `ownership_map`, `source_selector_map`, `inventory_audit`, `dom_state_media_manifests` (including metadata/screenshots/fingerprint), `frozen_denominators`.
- **checks:** `all_breakpoints_ready`, `all_discovery_signals_executed`, `inventory_audit_complete`, `cross_breakpoint_visibility_recorded`, `every_instance_has_stable_source_selector`, `exactly_once_coverage`, `no_unclaimed_gap_20px`.
- **next_stage:** `02-component-authoring` only on PASS; otherwise null.

PASS requires complete inventory, all signals, exactly-once ownership, and no unclaimed gap of 20 CSS px or more at any breakpoint.