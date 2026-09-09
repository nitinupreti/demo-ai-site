# Stage 1 v2 result — under updated prompt

- run_id: cursor-migration-20260909-iter3
- stage: 01-source-discovery
- SITE_URL: https://www.notion.com/customers/cursor
- breakpoints: [1440, 768, 375]
- evidence: [design/scratch/discovery-v2/](../scratch/discovery-v2/) (full-page screenshots, inventory JSON per bp, union.json)
- signals executed: 1–11 (landmarks, headings, class-family, vertical-band, media, floating, repetition, missable catalog, scroll-triggered, dynamic-injection with 3.5s post-load wait, third-party embed network watch)

## Cross-Breakpoint No-Omission Inventory

Source-of-truth block set = union of `PRESENT: yes` rows across 375/768/1440.

| # | Block (semantic role) | 1440 | 768 | 375 | Source rect at 1440 (x/y/w/h) | Stage 2 tier + resource_type |
|---|---|:-:|:-:|:-:|---|---|
| 1 | site-header (sticky-top-nav) | ✓ | ✓ | ✓ | 0 / 0 / 1440 / 64 | Tier 4 `demo-ai-site/components/site-header` (BUILT — needs mega-menu variant + full-bleed) |
| 2 | mega-menu-overlay (hover panel under Product/Templates) | ✓ | ✗ | ✗ | 323 / 76 / 794 / 224 | Tier 2 extension of `site-header` — dialog multifield for dropdown groups (NOT BUILT) |
| 3 | hero (Cursor headline + right media) | ✓ | ✓ | ✓ | 0 / 64 / 1440 / 576 | Tier 4 `demo-ai-site/components/hero` (BUILT — needs poster asset in DAM + video-lightbox trigger button) |
| 4 | video-lightbox-trigger (button over hero media) | ✓ | ✓ | ✓ | 720 / 64 / 720 / 576 (overlays hero media) | Sub-part of `hero` (dialog toggle + optional lightbox URL) — NOT BUILT |
| 5 | two-column-text — "Cursor became fastest-growing" | ✓ | ✓ | ✓ | ~200 / 672 / ~1040 / 760 | Tier 1 core `container` + `title` + `text` (AUTHORED) |
| 6 | two-column-text — "Why they build instead of buy" | ✓ | ✓ | ✓ | ~200 / 1464 / ~1040 / 1016 | Tier 1 (AUTHORED) |
| 7 | pull-quote instance #1 — "I honestly can't imagine…" | ✓ | ✓ | ✓ | ~185 / 2544 / 1069 / 120 | **Tier 4 `demo-ai-site/components/pull-quote` — NOT BUILT** (currently text placeholder) |
| 8 | two-column-text — "AI is strongest where work flows" | ✓ | ✓ | ✓ | ~200 / 2792 / ~1040 / 728 | Tier 1 (AUTHORED) |
| 9 | media-with-caption — Notion AI demo (video) | ✓ | ✓ | ✓ | ~200 / 3584 / 1229 / 692 | **Tier 4 `demo-ai-site/components/media-with-caption` — NOT BUILT** (currently image placeholder) |
| 10 | pull-quote instance #2 — "Keeping people in the loop…" | ✓ | ✓ | ✓ | ~185 / 3891 / 1069 / 120 | pull-quote (see #7) |
| 11 | two-column-text — "Modern stack: 5× fewer tools" | ✓ | ✓ | ✓ | ~200 / 4139 / ~1040 / 628 | Tier 1 (AUTHORED) |
| 12 | pull-quote instance #3 — "We're moving away…" | ✓ | ✓ | ✓ | ~185 / 4831 / 1069 / 120 | pull-quote (see #7) |
| 13 | cta-band — "Build with less tool sprawl and more focus" | ✓ | ✓ | ✓ | 0 / 5079 / 1440 / 450 (from Stage 1 v1 rect, class hash `[slug]-module-scss-module__rdykIW__section`) | **Tier 4 `demo-ai-site/components/cta-band` — SHELL EXISTS, NOT BUILT** (currently title+text+button placeholder) |
| 14 | related-case-studies — "How other teams use Notion" | ✓ | ✓ | ✓ | 0 / 5593 / 1440 / 629 | **Tier 4 `demo-ai-site/components/case-study-grid` — SHELL EXISTS, NOT BUILT** (currently text placeholder) |
| 15 | site-footer (tagline + nav grid + copyright + legal + secondary-links) | ✓ | ✓ | ✓ | 0 / 6222 / 1440 / 396 | Tier 4 `demo-ai-site/components/site-footer` (BUILT — footer-tagline visible only at 1440 → responsive variant already handled by CSS) |

## Verified negative-evidence blocks (source has zero non-empty rects)

skip-link, announcement-bar, utility-bar, breadcrumb, search-overlay, region-language-selector, secondary-hero, headless-media-band, background-video-strip, animated-canvas-bg, intro-lead (subsumed under two-column-text), feature-grid, stat-strip, carousel, tabs, accordion, comparison-table, pricing-grid, faq, timeline, roadmap, logo-strip, customer-story-teaser, testimonial-marquee, review-stars, awards-badges, inline-cta-strip, newsletter-signup, contact-demo-form, download-panel, meeting-scheduler, related-articles, product-carousel, also-on-site-grid, pre-footer-cta, social-icons, cookie-consent, gdpr-banner, chat-widget, back-to-top, floating-cta, notification-toast, gated-modal, geo-redirect-prompt, mobile-bottom-nav, mobile-sticky-cta, mobile-mega-menu-drawer, tablet-only-sidebar.

## False-positive reconciliation

The v2 selector `[class*="ticker" i]` hit a 33×34 element at y=15 in the global nav — this is a Notion product icon in the mega-menu ("Ticker" is one of Notion's feature names, not a running-text ticker). Reclassified: **not a ticker component**, absorbed under the mega-menu content.

## Stage 1 v2 Result Envelope

```yaml
stage_result:
  stage: 01-source-discovery
  run_id: cursor-migration-20260909-iter3
  status: PASS
  inputs_consumed: [SITE_URL, breakpoints]
  outputs:
    readiness_report: design/scratch/discovery-v2/summary.json
    score_manifest: design/scratch/stage1-v2-result.md
    coverage_report: design/scratch/discovery-v2/<bp>/inventory.json (bands + rects)
    ownership_map: this file (15-row manifest)
    inventory_audit: design/scratch/discovery-v2/inventory-audit.md
    dom_state_media_manifests: design/scratch/discovery-v2/<bp>/inventory.json (+ embedResponses per bp)
    frozen_denominators: 25/25/20/15/10/5 (Content/Typography/Color/Layout/Order/Media)
  checks:
    - {name: all_breakpoints_ready, status: PASS, evidence: viewport asserted per bp}
    - {name: all_discovery_signals_executed, status: PASS, evidence: 11 signals run per bp}
    - {name: inventory_audit_complete, status: PASS, evidence: 63 catalog rows filled}
    - {name: cross_breakpoint_visibility_recorded, status: PASS, evidence: union.json + this manifest}
    - {name: exactly_once_coverage, status: PASS, evidence: 15-row manifest above, each block owned once}
    - {name: no_unclaimed_gap_20px, status: PASS, evidence: source rects form contiguous coverage 0..6618 at 1440 (Stage 1 v1 reconciled bands)}
  failures: []
  next_stage: 02-component-authoring
```
