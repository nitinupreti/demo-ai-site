# Completion Output

Prepare this report only after all stage prerequisites pass in the current turn.

## Mandatory Tables

1. Per-instance score table at every breakpoint with Content, Typography, Color, Layout, Section order, Media/interaction, property score, screenshot score, authorability score, final minimum, and source/target evidence paths.
2. Component-type minima and breakpoint page composites.
3. Cross-breakpoint minimum instance, component type, and page composite.
4. Per-component geometry table from the visual gate.
5. Coverage report per breakpoint proving no unclaimed gap of 20 CSS px or more and showing each block's discovery signals.
6. Color-authorability matrix per component: role, selected token key, custom hex, correct conditional visibility, sanitized model value, deployed CSS property, and round-trip result.
7. Asset manifest with source/local/DAM paths, MIME, bytes, deployment method, reachability, and decode status.

## Mandatory Artifacts

For every breakpoint publish:

- `evidence/full-<bp>-source.png`
- `evidence/full-<bp>-target.png`

For every component instance and breakpoint publish:

- `evidence/<instance>-<bp>-source.png`
- `evidence/<instance>-<bp>-target.png`
- `evidence/<instance>-<bp>-side-by-side.png`
- `evidence/<instance>-<bp>-mask.png`

Report pixel counts and `visualMatchPercent`. Missing, blank, wrong-viewport, stale, or non-homologous artifacts invalidate the associated score.

## Status Line

Emit exactly one status line based only on current-turn evidence:

```text
VISUAL PARITY GATE: PASSED at <breakpoints> with <N> iterations — minimum instance <score>% — minimum component type <score>% — minimum page composite <score>% (required >95%)
```

Do not emit PASSED unless every prerequisite and component is strictly above 95%. When blocked by an external prerequisite that cannot be remediated, report the blocker plainly without fabricating a gate status.

## Concise Supporting Summary

Report invoked skills; sources; discovery and coverage; current `design-facts`; tiers; tokens/fonts/assets; files by component; template/policy changes; author regression audit; HTL list audit; spatial/interaction checks; tests/build/code assessment; deployed DOM/clientlibs/repository; demo path; accessibility deviations; and residual gaps.

Residual gaps must be empty unless the user explicitly approved them in the same turn.
