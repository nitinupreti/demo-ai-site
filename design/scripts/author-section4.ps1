$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }

function Post($url, $body) {
  try { $r = Invoke-WebRequest -Uri $url -Method Post -Headers $hdr -WebSession $session -Body $body -UseBasicParsing -TimeoutSec 30; return [int]$r.StatusCode } catch { return "ERR:$($_.Exception.Message)" }
}

$grid = '/content/demo-ai-site/us/en/sustainability/jcr:content/root/container/container'

Write-Host "section4_heading: $(Post ("http://localhost:4502$grid/section4_heading") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/section-heading'
  'heading' = 'A better way to make DNA'
  'align' = 'center'
  'level' = 'h2'
})"

Write-Host "section4_cards: $(Post ("http://localhost:4502$grid/section4_cards") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/product-cards'
  'columns' = '4'
})"

Write-Host "cards: $(Post ("http://localhost:4502$grid/section4_cards/cards") @{ 'jcr:primaryType' = 'nt:unstructured' })"

$cards = @(
  @{ n='item0'; t='Waste reduction'; d="Organic solvents reduced through US EPA Beneficial Reuse Program`r`n`r`nOur Leuven site is zero waste-to-landfill"; i='/content/dam/demo-ai-site/design/sustainability-waste-reduction.svg'; a='waste reduction icon' },
  @{ n='item1'; t='Recycling';       d='All hard plastics and gloves recycled'; i='/content/dam/demo-ai-site/design/sustainability-recycling.svg'; a='recycling icon' },
  @{ n='item2'; t='Energy reduction';d="LED lighting results in 90% energy efficiency gain`r`n`r`nGeothermal heating and cooling"; i='/content/dam/demo-ai-site/design/sustainability-energy-reduction.png'; a='energy reduction icon' },
  @{ n='item3'; t='Shipping';        d="All shipping envelopes are fully biodegradable`r`n`r`nAll shipping containers are made with >85% recycled materials"; i='/content/dam/demo-ai-site/design/sustainability-shipping.svg'; a='sustainable shipping icon' }
)
foreach ($c in $cards) {
  $r = Post ("http://localhost:4502$grid/section4_cards/cards/$($c.n)") @{
    'jcr:primaryType' = 'nt:unstructured'
    'title' = $c.t
    'description' = $c.d
    'icon' = $c.i
    'iconAlt' = $c.a
    'ctaLabel' = ''
    'ctaLabel@Delete' = ''
    'ctaLink' = ''
    'ctaLink@Delete' = ''
  }
  Write-Host "  $($c.n) '$($c.t)': $r"
}
