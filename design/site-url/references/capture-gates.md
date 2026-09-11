# Shared Capture Gates

Single owner of capture readiness, exact assets, typography, and geometry. Required in Stage 1 before freezing source evidence, Stage 3 for deployed media checks, and Stage 4 immediately before each geometry measurement or screenshot. Stage 1 checks source only; target checks begin after implementation. Apply at every runtime breakpoint to source, disabled target, and author target. Instructions may be reused; readiness evidence MUST be fresh.

## Readiness

1. Assert requested `window.innerWidth`; record final URL, timestamp, viewport, DPR, `visualViewport.scale`, `innerWidth`, `documentElement.clientWidth`, and `scrollWidth`.
2. Await `document.fonts.ready` and `document.fonts.check(...)` for every custom face/weight actually used. Confirm font/background/media HTTP responses (HEAD with GET fallback where needed). Decode visible images: `complete`, `naturalWidth > 0`, `naturalHeight > 0`; visible audio requires `readyState >= 2`.
3. Trigger natural scroll/lazy loading. Run the video procedure below BEFORE motion-freeze CSS. Then disable animation, transition, and smooth scrolling for static captures; restore source-equivalent motion for interaction/playback tests.
4. Sample `documentElement`, `body`, `main`, every discovered root and layout-defining child three times at least 500 ms apart. Require x/y/width/height stability within the router's geometry tolerance. Rerun after discovery's final candidate union. Wrong viewport, unresolved resources, or unstable layout invalidates capture.

## Video: Decoded Frame AND Playback

For every visible or component-owned video:

1. Discovery records media class (inline video/MP4, background video, image, animated image, embed, poster), rendered tag, resolved URL/MIME, `autoplay`, `loop`, `muted`, `playsInline`, `preload`, `controls`, `poster`, lazy trigger, visibility/off-screen/reduced-motion behavior, intrinsic dimensions, responsive aspect ratio, `object-fit`, and `object-position`. Preserve class: inline MP4 remains a real `<video>` with an authored DAM path, never an image, poster-only element, CSS background, canvas capture, screenshot, or static first frame.
2. Scroll the owning root into view; trigger its real lazy path. Await `loadedmetadata` and `loadeddata`/`canplay` (or verify already-fired readiness). Require non-empty `currentSrc`, no failed request, `readyState >= 2`, `videoWidth > 0`, and `videoHeight > 0`.
3. Pause and seek source/target to the same deterministic time: `0.01s` or first common seekable time unless discovery specifies another state. Await `seeked`, then a presented frame via `requestVideoFrameCallback`; if unavailable, require readiness and two `requestAnimationFrame` callbacks after seeking.
4. Sample root, media wrapper, video, and caption rectangles three times at least 500 ms apart, within the canonical tolerance. Only now freeze motion. If dimensions changed from pre-decode poster/skeleton/fallback geometry, discard ALL earlier measurements/screenshots for that instance; never tune CSS to placeholders.
5. Separately test natural autoplay/visible playback without user interaction: over at least one second require `paused === false`, `readyState >= 2`, and `currentTime` delta at least `0.5s`. Verify observed pause/resume, looping, controls, reduced motion, and off-screen behavior. A frozen `0s` video fails. Re-seek deterministically before static capture.
6. Hidden-tab suppression is not source behavior. Use an active context and natural visibility triggers. If automation still prevents playback, record the limitation; explicit `video.play()` is allowed only for matched-frame capture, leaving the behavioral check unresolved.

Persist per video: instance ID, selector, final URL, `currentSrc`, HTTP result, `readyState`, `networkState`, intrinsic width/height, `currentTime`, seek result, frame-callback result, pre-decode rectangle, post-decode samples, playback observations, screenshot path. Compare source/DAM byte length and SHA-256 when accessible; any mismatch requires validated intentional-transcode evidence, otherwise asset failure.

Matched captures require the same viewport, decoded asset (or validated transcode), intrinsic dimensions, fit, position, and time. Capture the complete media-with-caption root: visible frame, rounded container, border/shadow, and caption. Reject blank/mostly uniform crops, poster substitutions, failed seeks, absent frame evidence, or unstable geometry: `SCORE WITHHELD — VIDEO NOT DECODED OR GEOMETRY UNSTABLE`. No numeric score without valid evidence.

## Exact Assets And Icons

Inventory each logo, wordmark, badge, branded illustration, caret, chevron, arrow, close/menu/play control, globe, and other icon independently. Use exact legally/technically available branded assets, retaining viewBox/aspect, DAM path authoring, and verified loaded/rendered dimensions. No typed letters, emoji, borders, generic icons, or drawn brand approximations.

Icons use source SVG/images or verified project-library equivalents with explicit boxes and accessibility treatment. Authored labels are text only: never append Unicode glyphs as icon substitutes. Missing/unavailable assets must be resolved, not silently approximated.

## Computed Typography And Spacing

For EVERY distinct text role, capture/compare: `font-family`, actual loaded face, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `word-spacing`, `font-style`, `font-kerning`, `font-feature-settings`, `font-variation-settings`, `font-synthesis`, `text-rendering`, `text-wrap`, `-webkit-font-smoothing`, text transform, and color. Verify representative line-by-line text rectangles, glyph metrics, and line breaks. A matching family declaration with fallback rendering fails.

For every root/layout-defining/repeated child capture x/y/width/height, margin, padding, row/column gap, alignment, positioning, and inter-component vertical gaps. Compare raw values within `geometry_tolerance_css_px` for all four rectangle coordinates; only evidenced browser rounding is excepted. Distinguish `%` from `vw`, account for scrollbars, and preserve full-bleed status without negative offsets, unintended overlap, or horizontal overflow.

Missing logos/icons, unloaded fonts, unmeasured roles, stale authored values, unexplained asset mismatches, or excess spacing deltas are hard FAILs. Correct the owning layer and recapture. Property-only, asset-only, or root-only evidence cannot sign off a page: Stage 4 additionally requires validated locator pairs and full-page captures.