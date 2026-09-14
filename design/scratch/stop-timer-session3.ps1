$start = [datetime]::Parse("2026-09-11T21:59:01.5445941+05:30")
$end = Get-Date
$duration = $end - $start
Write-Output "RUN_START=$($start.ToString('o'))"
Write-Output "RUN_END=$($end.ToString('o'))"
Write-Output "DURATION=$duration"
"RUN_END=$($end.ToString('o'))" | Add-Content -Path "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-session3-timing.txt"
"DURATION=$duration" | Add-Content -Path "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-session3-timing.txt"
