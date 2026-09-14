$dir = "C:\projects\Trainings\new\demo-ai-site\design\scratch\migration-028116ff-77cc-4698-b546-02e75bf80757\stage1"
$m = Get-Content "$dir\manifest-1440.json" -Raw | ConvertFrom-Json
Write-Output "MEDIA:"
$m.media | ConvertTo-Json -Depth 5
Write-Output "THIRD PARTY HOSTS:"
$m.thirdPartyHosts
Write-Output "CANDIDATE COUNT:"
$m.candidates.Count
Write-Output "MISSABLE SIGNAL MATCHES:"
$m.candidates | Where-Object { ($_.signals -join ',') -match 'missable' } | ForEach-Object { "$($_.selector) => $($_.signals -join ',') => $($_.text)" } | Select-Object -Unique
Write-Output "FLOATING/STICKY:"
$m.candidates | Where-Object { ($_.signals -join ',') -match 'floating' } | ForEach-Object { "$($_.selector) pos=$($_.position) => $($_.text)" }
