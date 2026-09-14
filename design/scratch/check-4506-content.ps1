$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
try {
  $resp = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site.1.json" -Headers @{Authorization="Basic $cred"} -UseBasicParsing
  Write-Output $resp.Content
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
