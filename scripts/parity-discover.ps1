$pair = "admin:admin"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$h = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4502/" }
$r = Invoke-WebRequest -Uri "http://localhost:4502/content/demo-ai-site/us/en.1.json" -Headers $h -UseBasicParsing -TimeoutSec 15
$j = $r.Content | ConvertFrom-Json
$j.PSObject.Properties.Name | Where-Object { $_ -notmatch '^(jcr:|cq:|sling:)' }
