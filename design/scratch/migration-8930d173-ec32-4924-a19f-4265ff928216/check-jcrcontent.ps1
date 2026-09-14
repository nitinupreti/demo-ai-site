$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$resp = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content.5.json" -Headers @{Authorization="Basic $cred"} -UseBasicParsing
$resp.Content | ConvertFrom-Json | ConvertTo-Json -Depth 6
