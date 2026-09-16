# Deterministic Visual Parity Contract

The coordinator executes the fixed Playwright collector; this document is not sent
to a model for comparison. Only failed components or shared-file owners receive
LLM repair work. The retained parity result interface supports existing reporting.

## Run Inputs

| Key | Value |
|---|---|
| Run | `{{run_id}}` |
| Source | `{{site_url}}` |
| AEM disabled | `{{disabled_url}}` |
| AEM author | `{{author_url}}` |
| Breakpoints | `{{breakpoints}}` |
| Modes | `{{modes}}` |
| Pixel threshold | `{{visual_pass_ratio}}` |
| Fresh captures | `{{capture_dir}}` |
| Shared browser module | `{{browser_module_uri}}` |

The browser is already installed and verified. No comparison step installs packages
or browsers. Agent-written runners or evidence do not determine the result. The
fixed collector uses the same pinned module as `await import(process.env.MIGRATION_BROWSER_MODULE)`.

## Measured Gates

- Source roots come from the accepted plan. AEM roots come from validated component
  `parity_targets`, which cover every instance and applicable breakpoint/mode.
- Visible roles are measured on both real pages. Content/role matching is automatic;
  ambiguous roles require explicit relative selector mappings. Omissions fail.
- Typography, colors, backgrounds, margins, padding and gaps compare as exact computed
  strings. Actual rendered fonts are measured through Chromium CDP. Missing values,
  unloaded fonts and font substitutions fail regardless of pixel similarity.
- Component/root geometry, line boxes, media kind/readiness and playback attributes
  are measured. Source and target images may not be resized or padded for scoring.
- Visible non-header controls get automatic hover/focus probes. Declared safe click
  states use supplied control and state-root selectors. Header hidden menus are out
  of scope. Unsupported or unmapped interactions are failures, not fabricated passes.
- Independent instance/state crops and full-page screenshots are produced at every
  required breakpoint/mode. The pinned scorer computes ratios and produces labeled
  side-by-side images, diff masks and hashed receipts. Matching default crops cannot
  hide a failing interaction state or exact-style check.
- The AEM author document is rendered at the required viewport using its content
  frame URL after validating its target path; editor toolbar pixels are excluded.

Cross-origin embeds and behavior beyond supported probes require additional fixed
collector support; they currently fail closed. Generic interaction probes cannot
certify arbitrary business workflows or every animation-cycle state. Authorability
still requires component tests and deployment evidence.

## Result Interface

```json
{
  "agent": "parity",
  "run_id": "{{run_id}}",
  "status": "PASS",
  "outputs": {
    "scores": [],
    "interaction_scores": [],
    "page_composites": [],
    "failing_components": [],
    "comparison_model_calls": 0
  },
  "checks": [
    {"name": "all_source_blocks_mapped_once", "status": "PASS", "evidence": "<collector evidence>"},
    {"name": "all_live_and_aem_screenshot_pairs_valid", "status": "PASS", "evidence": "<collector evidence>"},
    {"name": "all_geometry_and_properties_pass", "status": "PASS", "evidence": "<collector evidence>"},
    {"name": "all_interactions_and_media_pass", "status": "PASS", "evidence": "<collector evidence>"}
  ],
  "failures": []
}
```

This is an interface example, not accepted evidence. The coordinator adds the
independent pixel gate and replaces any claimed ratios with real measurements.
Repair prompts receive only the affected component's bounded diagnostics and image
references; complete measurements remain linked for further inspection. Shared-only
repairs do not rerun every component model. All components are recaptured after
redeployment to detect regressions without additional comparison LLM calls.