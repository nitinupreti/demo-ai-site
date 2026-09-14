$text = Get-Content "c:\projects\Trainings\new\demo-ai-site\design\site-url\prompt_new.md" -Raw
$wc = ($text -split '\s+' | Where-Object { $_ -ne '' }).Count
Write-Output "ROUTER_WORDS=$wc"
