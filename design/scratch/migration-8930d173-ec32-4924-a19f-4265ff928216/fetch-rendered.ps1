$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$resp = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.html" -Headers @{Authorization="Basic $cred"} -UseBasicParsing
$resp.Content | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-8930d173-ec32-4924-a19f-4265ff928216\rendered.html" -Encoding utf8
Write-Output "Status: $($resp.StatusCode), Length: $($resp.Content.Length)"
