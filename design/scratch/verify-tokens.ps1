$ErrorActionPreference = 'Stop'
$auth = @{Authorization="Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))"; Referer="http://localhost:4504/"}
$base = 'http://localhost:4504'
$urls = @(
  "$base/etc.clientlibs/demo-ai-site/clientlibs/clientlib-base.css",
  "$base/etc.clientlibs/demo-ai-site/clientlibs/clientlib-tokens.css",
  "$base/etc.clientlibs/demo-ai-site/components/hero/clientlibs/clientlib-hero.css",
  "$base/etc.clientlibs/demo-ai-site/components/stats-strip/clientlibs/clientlib-stats-strip.css",
  "$base/etc.clientlibs/demo-ai-site/components/feature-list/clientlibs/clientlib-feature-list.css",
  "$base/etc.clientlibs/demo-ai-site/components/testimonials/clientlibs/clientlib-testimonials.css"
)
foreach ($u in $urls) {
  try {
    $r = Invoke-WebRequest -Uri $u -Headers $auth -UseBasicParsing
    "{0,4}  {1,7} bytes  {2}" -f $r.StatusCode, $r.Content.Length, ($u -replace [regex]::Escape($base), '')
  } catch {
    "ERR  {0}  {1}" -f $_.Exception.Message, $u
  }
}
Write-Host ""
Write-Host "--- base.css: token/@import/body-rule presence ---"
$body = (Invoke-WebRequest -Uri "$base/etc.clientlibs/demo-ai-site/clientlibs/clientlib-base.css" -Headers $auth -UseBasicParsing).Content
foreach ($p in @('@import','fonts.googleapis.com','--das-font-display','--das-color-teal','body {','Poppins')) {
  $c = ([regex]::Matches($body, [regex]::Escape($p))).Count
  "{0,-30} {1}" -f $p, $c
}
Write-Host ""
Write-Host "--- hero.css: token references (should be present, hex/Buenos Aires should be absent) ---"
$hero = (Invoke-WebRequest -Uri "$base/etc.clientlibs/demo-ai-site/components/hero/clientlibs/clientlib-hero.css" -Headers $auth -UseBasicParsing).Content
foreach ($p in @('var(--das-','Buenos Aires','#49BBBD','#ff9d43','var(--das-color-teal','var(--das-color-orange')) {
  $c = ([regex]::Matches($hero, [regex]::Escape($p))).Count
  "{0,-30} {1}" -f $p, $c
}
