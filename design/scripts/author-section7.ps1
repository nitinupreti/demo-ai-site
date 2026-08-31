$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }
function Post($url, $body) { try { $r = Invoke-WebRequest -Uri $url -Method Post -Headers $hdr -WebSession $session -Body $body -UseBasicParsing -TimeoutSec 30; return [int]$r.StatusCode } catch { return "ERR:$($_.Exception.Message)" } }

$grid = '/content/demo-ai-site/us/en/sustainability/jcr:content/root/container/container'

Write-Host "section7_articles: $(Post ("http://localhost:4502$grid/section7_articles") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/article-carousel'
  'heading' = 'Related content'
})"
Write-Host "articles node: $(Post ("http://localhost:4502$grid/section7_articles/articles") @{ 'jcr:primaryType' = 'nt:unstructured' })"

$articles = @(
  @{ n='item0'; t='Reducing plastic pollution, one tip at a time'; l='https://www.linkedin.com/pulse/reducing-plastic-pollution-one-tip-time-tom-speedy-jpvpe/'; d='Insights from Tom Speedy on reducing plastic pollution through lab-level changes.' },
  @{ n='item1'; t='Celebrating world environment day 2024';        l='https://www.linkedin.com/pulse/celebrating-our-commitment-sustainability-tom-speedy-ahfuf/'; d='How IDT celebrated World Environment Day 2024 and our ongoing commitment.' },
  @{ n='item2'; t="IDT's gBlocks used by Colorifix to produce ecofriendly dyes"; l='#'; d='Colorifix uses IDT gBlocks Gene Fragments to engineer microbes that produce natural dyes.' }
)
foreach ($a in $articles) {
  $r = Post ("http://localhost:4502$grid/section7_articles/articles/" + $a.n) @{
    'jcr:primaryType' = 'nt:unstructured'
    'title' = $a.t
    'description' = $a.d
    'ctaLabel' = 'READ MORE'
    'ctaLink' = $a.l
  }
  Write-Host "  $($a.n): $r"
}
