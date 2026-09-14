$content = Get-Content -Path "c:\projects\Trainings\new\demo-ai-site\design\scratch\cursor-full.json" -Raw
Write-Output "relatedimage1: $($content -match 'relatedimage1')"
Write-Output "section1image: $($content -match 'section1image')"
Write-Output "relatedimage2: $($content -match 'relatedimage2')"
$idx = $content.IndexOf("relatedimage1")
Write-Output "idx=$idx"
if ($idx -ge 0) { Write-Output $content.Substring([Math]::Max(0,$idx-300), 500) }
