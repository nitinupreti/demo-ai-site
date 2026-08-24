$hdrs=@{Authorization='Basic YWRtaW46YWRtaW4='; Referer='http://localhost:4502/'}
$tok = (Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers $hdrs -UseBasicParsing).Content | ConvertFrom-Json
$hdrs['CSRF-Token'] = $tok.token
try { $r = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/ui/content/dumplibs.rebuild.html?invalidate=true' -Method Post -Headers $hdrs -UseBasicParsing; Write-Host "rebuild: $($r.StatusCode)" } catch { Write-Host "rebuild err: $($_.Exception.Message)" }
Start-Sleep -Seconds 4
$r = Invoke-WebRequest -Uri 'http://localhost:4502/etc.clientlibs/demo-ai-site/clientlibs/clientlib-site.js' -Headers @{Authorization='Basic YWRtaW46YWRtaW4='} -UseBasicParsing
Write-Host "len: $($r.Content.Length)"
Write-Host "hero-carousel occurrences: $(([regex]::Matches($r.Content,'hero-carousel')).Count)"
Write-Host "quote-carousel occurrences: $(([regex]::Matches($r.Content,'quote-carousel')).Count)"
