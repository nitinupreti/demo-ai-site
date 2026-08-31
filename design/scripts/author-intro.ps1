$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }

function PostForm($url, $body) {
  try { $r = Invoke-WebRequest -Uri $url -Method Post -Headers $hdr -WebSession $session -Body $body -UseBasicParsing -TimeoutSec 30; return [int]$r.StatusCode } catch { return "ERR:$($_.Exception.Message) $($_.ErrorDetails.Message)" }
}

$grid = '/content/demo-ai-site/us/en/sustainability/jcr:content/root/container/container'

$copy = 'We are committed to advancing responsible, sustainable scientific progress through reliable, high quality solutions that help researchers move faster with confidence. As a Danaher operating company, we align our environmental, social, and governance (ESG) efforts with Danaher&#8217;s enterprise wide sustainability program&#8212;ensuring integrity, consistency, and transparency across our work.'

$richText = '<p style="text-align:center; font-family:&quot;Source Sans 3&quot;, Arial, sans-serif; font-size:22px; line-height:32px; color:#595959; max-width:940px; margin:0 auto;">' + $copy + '</p>'

Write-Host "intro: $(PostForm ("http://localhost:4502$grid/intro") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/text'
  'text' = $richText
  'textIsRich' = 'true'
  'textIsRich@TypeHint' = 'Boolean'
})"

# Ensure intro sits between hero and future sections; force order after hero.
Write-Host "order: $(PostForm ("http://localhost:4502$grid") @{ ':order' = '[site_header,hero,intro]' })"
