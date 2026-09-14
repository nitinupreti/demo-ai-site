$dir = "C:\projects\Trainings\new\demo-ai-site\design\scratch\migration-028116ff-77cc-4698-b546-02e75bf80757\stage1"
$m = Get-Content "$dir\manifest-1440.json" -Raw | ConvertFrom-Json
Write-Output "=== LANDMARKS/HEADINGS SORTED BY Y ==="
$m.candidates | Where-Object { ($_.signals -join ',') -match 'landmark|heading' } | Sort-Object { $_.rect.y } | ForEach-Object {
  "{0,7:N0} h={1,6:N0} {2,-70} sig=[{3}] text={4}" -f $_.rect.y, $_.rect.height, $_.selector, ($_.signals -join ','), $_.text
}
Write-Output ""
Write-Output "=== REPETITION PARENTS ==="
$m.repetitionParents | Select-Object -Unique
