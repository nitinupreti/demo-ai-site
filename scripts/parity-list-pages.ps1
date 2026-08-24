$pair = "admin:admin"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$h = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4502/" }
$q = "http://localhost:4502/bin/querybuilder.json?path=/content/demo-ai-site&type=cq:Page&p.limit=500"
$r = Invoke-WebRequest -Uri $q -Headers $h -UseBasicParsing -TimeoutSec 30
$j = $r.Content | ConvertFrom-Json
$j.hits | ForEach-Object { $_.path }
Write-Host "---TOTAL: $($j.hits.Count)"
