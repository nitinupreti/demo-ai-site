$b = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4504/libs/granite/core/content/login.html' -Headers @{Authorization="Basic $b"} -UseBasicParsing -TimeoutSec 5
  "4504 login page status: $([int]$r.StatusCode)"
  $r2 = Invoke-WebRequest -Uri 'http://localhost:4504/libs/granite/csrf/token.json' -Headers @{Authorization="Basic $b"} -UseBasicParsing -TimeoutSec 5
  "4504 csrf status: $([int]$r2.StatusCode)"
} catch {
  "4504 UNREACHABLE: $($_.Exception.Message)"
}
