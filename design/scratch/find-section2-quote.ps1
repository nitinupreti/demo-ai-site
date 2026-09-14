$content = Get-Content -Raw "c:\projects\Trainings\new\demo-ai-site\design\scratch\section2body.json"
$idx = $content.IndexOf("blockquote")
Write-Output $content.Substring([Math]::Max(0,$idx-50))
