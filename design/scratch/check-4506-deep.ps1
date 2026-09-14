$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$resp = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en.4.json" -Headers @{Authorization="Basic $cred"} -UseBasicParsing
$resp.Content | ConvertFrom-Json | ConvertTo-Json -Depth 4
