$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
try {
  $r = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.json" -Headers @{Authorization="Basic $cred"} -UseBasicParsing -TimeoutSec 15
  Write-Output "STATUS=$($r.StatusCode) LEN=$($r.Content.Length)"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
