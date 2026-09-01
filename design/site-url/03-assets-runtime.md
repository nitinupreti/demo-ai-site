# Assets, Build, Deployment, And Runtime

This file owns asset reproducibility, build/deployment order, and deployed runtime validation.

## Assets And Motion

- Enumerate every visible raster image, SVG/data URI/symbol, icon, logo, CSS background, video/audio/poster, animated image, Lottie/JSON, canvas, font, and embed from source evidence.
- Fetch only exact URLs observed in source DOM, CSS, or network traffic.
- Store assets reproducibly under project-owned source and deploy them under `/content/dam/<project>/design/` (or the project-specific migration folder consistently).
- Author DAM paths; never ship remote URLs, data URIs, placeholders, or one substituted asset reused for distinct source slots.
- Record source URL, local path, DAM path, MIME, bytes, and deployment method.
- Verify source HEAD (GET fallback), target GET 200, MIME, non-zero bytes, and browser decode.
- Preserve media class and source controls. Background video uses playable muted looping inline video when observed. Reduced motion pauses/hides autoplay and exposes its real poster.

Missing or undecoded media gives Media 0 and caps Content at 80 for the affected instance; remediate before scoring.

## Build Order

```powershell
mvn -pl core clean test
mvn -T 1C install -PautoInstallSinglePackage -DskipTests -pl all,core,ui.apps,ui.apps.structure,ui.config,ui.content -am
```

Keep FileVault validation and relevant analyzers enabled. Run focused component/model tests before the reactor build. Run `code-assessment` before completion.

## Deployment And Runtime Sweep

When local AEM is available, deploy affected modules and fetch with Basic auth plus Referer:

- disabled page;
- author/editor page;
- site/token CSS and every touched component clientlib;
- live repository JSON;
- every referenced DAM asset.

Assert:

- HTTP 200 and zero `SightlyException`;
- expected root/modifier/instance counts and source order;
- authored multifield cardinality/order;
- semantic wrappers, non-empty links/actions, ARIA and initial state;
- local clientlib selectors actually loaded;
- project DAM paths and decoded assets;
- active bundle/model adaptation;
- live authored values equal checked-in intent.

Checked-in files, a successful build, and class-name presence are not deployed evidence.
