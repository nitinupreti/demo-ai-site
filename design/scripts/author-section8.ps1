$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }
function Post($url, $body) { try { $r = Invoke-WebRequest -Uri $url -Method Post -Headers $hdr -WebSession $session -Body $body -UseBasicParsing -TimeoutSec 30; return [int]$r.StatusCode } catch { return "ERR:$($_.Exception.Message)" } }

$grid = '/content/demo-ai-site/us/en/sustainability/jcr:content/root/container/container'

Write-Host "section8_heading: $(Post ("http://localhost:4502$grid/section8_heading") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/section-heading'
  'heading' = 'Shared vision for sustainability with Danaher'
  'align' = 'center'
  'level' = 'h2'
})"

$cardLinkStyle = 'display:inline-block; padding:14px 22px; margin:6px 8px; background:#F5F8FD; color:#336F9F; font-family:&quot;Source Sans 3&quot;, Arial, sans-serif; font-size:16px; text-decoration:none; border-radius:4px; border:1px solid #DCE6F1;'
$bodyStyle = 'text-align:center; font-family:&quot;Source Sans 3&quot;, Arial, sans-serif; font-size:22px; line-height:32px; color:rgb(51,51,51); max-width:1080px; margin:32px auto 0;'
$hereLinkStyle = 'color:#336F9F; text-decoration:underline;'

$html = '<p style="text-align:center; margin: 0 auto 24px;">' +
  '<a href="https://www.danaher.com/sites/default/files/2025-06/danaher-sustainability-policy-5.25.pdf" target="_blank" rel="noopener" style="' + $cardLinkStyle + '">Sustainability Policy</a>' +
  '<a href="https://www.danaher.com/sites/default/files/2025-06/danaher-sustainable-supply-chain-policy-5.25.pdf" target="_blank" rel="noopener" style="' + $cardLinkStyle + '">Sustainable Supply Chain Policy</a>' +
  '<a href="https://www.danaher.com/sites/default/files/2025-06/dhr-ehs-policy-5.25.pdf" target="_blank" rel="noopener" style="' + $cardLinkStyle + '">Global Environmental, Health and Safety Policy</a>' +
  '</p>' +
  '<p style="' + $bodyStyle + '">Learn more about Danaher&#8217;s sustainability strategy, policies, and download the annual sustainability report ' +
  '<a href="https://www.danaher.com/about-danaher/sustainability" target="_blank" rel="noopener" style="' + $hereLinkStyle + '">here</a>.</p>'

Write-Host "section8_body: $(Post ("http://localhost:4502$grid/section8_body") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/text'
  'text' = $html
  'textIsRich' = 'true'
  'textIsRich@TypeHint' = 'Boolean'
})"
