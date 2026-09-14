$start = [datetime]::Parse("2026-09-11T21:03:26.0164320+05:30")
$end = Get-Date
$duration = $end - $start
Write-Output "RUN_START=$($start.ToString('o'))"
Write-Output "RUN_END=$($end.ToString('o'))"
Write-Output "DURATION=$duration"
"RUN_END=$($end.ToString('o'))" | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current-timing.txt" -Append
"DURATION=$duration" | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current-timing.txt" -Append
