# Stage 2 — Component Authoring: Reuse Decisions & File Matrix

- run_id: 028116ff-77cc-4698-b546-02e75bf80757
- Consumes: Stage 1 PASS (`stage1/STAGE1-RESULT.md`)

## Ground-truth component audit (`component-audit.ps1` output, this run)

Real (Tier 1/2/3 candidates — `.content.xml` + resourceSuperType/HTL present): `accordion, breadcrumb, button, carousel, container, contentfragment, contentfragmentlist, download, embed, experiencefragment, helloworld, image, languagenavigation, list, navigation, page, pdfviewer, remotepage, remotepagenext, search, separator, tableofcontents, tabs, teaser, testimonial (custom, has own HTL), text, title, xfpage, spa`.

Stub-only (dialog/clientlib only, NO `.content.xml`/HTL — Tier 4 required): `brand-reel, contact-form, cookie-consent, destinations, editorial-article, faq, featured-case-study, footer-cta, hero, industries, insights-list, partners, portfolio, pricing, product-cards, service-list, site-footer, site-header, video-intro`.

## Reuse Decision Matrix

| Design instance | Tier | Reuse target / new component | Gap (why higher tier insufficient) |
|---|:-:|---|---|
| nav-header | 4 | `site-header` (stub → full build) | No Core component models a branded sticky nav + multi-column mega-menu; stub has only dialog/clientlibs |
| hero | 4 | `hero` (stub → full build) | Needs logo lockup + H1 + close icon composed as one authorable unit; Core Title/Text alone can't express the lockup+icon layout without a dedicated component |
| section-simplicity heading/body | 1 | `title` + `text` | Plain heading + rich text, fully covered by Core Title/Text |
| section-simplicity insights aside | 4 | `insights-list` (stub → full build) | Repeatable person (name/role/avatar) rows are a distinct authorable pattern; no existing repeatable-people component |
| section-build-vs-buy heading/body+list | 1 | `title` + `text` (rich text `<ul>`) | Bullet list is inline rich-text content, not a data-bound Core List |
| quote-1, quote-2, quote-3, footer-quote | 1 | `testimonial` (existing custom component) | Already implemented (`quote`/`attributionName`/`attributionRole`), proven in a prior session — direct reuse |
| section-ai heading/body+list | 1 | `title` + `text` | Same as section-build-vs-buy |
| video-cursor-notion-ai | 4 | `video-intro` (stub → full build) | Self-hosted DAM MP4 with autoplay/muted/loop needs a dedicated authorable video component; Core Embed targets oEmbed/URL embeds, not a DAM-backed `<video>` |
| section-modern-stack heading/body+list | 1 | `title` + `text` | Same pattern as above |
| cta-band | 4 | `cta-band` (stub → full build) | Needs an authorable background-color role (Color Authoring contract) + heading + CTA button as one banded unit |
| related-stories heading | 1 | `title` | Plain heading |
| related-card-remote, related-card-rakuten | 1 | `teaser` (Core Teaser v2, existing) | Already proven pattern (image+title+description+link cards) from a prior session; reused inside a `container` for the 2-column grid |
| footer-nav (incl. language selector, legal links, social icons) | 4 | `site-footer` (stub → full build) | Multi-column nav + locale switcher + social icons is a distinct composite pattern with no Core equivalent |
| iframe-youtube (hidden, 0×0 at rest, trigger unconfirmed) | 3 | `embed` (Core Embed v2, existing) | Core Embed's URL/oEmbed mode covers a YouTube embed; authored but flagged — trigger/visibility behavior is an open Stage 1 item, not fabricated as resolved |

No instance has `tier: null`; every Stage 1 block has a decision.

## Component File Matrix (Tier 4 builds only — Tier 1/3 reuse existing files unchanged)

| Component | Dialog | HTL | Model | Clientlib CSS/JS | Test | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|
| `site-header` | update existing `_cq_dialog` | new | new (`SiteHeader`) | update existing `clientlibs` | new | PLANNED |
| `hero` | new | new | new (`Hero`) | new `clientlibs` | new | PLANNED |
| `insights-list` | update existing `_cq_dialog` | new | new (`InsightsList`, child `Insight`) | update existing `clientlibs` | new | PLANNED |
| `video-intro` | update existing `_cq_dialog` | new | new (`VideoIntro`) | new `clientlibs` | new | PLANNED |
| `cta-band` | update existing `_cq_dialog` | new | new (`CtaBand`) | update existing `clientlibs` | new | PLANNED |
| `site-footer` | update existing `_cq_dialog` | new | new (`SiteFooter`, child `FooterLink`) | update existing `clientlibs` | new | PLANNED |

## Target Selector Map (design intent; verified in Stage 3 against deployed disabled page)

| Instance ID | resource_type | Target selector | Match idx | Expected matches |
|---|---|---|---:|---:|
| nav-header | `demo-ai-site/components/site-header` | `header[data-cmp-is="site-header"], .siteheader` | 1 | 1 |
| hero | `demo-ai-site/components/hero` | `[data-cmp-is="hero"]` | 1 | 1 |
| section-simplicity heading | `demo-ai-site/components/title` | `.cmp-title` (2nd instance) | 2 | 1 |
| section-simplicity body | `demo-ai-site/components/text` | `.cmp-text` (1st instance) | 1 | 1 |
| section-simplicity insights aside | `demo-ai-site/components/insights-list` | `[data-cmp-is="insights-list"]` | 1 | 1 |
| section-build-vs-buy heading/body | `demo-ai-site/components/title`, `text` | nth instance | 3 / 2 | 1 |
| quote-1 | `demo-ai-site/components/testimonial` | `.testimonial` | 1 | 1 |
| section-ai heading/body | `title`, `text` | nth instance | 4 / 3 | 1 |
| video-cursor-notion-ai | `demo-ai-site/components/video-intro` | `[data-cmp-is="video-intro"]` | 1 | 1 |
| quote-2 | `demo-ai-site/components/testimonial` | `.testimonial` | 2 | 1 |
| section-modern-stack heading/body | `title`, `text` | nth instance | 5 / 4 | 1 |
| quote-3 | `demo-ai-site/components/testimonial` | `.testimonial` | 3 | 1 |
| cta-band | `demo-ai-site/components/cta-band` | `[data-cmp-is="cta-band"]` | 1 | 1 |
| related-stories heading | `title` | nth instance | 6 | 1 |
| related-card-remote | `demo-ai-site/components/teaser` | `.cmp-teaser` | 1 | 1 |
| related-card-rakuten | `demo-ai-site/components/teaser` | `.cmp-teaser` | 2 | 1 |
| footer-quote | `demo-ai-site/components/testimonial` | `.testimonial` | 4 | 1 |
| footer-nav | `demo-ai-site/components/site-footer` | `footer[data-cmp-is="site-footer"]` | 1 | 1 |
| iframe-youtube | `demo-ai-site/components/embed` | `.cmp-embed` | 1 | 1 |

## Status

component_coverage_matrix: every instance has a tier + file row; no `MISSING`/`tier:null`. `every_source_block_has_decision`: PASS. Remaining checks (`every_block_file_row_complete` for Tier 4 code, `every_instance_has_target_selector`, authoring, focused tests) complete incrementally as each tier group is implemented — tracked in `run-state.json`.
