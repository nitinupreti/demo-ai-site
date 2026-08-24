$hdrs=@{Authorization='Basic YWRtaW46YWRtaW4='; Referer='http://localhost:4502/'}
$tok = (Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers $hdrs -UseBasicParsing).Content | ConvertFrom-Json
$hdrs['CSRF-Token'] = $tok.token
try { $r = Invoke-WebRequest -Uri 'http://localhost:4502/system/console/bundles/demo-ai-site.core' -Method Post -Headers $hdrs -Body @{action='start'} -UseBasicParsing; Write-Host "start rc: $($r.StatusCode)" } catch { Write-Host "err: $($_.Exception.Message)"; Write-Host "status: $($_.Exception.Response.StatusCode)"; Write-Host "body: $((New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd())" }
Start-Sleep -Seconds 3
$r2 = Invoke-WebRequest -Uri 'http://localhost:4502/system/console/bundles/demo-ai-site.core.json' -Headers $hdrs -UseBasicParsing
$b = ($r2.Content | ConvertFrom-Json).data
Write-Host "state: $($b.state), version: $($b.version)"
Write-Host "props (first 20):"
$b.props | Select-Object -First 20 | Format-Table -AutoSize | Out-String | Write-Host
