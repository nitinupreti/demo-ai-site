$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$r = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container/section3body.json" -Headers $authHeader -UseBasicParsing
Write-Output $r.Content
Write-Output '---'
$r2 = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container/section4body.json" -Headers $authHeader -UseBasicParsing
Write-Output $r2.Content
Write-Output '---'
$r3 = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container/section1body.json" -Headers $authHeader -UseBasicParsing
Write-Output $r3.Content
