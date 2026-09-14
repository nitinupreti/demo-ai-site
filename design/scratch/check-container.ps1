$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$r = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container/container.1.json" -Headers $authHeader -UseBasicParsing
Write-Output $r.Content
