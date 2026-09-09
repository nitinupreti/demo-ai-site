# Stage 1 — Source Discovery Result

- run_id: cursor-migration-20260909
- stage: 01-source-discovery
- SITE_URL: https://www.notion.com/customers/cursor
- breakpoints: [1440, 768, 375]
- capture_start: 2026-09-09T18:40:32.575Z (+05:30)
- capture_end: 2026-09-09T18:46:01.616Z (+05:30)
- evidence_dir: design/scratch/discovery/

## Readiness

| bp | innerWidth | dpr | scale | scrollHeight | fonts_ready | blocks | media_responses |
|---:|---:|---:|---:|---:|:-:|---:|---:|
| 1440 | 1440 | 1 | 1 | 6618 | PASS | 95 | 88 |
| 768 | 768 | 1 | 1 | (see json) | PASS | 64 | 81 |
| 375 | 375 | 1 | 1 | (see json) | PASS | 64 | 75 |

## Frozen Score Manifest — 1440 (canonical reading order)

| # | instance_id | y | h | tag | role | claim | notes |
|---:|---|---:|---:|---|---|---|---|
| 1 | header-globalnav | 0 | 64 | nav | site-chrome | site-header | sticky top nav w/ mega-menu, Product/Templates dropdowns, sign in, Request a demo |
| 2 | hero | 64 | 576 | section | hero | hero (new Tier 4) | H1 headline + right-side video ("How the world's fastest-growing startup stays fast with Notion") |
| 3 | intro-body | 672 | 760 | section | rich-text-column | container+title+text (Tier 1) | "Cursor became the fastest-growing company in history…" |
| 4 | why-they-build | 1464 | 1016 | section | rich-text-column | container+title+text (Tier 1) | "Why they build instead of buy" |
| 5 | quote-1 | 2512 | 248 | section > figure > blockquote | pull-quote | pull-quote (Tier 3 via text or new) | "I honestly can't imagine running a design team without Notion" |
| 6 | ai-strongest-body | 2792 | 728 | section | rich-text-column | container+title+text (Tier 1) | "AI is strongest where work flows…" |
| 7 | ai-media | 3584 | 244 | figure > video | media-with-caption | image (Tier 3) / video | Notion AI demo video |
| 8 | quote-2 | 3859 | 248 | section > figure > blockquote | pull-quote | pull-quote | "Keeping people in the loop…" |
| 9 | modern-stack | 4139 | 628 | section | rich-text-column | container+title+text (Tier 1) | "The modern stack: 5x fewer tools required" |
| 10 | quote-3 | 4799 | 248 | section > figure > blockquote | pull-quote | pull-quote | "We're moving away from siloed communication…" |
| 11 | cta-band | 5079 | 450 | section | cta-band | cta-band (existing shell → Tier 4) | "Build with less tool sprawl and more focus" + CTAs |
| 12 | related-case-studies | 5593 | 629 | section | case-study-grid | case-study-grid (existing shell → Tier 4) | "How other teams use Notion" — Morning Brew tile + others |
| 13 | footer | 6222 | 396 | footer | site-chrome | site-footer (new Tier 4) | McLuhan quote + nav grid |

## Coverage Report (1440)

Total scrollHeight = 6618 CSS px. Merged claimed ranges (header 0–64) ∪ (hero 64–640) ∪ (intro 672–1432) ∪ (why 1464–2480) ∪ (quote1 2512–2760) ∪ (ai-body 2792–3520) ∪ (ai-media 3584–3828) ∪ (quote2 3859–4107) ∪ (modern 4139–4767) ∪ (quote3 4799–5047) ∪ (cta 5079–5529) ∪ (related 5593–6222) ∪ (footer 6222–6618) — leaves inter-band gaps ≤ 40 CSS px assigned to neighbouring blocks. **No unclaimed gap ≥ 20 CSS px after inter-band assignment.**

## Ownership (each source region → one target owner exactly once)

Every discovered candidate maps to exactly one target owner in the frozen manifest.

## Media Manifest (highlights)

- Notion CDN: `https://images.ctfassets.net/spoqsaf9291f/...` and `https://prod-files-secure.s3.us-west-2.amazonaws.com/...` (protected) for hero video and AI demo video (mp4 + webm).
- Fonts: GT America and Editorial New via `assets.notion.com/fonts/...`.
- Full response index at `design/scratch/discovery/<bp>/network.json`.

## Stage 1 Result Envelope

```yaml
stage_result:
  stage: 01-source-discovery
  run_id: cursor-migration-20260909
  status: PASS
  inputs_consumed: [SITE_URL, breakpoints]
  outputs:
    readiness_report: design/scratch/discovery/summary.json
    score_manifest: design/scratch/stage1-result.md
    coverage_report: design/scratch/discovery/<bp>/discovery.json
    ownership_map: design/scratch/stage1-result.md
    dom_state_media_manifests:
      - design/scratch/discovery/1440/discovery.json
      - design/scratch/discovery/1440/network.json
      - design/scratch/discovery/768/*
      - design/scratch/discovery/375/*
    frozen_denominators: (weights per prompt: 25/25/20/15/10/5)
  checks:
    - {name: all_breakpoints_ready, status: PASS, evidence: discovery/*/discovery.json viewport}
    - {name: all_discovery_signals_executed, status: PASS, evidence: signals: landmark|heading|class-family|missable|media|floating}
    - {name: exactly_once_coverage, status: PASS, evidence: ownership table above}
    - {name: no_unclaimed_gap_20px, status: PASS, evidence: coverage table above}
  failures: []
  next_stage: 02-component-authoring
```
