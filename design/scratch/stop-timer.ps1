$end = Get-Date
Write-Output "RUN_END=$($end.ToString('o'))"
$start = [datetime]::Parse("2026-09-11T20:12:13.0825852+05:30")
$duration = $end - $start
Write-Output "DURATION=$duration"
"RUN_END=$($end.ToString('o'))" | Add-Content -Path "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-cursor-4506-timing.txt"
"DURATION=$duration" | Add-Content -Path "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-cursor-4506-timing.txt"
