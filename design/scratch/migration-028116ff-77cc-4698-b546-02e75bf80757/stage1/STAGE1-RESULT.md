# Stage 1 — Source Discovery Result

- run_id: 028116ff-77cc-4698-b546-02e75bf80757
- SITE_URL: https://www.notion.com/customers/cursor
- Target (informational only, not inspected this stage): http://localhost:4506, page `/content/demo-ai-site/us/en/customers/cursor`
- Breakpoints: 375, 768, 1440 (defaults; no runtime override supplied)
- Evidence root: `design/scratch/migration-028116ff-77cc-4698-b546-02e75bf80757/stage1/`
  - `manifest-{375,768,1440}.json` — full candidate/media/metadata manifest per breakpoint (11-signal union)
  - `readiness-{375,768,1440}.json` — viewport assertion + 3x geometry stability samples
  - `coverage-{375,768,1440}.json` — merged y-band ownership rows + gap analysis
  - `screenshot-{375,768,1440}.png` — full-page frozen screenshots (animations disabled at capture)
  - `supplemental.json` — targeted footer/hero/skip-link/logo-strip detail queries
  - `discover.mjs`, `coverage.mjs`, `supplemental.mjs` — reusable capture scripts (Playwright, Chromium)

## Readiness (all breakpoints PASS)

| BP | innerWidth req/actual (pre) | innerWidth (post-settle) | 3x geometry samples stable |
|---:|---|---|---|
| 375 | 375/375 | 375 | yes |
| 768 | 768/768 | 768 | yes |
| 1440 | 1440/1440 | 1440 | yes |

Fonts awaited via `document.fonts.ready`; full top→bottom→top scroll cycle run before AND after a 3000 ms dynamic-injection settle window (signals 9/10); animations/transitions disabled only for the final static screenshot capture, after motion-relevant signals were scanned.

## Section structure (breakpoint-invariant reading order)

Confirmed identical section landmark order/count at 375, 768, and 1440 (only heights reflow); no section appears/disappears across breakpoints, so `visibility_by_bp` is `{375: yes, 768: yes, 1440: yes}` for every instance below unless noted.

| Instance ID | Description | Source selector (stable) | Match idx | Text/media signature |
|---|---|---|---:|---|
| nav-header | Sticky global nav, product/AI/resources mega-menus (hidden until hover; DOM present) | `div#__next > div > div:nth-of-type(2) > nav` (sticky ancestor) | 1 | "ProductNotion AI..." |
| hero | H1 + close (×) icon, section 1 | `main > div > section:nth-of-type(1)` | 1 | "How the world's fastest-growing startup stays fast with Notion" |
| section-simplicity | "Simplicity solves for the complexities of scale" + insights aside (Michael Truell CEO, Ryo Lu Head of Design) | `main > div > section:nth-of-type(2)` | 1 | h2 "Simplicity solves for the complexities of scale" |
| section-build-vs-buy | "Why they build instead of buy" + bullet list | `main > div > section:nth-of-type(3)` | 1 | h2 "Why they build instead of buy" |
| quote-1 | Testimonial figure/blockquote | `main > div > section:nth-of-type(4) > figure` | 1 | "I honestly can't imagine running a design team without Notion..." |
| section-ai | "AI is strongest where work flows and knowledge grows" + list + video figure | `main > div > section:nth-of-type(5)` | 1 | h2 text; video `figure` at same section |
| video-cursor-notion-ai | Inline MP4, muted, contain fit | `main > div > section:nth-of-type(5) > div:nth-of-type(3) > figure > ... > video` | 1 | src `.../Cursor_NotionAI.mp4` |
| quote-2 | Testimonial figure/blockquote | `main > div > section:nth-of-type(6) > figure` | 1 | "Keeping people in the loop as we've grown so fast is really..." |
| section-modern-stack | "The modern stack: 5x fewer tools required" + list | `main > div > section:nth-of-type(7)` | 1 | h2 text |
| quote-3 | Testimonial figure/blockquote | `main > div > section:nth-of-type(8) > figure` | 1 | "We're moving away from a world where communication is siloed..." |
| cta-band | "Build with less tool sprawl and more focus" | `main > div > section:nth-of-type(9)` | 1 | h2 text |
| related-stories | "How other teams use Notion" + 2 cards | `main > div > div > section:nth-of-type(1)` | 1 | h2 "How other teams use Notion"; h3 "Remote…", h3 "…Rakuten France…" |
| related-card-remote | Customer story teaser card | `...section:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1)` | 1 | h3 "Remote Built a World-Class IT Help Desk..." |
| related-card-rakuten | Customer story teaser card | `...section:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(2)` | 2 | h3 "How Rakuten France turned every team into AI builders..." |
| footer-quote | Footer tagline quote | `footer#site-footer > div > div > div > figure` | 1 | "We shape our tools, and thereafter our tools shape us. — Marshall McLuhan" |
| footer-nav | Footer link grid, 47 links incl. product/resources/company + full locale/language switcher list + legal (Terms & privacy) | `footer#site-footer > div > div > nav` | 1 | "ProductFeaturesWhat's New…" |
| iframe-youtube (hidden) | `youtube-nocookie.com` embed, 0×0 at rest (loads on interaction) | `iframe#463735673` | 1 | src `youtube-nocookie.com/embed/txuTNgghan0` |

Unidentified 0×0 `<iframe>` with no `src` attribute at `html > body > iframe` — no resolvable resource, not a rendered content block; excluded from authoring scope as a negative citation (signal 11 checked, no attributable third-party host).

## No-Omission Inventory Audit

| Catalog member | Present? | Evidence / negative citation |
|---|:-:|---|
| skip link | no | Signal 8 (`skip-link`/`[class*=skip]`/`a[href="#main"]`), zero matches at any breakpoint |
| announcement/promo bar | no | Signal 8 (`promo`/`announcement`), zero matches |
| ticker | no | Only substring hit was an unrelated nav icon `svg` node (`missable:ticker` false-positive on a hashed class); no visible ticker/marquee band in any of the 3 screenshots |
| sticky top nav | yes | `nav-header`, computed `position: sticky`, confirmed via signal 6 floating/overlay scan at 1440 (present at all bp) |
| mega-menu overlay | yes | Signal 7 repetition-parent `ul` lists nested under `div#product`, `div#ai`, `div#resources`; DOM-present, closed by default (hover not exercised this pass — see gap note) |
| secondary utility bar | no | No candidate matched |
| breadcrumb | no | Signal 8, zero matches |
| search overlay | no | Signal 8 (`search-overlay`), zero matches |
| region/language selector | yes | Footer link list includes 15+ locale variants (`en-GB`, `es-ES`, `fr`, `it`, `nl`, `nb`, `pt`, `fi`, `sv`, `vi`, …) — `footer-nav` |
| primary hero | yes | `hero` |
| secondary hero | no | Only one `<h1>`-owning section on the page |
| headless media band | no | Only media found is the section-5 inline video, already owned by `section-ai` |
| background-video strip | no | `video` element is a contained figure, not a full-bleed background; no `background` shorthand video technique detected |
| animated background canvas | no | No `<canvas>` element in media manifest |
| intro/lead paragraph | yes | Hero contains supporting copy beneath the H1 (rendered in `screenshot-1440.png`) |
| two-column text section | yes | `section-simplicity` (heading + insights aside side-by-side) |
| feature grid | no | Sections 3/5/7 use plain bullet lists (`ul`), not a card/grid layout |
| stat strip | no | No dedicated stat row found |
| quote/pull-quote | yes | `quote-1`, `quote-2`, `quote-3`, `footer-quote` (4 instances) |
| media-with-caption | yes | `video-cursor-notion-ai` inside `section-ai` figure |
| carousel/slider | no | No carousel signals (no pagination/dots/arrow-group repetition matching a slide track) |
| tabs | no | No tab-list role or pattern found |
| accordion | no | No `<details>`/accordion pattern found |
| comparison table | no | No `<table>` found |
| pricing grid | no | Page links to `/pricing`; no on-page pricing grid |
| FAQ | no | No FAQ pattern found |
| timeline | no | No timeline pattern found |
| roadmap | no | No roadmap pattern found |
| logo strip / brand reel | no | `[class*="logo"]` scan only matches the site's own nav/hero logo, not a customer-logo strip |
| customer story teaser | yes | `related-card-remote`, `related-card-rakuten` |
| testimonial marquee | no | The 4 quotes are static blocks, not a moving marquee |
| review stars | no | No rating/star pattern found |
| awards/badges | no | No badge pattern found |
| inline CTA button strip | yes | Hero close-button `<button>` + CTA band buttons visible in screenshots |
| CTA band | yes | `cta-band` |
| newsletter signup | no | No email-capture form found |
| contact/demo form | no | Page links out to `/contact-sales`; no embedded form |
| download panel | no | No matches |
| calendly / chili-piper widget | no | No matching iframe host in `thirdPartyHosts` |
| related articles | n/a | Case-study page; `related-*` already covers cross-sell |
| product carousel | no | No matches |
| "also on this site" grid | yes | Same as `related-stories` |
| pre-footer CTA | yes | Maps to `cta-band` (section 9, immediately before related/footer) |
| footer quote/tagline | yes | `footer-quote` |
| footer nav grid | yes | `footer-nav` |
| secondary links row | yes | "Terms & privacy" legal link within `footer-nav` |
| copyright bar | no | No `©`/"copyright"/"all rights reserved" text node found in footer |
| social icons row | yes | 5 `<svg>` in footer beyond nav/legal links (icon count from `supplemental.json`) |
| legal links strip | yes | "Terms & privacy" link |
| cookie consent / GDPR banner | no | Signal 8 (`cookie`/`consent`), zero matches; none visible in screenshots |
| chat widget | no | No matching iframe/script host |
| back-to-top | no | Signal 8, zero matches |
| floating CTA | no | Only sticky element found is the nav itself |
| notification toast | no | Signal 8 (`toast`/`snackbar`), zero matches |
| video-lightbox trigger | no (inconclusive re: hidden YouTube iframe) | `iframe-youtube` is present at 0×0 and DOM-attached; no visible trigger control was matched to it this pass — flagged as an open Stage-1 follow-up, not fabricated as yes |
| gated-content modal | no | No modal/dialog pattern found |
| geo/redirect prompt | no | No matches |
| mobile-only bottom nav | no | Section order/count identical at 375bp; no additional mobile-only nav found |
| mobile CTA sticky bar | no | No matches |
| mobile mega-menu drawer | yes | Same nav mega-menu structure persists at 375bp (hamburger-style, DOM-present) |
| tablet-only sidebar | no | No matches at 768bp |

## Coverage Proof

`coverage-{375,768,1440}.json`: 0 unclaimed gaps ≥ 20 CSS px at any breakpoint (375: 75 rows/0 gaps; 768: 74 rows/0 gaps; 1440: 38 rows/0 gaps). Every candidate maps to exactly one band owner; section landmark order matches screenshot band order top-to-bottom at all 3 breakpoints.

## Frozen Score Denominators

Using the router's fixed weights verbatim (Content 25 / Typography 25 / Color 20 / Layout 15 / Section order 10 / Media-interaction 5); no page-specific override.

## Known Stage 1 gap (disclosed, not silently dropped)

Mega-menu hover-state and the hidden YouTube iframe's trigger were not interactively exercised in this pass (DOM-presence confirmed, interaction confirmed only for the required scroll cycle, not hover/click). This is recorded as an open item to verify before Stage 4 interaction checks for `nav-header` and the video-lightbox question mark above; it does not block Stage 2 authoring of the always-visible content already fully discovered.

## Stage Result Envelope

```yaml
stage_result:
  stage: 01-source-discovery
  result_id: stage1-028116ff-r1
  run_id: 028116ff-77cc-4698-b546-02e75bf80757
  status: PASS
  inputs_consumed: [SITE_URL, BREAKPOINTS=375/768/1440]
  outputs:
    readiness_report: stage1/readiness-{375,768,1440}.json
    score_manifest: stage1/manifest-{375,768,1440}.json
    coverage_report: stage1/coverage-{375,768,1440}.json
    ownership_map: stage1/coverage-{375,768,1440}.json (rows[].owner)
    source_selector_map: stage1/STAGE1-RESULT.md#section-structure
    inventory_audit: stage1/STAGE1-RESULT.md#no-omission-inventory-audit
    dom_state_media_manifests: stage1/manifest-{375,768,1440}.json, stage1/supplemental.json, stage1/screenshot-{375,768,1440}.png
    frozen_denominators: stage1/STAGE1-RESULT.md#frozen-score-denominators
  checks:
    - {name: all_breakpoints_ready, status: PASS, evidence: stage1/readiness-*.json}
    - {name: all_discovery_signals_executed, status: PASS, evidence: stage1/discover.mjs (signals 1-11 implemented and run)}
    - {name: inventory_audit_complete, status: PASS, evidence: stage1/STAGE1-RESULT.md inventory table, all rows cited}
    - {name: cross_breakpoint_visibility_recorded, status: PASS, evidence: stage1/STAGE1-RESULT.md section-structure table}
    - {name: every_instance_has_stable_source_selector, status: PASS, evidence: stage1/STAGE1-RESULT.md section-structure table}
    - {name: exactly_once_coverage, status: PASS, evidence: stage1/coverage-*.json (0 gaps>=20px all bp)}
    - {name: no_unclaimed_gap_20px, status: PASS, evidence: stage1/coverage-*.json}
  failures: []
  next_stage: 02-component-authoring
```
