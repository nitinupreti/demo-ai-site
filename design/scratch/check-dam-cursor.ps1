$cred = @{Authorization="Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))"}
try {
  $r = Invoke-WebRequest -Uri "http://localhost:4506/content/dam/demo-ai-site/customers/cursor.1.json" -Headers $cred -UseBasicParsing
  Write-Output $r.Content
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
