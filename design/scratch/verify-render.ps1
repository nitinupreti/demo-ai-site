$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$r = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.html" -Headers $authHeader -UseBasicParsing
$hasRemote = $r.Content -match "remote-thumbnail"
Write-Output "remote-thumbnail present in HTML: $hasRemote"
$hasFigma = $r.Content -match "figma-thumbnail"
Write-Output "figma-thumbnail present in HTML: $hasFigma"
