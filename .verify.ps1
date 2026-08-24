$base='http://localhost:4502'
$page='/content/demo-ai-site/us/en/idt-home'
$proj='demo-ai-site'
$pair = "admin:admin"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{Authorization = "Basic $b64"; Referer = "$base/"}
$components = @('hero-carousel','card-strip','section-heading','product-cards','impact-strip','quote-carousel','article-carousel','newsletter-signup','partner-logos')
$urls = [ordered]@{
  disabled = "$base$page.html?wcmmode=disabled"
  siteCss  = "$base/etc.clientlibs/$proj/clientlibs/clientlib-site.css"
  tokenCss = "$base/etc.clientlibs/$proj/clientlibs/clientlib-tokens.css"
}
foreach ($c in $components) {
  $urls["cl-$c"] = "$base/apps/$proj/components/$c/clientlibs/clientlib-$c.css"
}
$results = @{}
foreach ($k in $urls.Keys) {
  try {
    $r = Invoke-WebRequest -Uri $urls[$k] -Headers $headers -UseBasicParsing -ErrorAction Stop
    $results[$k] = @{Status=[int]$r.StatusCode; Body=$r.Content}
  } catch {
    $st = 0
    if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
    $results[$k] = @{Status=$st; Body=''}
  }
}
Write-Host '---URLS---'
foreach ($k in $urls.Keys) { "{0,-35} {1,4}  {2}" -f $k, $results[$k].Status, $urls[$k] | Write-Host }
Write-Host '---BEM class counts in rendered page---'
$disabled = $results['disabled'].Body
foreach ($c in $components) {
  $cls = "cmp-$c"
  $n = ([regex]::Matches($disabled, [regex]::Escape($cls))).Count
  "{0,-25} {1}" -f $cls, $n | Write-Host
}
Write-Host '---SightlyException---'
"count: {0}" -f ([regex]::Matches($disabled,'SightlyException')).Count | Write-Host
Write-Host '---Rendered HTML head (first 400 chars)---'
Write-Host ($disabled.Substring(0, [Math]::Min(400, $disabled.Length)))
