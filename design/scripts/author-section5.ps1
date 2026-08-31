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

Write-Host "long_term_goals: $(Post ("http://localhost:4502$grid/long_term_goals") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/long-term-goals'
  'eyebrow' = 'Long-term Danaher goals we support'
  'heading' = 'Empowering change with environmentally conscious design'
  'description' = '<p>Our 150,000 sq. ft. Innovation HQ in Coralville, Iowa leads IDT&#8217;s sustainability efforts.</p>'
  'image' = '/content/dam/demo-ai-site/design/sustainability-headquarters.png'
  'imageAlt' = 'Map of IDT headquarters'
  'checkIcon' = '/content/dam/demo-ai-site/design/sustainability-check-icon.svg'
})"

Write-Host "goals node: $(Post ("http://localhost:4502$grid/long_term_goals/goals") @{ 'jcr:primaryType' = 'nt:unstructured' })"
Write-Host "goal0: $(Post ("http://localhost:4502$grid/long_term_goals/goals/item0") @{ 'jcr:primaryType' = 'nt:unstructured'; 'text' = 'Net-zero value chain greenhouse gas emissions by 2050' })"
Write-Host "goal1: $(Post ("http://localhost:4502$grid/long_term_goals/goals/item1") @{ 'jcr:primaryType' = 'nt:unstructured'; 'text' = '50.4% reduction in scope 1 and scope 2 greenhouse gas emissions by 2032' })"
