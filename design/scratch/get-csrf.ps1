$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$tok = Invoke-RestMethod -Uri "http://localhost:4506/libs/granite/csrf/token.json" -Headers $authHeader -UseBasicParsing
Write-Output ("TOKEN=" + $tok.token)
