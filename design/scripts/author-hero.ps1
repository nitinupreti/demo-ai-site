$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }

$pageContent = '/content/demo-ai-site/us/en/sustainability/jcr:content'
$root = "$pageContent/root"

function PostForm($url, $body) {
  try {
    $r = Invoke-WebRequest -Uri $url -Method Post -Headers $hdr -WebSession $session -Body $body -UseBasicParsing -TimeoutSec 30
    return [int]$r.StatusCode
  } catch { return "ERR:$($_.Exception.Message)" }
}

# 1) Ensure root container (responsiveGrid) exists inside jcr:content.
$rootBody = @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/container'
  'layout' = 'responsiveGrid'
}
Write-Host "root: $(PostForm ("http://localhost:4502" + $root) $rootBody)"

# 2) Add site-header at the top so the hero has consistent chrome.
$hdrNode = @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/site-header'
}
Write-Host "site_header: $(PostForm ("http://localhost:4502" + $root + '/site_header') $hdrNode)"

# 3) Create hero-carousel with a single slide matching the source.
$hero = @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/hero-carousel'
  'autoRotate' = 'false'
  'autoRotate@TypeHint' = 'Boolean'
  'theme' = 'dark'
}
Write-Host "hero: $(PostForm ("http://localhost:4502" + $root + '/hero') $hero)"

$heroSlides = @{ 'jcr:primaryType' = 'nt:unstructured' }
Write-Host "hero.slides: $(PostForm ("http://localhost:4502" + $root + '/hero/slides') $heroSlides)"

$slide0 = @{
  'jcr:primaryType' = 'nt:unstructured'
  'title' = 'Shaping the future of sustainable science'
  'image' = '/content/dam/demo-ai-site/design/sustainability-hero.jpg'
  'imageAlt' = 'Sustainability at IDT'
}
Write-Host "hero.slides.item0: $(PostForm ("http://localhost:4502" + $root + '/hero/slides/item0') $slide0)"

# 4) Ensure slide ordering.
Write-Host "hero.slides.item0.order: $(PostForm ("http://localhost:4502" + $root + '/hero/slides') @{ ':order' = '[item0]' })"

# 5) Verify JSON.
try {
  $j = Invoke-WebRequest -Uri "http://localhost:4502$pageContent.5.json" -Headers @{ Authorization = $auth } -UseBasicParsing -TimeoutSec 10
  Write-Host "PAGE_JSON: $([int]$j.StatusCode) len=$($j.RawContentLength)"
} catch { Write-Host "PAGE_JSON_ERROR: $($_.Exception.Message)" }
