$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$hdr = @{ Authorization = $auth }
$html = Invoke-WebRequest -Uri 'http://localhost:4502/apps/demo-ai-site/components/hero-carousel/hero-carousel.html' -Headers $hdr -UseBasicParsing
$content = $html.Content
Write-Host "hero-carousel.html length: $($content.Length)"
if ($content -match 'cmp-hero-carousel--style-') { Write-Host "STYLE_CLASS: PRESENT in HTL" } else { Write-Host "STYLE_CLASS: MISSING in HTL" }
Write-Host "---first 400 chars---"
Write-Host ($content.Substring(0, [Math]::Min(400, $content.Length)))

$css = Invoke-WebRequest -Uri 'http://localhost:4502/etc.clientlibs/demo-ai-site/components/hero-carousel/clientlibs/clientlib-hero-carousel.css' -Headers $hdr -UseBasicParsing
Write-Host "`nclientlib CSS length: $($css.Content.Length)"
if ($css.Content -match 'style-full-bleed') { Write-Host "CSS: full-bleed rules PRESENT" } else { Write-Host "CSS: full-bleed rules MISSING" }
