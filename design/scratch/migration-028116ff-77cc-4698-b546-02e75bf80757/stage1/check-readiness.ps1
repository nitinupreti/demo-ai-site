$dir = 'C:\projects\Trainings\new\demo-ai-site\design\scratch\migration-028116ff-77cc-4698-b546-02e75bf80757\stage1'
foreach ($width in 375,768,1440) {
  $r = Get-Content (Join-Path $dir "readiness-$width.json") -Raw | ConvertFrom-Json
  Write-Output ("BP={0} readinessOk={1} w1={2} w2={3} samples={4}" -f $width, $r.readinessOk, $r.innerWidthCheck1, $r.innerWidthCheck2, $r.geometrySamples.Count)
}
