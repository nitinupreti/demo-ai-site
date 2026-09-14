$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$json = Invoke-RestMethod -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content.infinity.json" -Headers $authHeader -UseBasicParsing
$json | ConvertTo-Json -Depth 20 | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current\page-content-pretty.json" -Encoding utf8
Write-Output "done"
