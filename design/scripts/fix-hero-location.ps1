$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }

function PostForm($url, $body) {
  try { $r = Invoke-WebRequest -Uri $url -Method Post -Headers $hdr -WebSession $session -Body $body -UseBasicParsing -TimeoutSec 30; return [int]$r.StatusCode } catch { return "ERR:$($_.Exception.Message)" }
}
function DeleteNode($path) {
  try { $r = Invoke-WebRequest -Uri ("http://localhost:4502$path") -Method Post -Headers $hdr -WebSession $session -Body @{ ':operation' = 'delete' } -UseBasicParsing -TimeoutSec 30; return [int]$r.StatusCode } catch { return "ERR:$($_.Exception.Message)" }
}

$pc = '/content/demo-ai-site/us/en/sustainability/jcr:content'

Write-Host "delete misplaced site_header: $(DeleteNode "$pc/root/site_header")"
Write-Host "delete misplaced hero: $(DeleteNode "$pc/root/hero")"
Write-Host "delete auto-title: $(DeleteNode "$pc/root/container/title")"

$grid = "$pc/root/container/container"
Write-Host "site_header: $(PostForm ("http://localhost:4502$grid/site_header") @{ 'jcr:primaryType'='nt:unstructured'; 'sling:resourceType'='demo-ai-site/components/site-header' })"

Write-Host "hero: $(PostForm ("http://localhost:4502$grid/hero") @{ 'jcr:primaryType'='nt:unstructured'; 'sling:resourceType'='demo-ai-site/components/hero-carousel'; 'autoRotate'='false'; 'autoRotate@TypeHint'='Boolean'; 'theme'='dark' })"
Write-Host "hero.slides: $(PostForm ("http://localhost:4502$grid/hero/slides") @{ 'jcr:primaryType'='nt:unstructured' })"
Write-Host "hero.slides.item0: $(PostForm ("http://localhost:4502$grid/hero/slides/item0") @{ 'jcr:primaryType'='nt:unstructured'; 'title'='Shaping the future of sustainable science'; 'image'='/content/dam/demo-ai-site/design/sustainability-hero.jpg'; 'imageAlt'='Sustainability at IDT' })"

Start-Sleep -Milliseconds 500
$j = Invoke-WebRequest -Uri "http://localhost:4502$pc.5.json" -Headers @{ Authorization = $auth } -UseBasicParsing
Write-Host "PAGE_JSON: $([int]$j.StatusCode) len=$($j.RawContentLength)"
