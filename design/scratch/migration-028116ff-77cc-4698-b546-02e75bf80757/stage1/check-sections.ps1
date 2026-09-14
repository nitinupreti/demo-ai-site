$dir = 'C:\projects\Trainings\new\demo-ai-site\design\scratch\migration-028116ff-77cc-4698-b546-02e75bf80757\stage1'
foreach ($width in 375,768) {
  $m = Get-Content (Join-Path $dir "manifest-$width.json") -Raw | ConvertFrom-Json
  Write-Output "=== BP $width ==="
  $m.candidates | Where-Object { ($_.signals -join ',') -match 'landmark:section|landmark:footer|landmark:nav|heading:h1' } | Sort-Object { $_.rect.y } | ForEach-Object {
    "{0,7:N0} h={1,6:N0} sig=[{2}] text={3}" -f $_.rect.y, $_.rect.height, ($_.signals -join ','), $_.text
  }
}
