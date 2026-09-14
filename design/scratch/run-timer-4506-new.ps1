$start = Get-Date
$runId = [guid]::NewGuid().ToString()
"RUN_ID=$runId" | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current-timing.txt"
"RUN_START=$($start.ToString('o'))" | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current-timing.txt" -Append
Write-Output "RUN_ID=$runId"
Write-Output "RUN_START=$($start.ToString('o'))"
