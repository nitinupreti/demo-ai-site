powershell -File "design\scratch\get-section-bodies.ps1" | Out-File -FilePath "design\scratch\section-bodies-raw.txt" -Encoding utf8
Get-Item "design\scratch\section-bodies-raw.txt" | Select-Object Length
