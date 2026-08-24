$pair='admin:admin'
$b64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$headers=@{Authorization="Basic $b64"; Referer='http://localhost:4502/'}
# Get CSRF token
$tok = (Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers $headers -UseBasicParsing).Content | ConvertFrom-Json
Write-Host "Token: $($tok.token.Substring(0,20))..."
$hd2 = $headers.Clone()
$hd2['CSRF-Token'] = $tok.token
$body = @{ ':operation'='delete' }
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4502/content/demo-ai-site/us/en/idt-home' -Method Post -Headers $hd2 -Body $body -UseBasicParsing
  Write-Host "Delete: $($r.StatusCode)"
} catch {
  Write-Host "Delete failed: $($_.Exception.Message)"
}
