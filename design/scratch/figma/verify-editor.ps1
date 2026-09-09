$b = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes('admin:admin'))
$hdr = @{ Authorization = "Basic $b"; Referer = 'http://localhost:4502/' }
$page = 'http://localhost:4502/editor.html/content/demo-ai-site/figma/e-learning-landing.html'
try {
  $r = Invoke-WebRequest -Uri $page -Headers $hdr -UseBasicParsing -ErrorAction Stop
  "Editor status: $([int]$r.StatusCode)"
  "Length: $($r.Content.Length)"
} catch { Write-Warning $_ }
