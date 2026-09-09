param(
    [Parameter(Mandatory=$true)][string]$Component,
    [Parameter(Mandatory=$true)][string]$Event
)
$repo = "C:\projects\Trainings\new\demo-ai-site"
$csv = Join-Path $repo "design\scratch\migration-timings.csv"
$startIso = (Get-Content (Join-Path $repo "design\scratch\migration-start.txt") | Select-Object -First 1).Trim()
$start = [datetime]::Parse($startIso)
$now = Get-Date
$elapsed = [math]::Round(($now - $start).TotalSeconds, 2)
$row = "{0},{1},{2},{3}" -f $Component, $Event, $now.ToString("o"), $elapsed
Add-Content -Path $csv -Value $row
Write-Host $row
