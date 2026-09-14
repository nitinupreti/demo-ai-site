$content = Get-Content -Raw "c:\projects\Trainings\new\demo-ai-site\design\scratch\section2body.json"
$startMarker = '"text":"'
$startIdx = $content.IndexOf($startMarker) + $startMarker.Length
$bqIdx = $content.IndexOf("<\/p><blockquote>")
$before = $content.Substring($startIdx, $bqIdx - $startIdx + 4) # include trailing </p>
$before | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\section2body-before-quote.txt" -Encoding utf8 -NoNewline
Write-Output ("Length: " + $before.Length)
