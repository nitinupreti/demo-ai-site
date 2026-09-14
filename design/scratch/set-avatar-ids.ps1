$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$csrf = (Invoke-RestMethod -Uri "http://localhost:4506/libs/granite/csrf/token.json" -Headers $authHeader -UseBasicParsing).token
$headers = $authHeader.Clone()
$headers["CSRF-Token"] = $csrf
$headers["Referer"] = "http://localhost:4506/"

$base = "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container"

$r1 = Invoke-WebRequest -Uri "$base/section1image" -Method Post -Headers $headers -Body @{ "id" = "cursor-avatar-michael" } -UseBasicParsing
Write-Output "section1image id set: HTTP $($r1.StatusCode)"

$r2 = Invoke-WebRequest -Uri "$base/section2image" -Method Post -Headers $headers -Body @{ "id" = "cursor-avatar-ryo" } -UseBasicParsing
Write-Output "section2image id set: HTTP $($r2.StatusCode)"
