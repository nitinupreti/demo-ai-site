$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$csrf = (Invoke-RestMethod -Uri "http://localhost:4506/libs/granite/csrf/token.json" -Headers $authHeader -UseBasicParsing).token
$headers = $authHeader.Clone()
$headers["CSRF-Token"] = $csrf
$headers["Referer"] = "http://localhost:4506/"

$wrongPath = "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container/container"
$resp = Invoke-WebRequest -Uri $wrongPath -Method Post -Headers $headers -Body @{ ":operation" = "delete" } -UseBasicParsing
Write-Output "Deleted stray container node: HTTP $($resp.StatusCode)"
