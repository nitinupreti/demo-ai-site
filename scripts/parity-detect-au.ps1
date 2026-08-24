$pair = "admin:admin"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$h = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4502/" }
$pages = @('noble-finances','afterschool-home','nexcent-landing','positivus','totc','travel-landing','furniture-home','insights-hero-demo')
$auMarkers = 'challenge-accepted|dc-rotating|rankings-strip|programs-search|feature-panel|cta-panel|news-cards'
foreach ($p in $pages) {
    try {
        $url = "http://localhost:4502/content/demo-ai-site/us/en/$p.html?wcmmode=disabled"
        $r = Invoke-WebRequest -Uri $url -Headers $h -UseBasicParsing -TimeoutSec 20
        $hitCount = ([regex]::Matches($r.Content, $auMarkers)).Count
        $bytes = $r.Content.Length
        Write-Host ("{0,-25} bytes={1,-8} au-marker-hits={2}" -f $p, $bytes, $hitCount)
    } catch {
        Write-Host "$p ERROR $($_.Exception.Message)"
    }
}
