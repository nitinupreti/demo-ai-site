$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
Write-Host "CSRF: $($csrf.Substring(0,20))..."

$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }

try {
  $chk = Invoke-WebRequest -Uri 'http://localhost:4502/content/demo-ai-site/us/en/sustainability.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing -TimeoutSec 10
  Write-Host "PAGE_EXISTS: $([int]$chk.StatusCode)"
} catch {
  Write-Host "PAGE_MISSING (creating)"
  $form = @{ 'cmd' = 'createPage'; 'parentPath' = '/content/demo-ai-site/us/en'; 'title' = 'Sustainability'; 'label' = 'sustainability'; 'template' = '/conf/demo-ai-site/settings/wcm/templates/page-content' }
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:4502/bin/wcmcommand' -Method Post -Headers $hdr -WebSession $session -Body $form -UseBasicParsing -TimeoutSec 30
    Write-Host "CREATE_PAGE: $([int]$r.StatusCode)"
  } catch {
    Write-Host "CREATE_PAGE_ERROR: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
  }
}
