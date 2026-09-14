$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$resp = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container.json" -Headers @{Authorization="Basic $cred"} -UseBasicParsing
Write-Output "Status: $($resp.StatusCode)"
Write-Output $resp.Content
