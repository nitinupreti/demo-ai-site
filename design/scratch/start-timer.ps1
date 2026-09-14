$start = Get-Date
Write-Output "RUN_START=$($start.ToString('o'))"
$runId = [guid]::NewGuid().ToString()
Write-Output "RUN_ID=$runId"
$start | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-cursor-4506-timing.txt"
"RUN_ID=$runId" | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-cursor-4506-timing.txt" -Append
