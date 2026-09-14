$html = Get-Content -Raw "c:\projects\Trainings\new\demo-ai-site\design\scratch\cursor-render-check.html"
Write-Output ("testimonial count: " + ([regex]::Matches($html,'class="testimonial"')).Count)
Write-Output ("blockquote count: " + ([regex]::Matches($html,'<blockquote')).Count)
Write-Output ("Michael Truell count: " + ([regex]::Matches($html,'Michael Truell')).Count)
Write-Output ("login form present: " + ($html -match '(?i)login'))
