$pair = "admin:admin"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$h = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4502/" }
$pages = @(
  '/content/demo-ai-site/us/en/noble-finances/home',
  '/content/demo-ai-site/us/en/afterschool-home',
  '/content/demo-ai-site/us/en/nexcent-landing',
  '/content/demo-ai-site/us/en/positivus',
  '/content/demo-ai-site/us/en/totc',
  '/content/demo-ai-site/us/en/travel-landing',
  '/content/demo-ai-site/us/en/furniture-home',
  '/content/demo-ai-site/us/en/insights-hero-demo'
)
$markers = 'challenge-accepted','dc-rotating','rankings-strip','programs-search','feature-panel','cta-panel','news-cards','hero','faq','contact-form','pricing','portfolio','destinations','service-cards'
foreach ($p in $pages) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:4502$p.html?wcmmode=disabled" -Headers $h -UseBasicParsing -TimeoutSec 25
    $totalHits = 0
    $summary = @()
    foreach ($m in $markers) {
      $n = ([regex]::Matches($r.Content, "cmp-$m\b")).Count
      if ($n -gt 0) { $totalHits += $n; $summary += "$m=$n" }
    }
    $sight = ([regex]::Matches($r.Content, 'SightlyException')).Count
    Write-Host ("{0,-55} bytes={1,-6} sightly={2} components: {3}" -f $p, $r.Content.Length, $sight, ($summary -join ' '))
  } catch {
    Write-Host "$p ERR $($_.Exception.Message)"
  }
}
