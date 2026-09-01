# Source Discovery And Coverage

This file owns source readiness, exhaustive block discovery, manifests, and frozen scoring denominators. Complete it before inspecting the target.

## Readiness At Every Breakpoint

1. Set the viewport and assert `window.innerWidth` exactly. Record DPR and `visualViewport.scale`.
2. Await `document.fonts.ready`; require `document.fonts.check()` for every measured non-system family.
3. Trigger lazy loading and require visible images to be decoded (`complete`, `naturalWidth > 0`, `naturalHeight > 0`) and visible video/audio to have `readyState >= 2`.
4. Verify external font/background/media responses from network events or direct HEAD with GET fallback.
5. Inject measurement-only CSS that disables animation, transition, and smooth scrolling. Require tracked rects to remain unchanged across samples at least 500 ms apart. Restore motion before interaction capture.

Wrong viewport, unresolved fonts/media, or unstable layout invalidates the capture.

## Exhaustive Block Discovery

Create one stable `instance_id` per visible block in reading order. Build the candidate set from the **union** of all signals below; headings or landmarks alone are insufficient.

1. Semantic landmarks and ARIA: `header`, `footer`, `main`, `nav`, `aside`, `article`, `section`, `form`, `figure`, `dialog`, `details`, region/list/status/dialog roles, and elements with labeling attributes.
2. Heading anchors: `h1` through `h6` and their nearest visual owners.
3. Class-family signals: visible elements wider than 200 px and taller than 8 px whose classes match `/(section|wrapper|container|block|panel|band|strip|bar|marquee|ticker|scroller|carousel|slider|announce|promo|cta|hero|footer|header|feature|nav|banner|consent|cookie|toast|snackbar|modal|drawer|sticky|float)/i`.
4. Vertical-band scan: sample the full page in 20 px y-steps and associate every distinct painted band with the smallest owner at least 60% of page width. This must catch headless decorative regions.
5. Interaction/media signals: video, audio, canvas, iframe, embed, object, component/tracking data attributes, non-`none` animation names, and changing transforms.
6. Floating/overlay signals: visible `fixed` or `sticky` elements and positive-z-index elements overlapping the viewport.
7. Repetition signals: parents with two or more visually equivalent direct children. Record the parent as a block and each child as an instance row.
8. Missable-pattern catalog: explicitly search classes/IDs/data attributes for `promo`, `marquee`, `ticker`, `announcement`, `cookie`, `consent`, `back-to-top`, `breadcrumb`, `logo-strip`, `stats`, `quote`, `divider`, `pinned`, `newsletter`, `region-selector`, `search-overlay`, `mega-menu`, `skip-link`, `preloader`, `progress`, and `chat`.

If a reviewer identifies an omitted block, invalidate discovery, add it, rerun all signals, and refresh downstream evidence.

## Coverage Proof

Emit a `coverage_report` at every breakpoint:

| From y | To y | Instance ID or `UNCLAIMED` | Class chain | Discovery signals |
|---:|---:|---|---|---|

Assign intentional whitespace to its neighboring/owning block. Sorted merged block ranges must cover `[0, document.documentElement.scrollHeight]` with no unclaimed gap of 20 CSS px or more. Any such gap blocks scaffolding.

Also assert:

- every candidate from every discovery signal maps to exactly one manifest owner;
- every manifest owner has a non-empty rect at the active breakpoint;
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
