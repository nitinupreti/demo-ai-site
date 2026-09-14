$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$r = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container.infinity.json" -Headers $authHeader -UseBasicParsing
$r.Content | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\container-full-current.json" -Encoding utf8
Write-Output "saved"
