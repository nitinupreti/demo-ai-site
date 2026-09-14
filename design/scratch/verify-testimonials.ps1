$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$html = Invoke-RestMethod -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.html" -Headers $authHeader
Write-Output ("testimonial class count: " + ([regex]::Matches($html, 'class="testimonial"')).Count)
Write-Output ("blockquote count: " + ([regex]::Matches($html, '<blockquote')).Count)
Write-Output ("Michael Truell mentions: " + ([regex]::Matches($html, 'Michael Truell')).Count)
Write-Output ("remote-thumbnail present: " + ($html -match 'remote-thumbnail'))
Write-Output ("figma-thumbnail present: " + ($html -match 'figma-thumbnail'))
