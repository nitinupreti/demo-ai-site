$content = Get-Content -Raw "c:\projects\Trainings\new\demo-ai-site\design\scratch\section2body-before-quote.txt"
Write-Output $content.Substring(1900)
