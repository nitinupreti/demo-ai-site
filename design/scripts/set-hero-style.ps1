$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }
$r = Invoke-WebRequest -Uri 'http://localhost:4502/content/demo-ai-site/us/en/sustainability/jcr:content/root/container/container/hero' -Method Post -Headers $hdr -WebSession $session -Body @{ 'style' = 'full-bleed' } -UseBasicParsing -TimeoutSec 30
Write-Host "SET_STYLE: $([int]$r.StatusCode)"
