$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$html = Invoke-RestMethod -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.html" -Headers $authHeader
Write-Output ("cmp-teaser count: " + ([regex]::Matches($html, 'cmp-teaser(?!__)')).Count)
Write-Output ("Figma present: " + ($html -match 'Figma'))
Write-Output ("Remote present: " + ($html -match '>Remote<'))
Write-Output ("testimonial count: " + ([regex]::Matches($html, 'class="testimonial"')).Count)
$html | Out-File -FilePath "c:\projects\Trainings\new\demo-ai-site\design\scratch\final-render.html" -Encoding utf8
