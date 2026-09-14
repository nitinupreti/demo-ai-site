$base = 'C:\projects\Trainings\new\demo-ai-site\ui.apps\src\main\content\jcr_root\apps\demo-ai-site\components'
Get-ChildItem $base -Directory | Where-Object { $_.Name -ne '_shared' } | ForEach-Object {
  $dir = $_.FullName
  $name = $_.Name
  $contentXml = Join-Path $dir '.content.xml'
  $hasContentXml = Test-Path $contentXml
  $htlFiles = Get-ChildItem $dir -Filter "*.html" -ErrorAction SilentlyContinue
  $superType = $null
  if ($hasContentXml) {
    $xml = Get-Content $contentXml -Raw
    if ($xml -match 'sling:resourceSuperType="([^"]+)"') { $superType = $matches[1] }
  }
  "{0,-22} contentXml={1,-5} htl={2,-3} superType={3}" -f $name, $hasContentXml, $htlFiles.Count, $superType
}
