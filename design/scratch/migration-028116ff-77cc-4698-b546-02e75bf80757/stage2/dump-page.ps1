$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$r = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.infinity.json" -Headers @{Authorization="Basic $cred"} -UseBasicParsing -TimeoutSec 15
$r.Content | Out-File -FilePath "C:\projects\Trainings\new\demo-ai-site\design\scratch\migration-028116ff-77cc-4698-b546-02e75bf80757\stage2\current-page.json" -Encoding utf8
Write-Output "LEN=$($r.Content.Length)"
