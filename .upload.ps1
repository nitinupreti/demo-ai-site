$hdrs=@{Authorization='Basic YWRtaW46YWRtaW4='; Referer='http://localhost:4502/'}
$tok = (Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers $hdrs -UseBasicParsing).Content | ConvertFrom-Json
$dam = '/content/dam/demo-ai-site/design'
# Ensure folder exists (idempotent)
try {
  curl.exe --ssl-no-revoke -s -u admin:admin -X MKCOL "http://localhost:4502/content/dam/demo-ai-site/design" | Out-Null
} catch {}
foreach ($f in @('Hero-Animation-Start.mp4','Hero-Animation-Repeat.mp4')) {
  $path = ".assets/$f"
  $url = "http://localhost:4502/content/dam/demo-ai-site/design.createasset.html"
  $r = curl.exe --ssl-no-revoke -s -u admin:admin -H "CSRF-Token: $($tok.token)" -H "Referer: http://localhost:4502/" -F "file=@$path;type=video/mp4" -F "fileName=$f" -o - -w "%{http_code}" $url
  Write-Host "Upload $f -> HTTP: $r"
}
Start-Sleep -Seconds 3
foreach ($f in @('Hero-Animation-Start.mp4','Hero-Animation-Repeat.mp4')) {
  $u = "http://localhost:4502$dam/$f"
  $r = curl.exe --ssl-no-revoke -s -I -u admin:admin -o - -w "HTTP=%{http_code} Len=%{size_download}\n" $u
  Write-Host "HEAD $f -> $r"
}
