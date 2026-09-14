$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$paths = @(
  "/content/demo-ai-site/us/en.2.json",
  "/content/demo-ai-site/us/en/customers.2.json",
  "/content/demo-ai-site/us/en/customers/cursor.2.json"
)
foreach ($p in $paths) {
  Write-Output "=== $p ==="
  try {
    $resp = Invoke-WebRequest -Uri "http://localhost:4506$p" -Headers @{Authorization="Basic $cred"} -UseBasicParsing
    Write-Output $resp.Content
  } catch {
    Write-Output "ERROR: $($_.Exception.Message)"
  }
}
