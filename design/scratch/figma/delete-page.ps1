$b = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes('admin:admin'))
$hdr = @{ Authorization = "Basic $b"; Referer = 'http://localhost:4502/' }

# Get CSRF token
$tokenResp = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers $hdr -UseBasicParsing
$csrf = ($tokenResp.Content | ConvertFrom-Json).token
$hdr['CSRF-Token'] = $csrf
"CSRF: $csrf"

$body = ':operation=delete'
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4502/content/demo-ai-site/figma/e-learning-landing' -Method POST -Headers $hdr -Body $body -ContentType 'application/x-www-form-urlencoded' -UseBasicParsing -ErrorAction Stop
  "Delete status: $([int]$r.StatusCode)"
} catch { "Delete failed: $_" }
