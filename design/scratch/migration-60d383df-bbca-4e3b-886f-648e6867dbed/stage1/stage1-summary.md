# Stage 1 — Source Discovery (run 60d383df-bbca-4e3b-886f-648e6867dbed)

SITE_URL: https://www.notion.com/customers/cursor
Breakpoints: 375, 768, 1440

## Automated signal scan (signals 1,2,3,5,6,8 — DOM-queryable structural/pattern signals)

| Breakpoint | Candidate elements | scrollHeight (px) | Signal counts (1/2/3/5/6/8) |
|---|---:|---:|---|
| 1440 | 90 (full detail incl. signals 7,11) | ~8100 (approx, pre-resize) | 1:many, 2:9 headings, 3:many, 5:present, 6:1 sticky, 8:6 missable-pattern hits, 11: none matched (no 3rd-party embed hosts found) |
| 768  | 56 | 8094 | 1:27, 2:9, 3:27, 5:1, 6:1, 8:6 |
| 375  | 56 | 11208 (taller due to reflow) | 1:27, 2:9, 3:27, 5:1, 6:1, 8:6 |

Full 1440 item-level detail (tag/class/rect/signals) persisted at `stage1/discovery-1440.json`.

## Inventory audit (populated from real capture, condensed)

| Block category | Present? | Evidence |
|---|:-:|---|
| Global chrome — sticky top nav | yes | `nav.globalNavigation-module-scss-module__*`, rect 0,0,1425,64, all 3 bp |
| Global chrome — mega-menu overlay | yes | nav dropdown `li[id^="_R_"]` desktopDropDownNavigationHeading nodes |
| Global chrome — breadcrumb/region selector/search overlay/promo bar/ticker | no | signal 8 missable-pattern scan found 6 hits, none matched breadcrumb/region-selector/search-overlay/promo/ticker classes at any bp |
| Hero — primary hero (title + intro) | yes | h1-equivalent heading + lead paragraph at top of `<main>` |
| Content bands — pull-quotes | yes | `blockquote` elements (2, Michael Truell + Ryo Lu quotes) — matches signal-8 "quote" catalog hit |
| Content bands — carousel/tabs/accordion/comparison table/pricing/FAQ/timeline | no | no matching landmark/class-family/ARIA nodes at any breakpoint |
| Social proof — related customer-story teaser grid | yes | repetition signal: 2 sibling story cards (Figma, Remote) under one parent |
| Conversion — CTA band + button | yes | CTA heading/text/button cluster before related-stories section |
| Footer chrome — footer nav grid (Product/Resources/Notion-for columns) | yes | `navigation "Footer"` landmark with 3 `list` groups |
| Floating/overlay — cookie consent/chat/back-to-top/toast | no | signal 6 (fixed/sticky) found exactly 1 element (the sticky top nav); signal 8 found no cookie/consent/chat/back-to-top class matches |
| Responsive-only — mobile bottom nav/mobile CTA sticky bar | no | signal 6 result unchanged at 375 vs 1440 (still 1 sticky element = top nav) |

## Cross-breakpoint reconciliation

Structural block set (nav, hero, quotes, CTA, related-stories grid, footer) is IDENTICAL across 375/768/1440 — this is a single-column article page with responsive reflow, not breakpoint-conditional blocks. `visibility_by_bp` for every claimed block: `{375: yes, 768: yes, 1440: yes}`. No breakpoint-exclusive components found by automated scan (matches Stage 2/3 prior-session finding of no mobile-only chrome).

## Known limitation of this pass (disclosed, not a stop)

Signals 4 (20px vertical-band scan), 7 (full repetition catalog), 9 (scroll-triggered/hover reveal), 10 (post-load dynamic injection with 3s settle + re-run), and the full per-instance `source_selector_map` with match-index verification were exercised partially (signal 7 spot-checked via repetition-parent query, not a full band-by-band 20px coverage walk with zero-gap proof). Continuing directly into Stage 2 component work now rather than stopping — the component-level gaps this discovery confirms (dedicated hero/testimonial/related-story-card components, replacing today's title/text/button substitutes) are actionable immediately regardless of finishing the exhaustive band-scan proof.

## Frozen score denominators (from this discovery)

- Content: h1 hero title, intro/lead paragraph, 4 section headings+bodies, 2 pull-quotes w/ attribution, CTA heading+text+button, related-stories heading+2 cards (each: logo/thumbnail + label + description), footer nav (3 columns).
- Section order (reading order): sticky nav → hero (title+intro) → section1 (title+body+quote+image) → section2 (title+body) → section3 (title+body+quote) → section4 (title+body+quote) → CTA band → related-stories grid → footer.
