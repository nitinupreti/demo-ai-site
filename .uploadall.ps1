$hdrs=@{Authorization='Basic YWRtaW46YWRtaW4='; Referer='http://localhost:4502/'}
$tok = (Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers $hdrs -UseBasicParsing).Content | ConvertFrom-Json
$assets = Get-ChildItem .assets -File | Where-Object { $_.Name -match '\.(svg|jpg|jpeg|png)$' }
foreach ($a in $assets) {
  $ext = $a.Extension.ToLower()
  $mime = switch($ext) { '.svg' {'image/svg+xml'} '.jpg' {'image/jpeg'} '.jpeg' {'image/jpeg'} '.png' {'image/png'} default {'application/octet-stream'} }
  $url = "http://localhost:4502/content/dam/demo-ai-site/design.createasset.html"
  $r = curl.exe --ssl-no-revoke -s -u admin:admin -H "CSRF-Token: $($tok.token)" -H "Referer: http://localhost:4502/" -F "file=@$($a.FullName);type=$mime" -F "fileName=$($a.Name)" -o - -w "%{http_code}" $url 2>&1
  # Extract just the http code from tail
  $code = ($r -join '' | Select-String -Pattern '\b(2\d\d|3\d\d|4\d\d|5\d\d)$' -AllMatches).Matches | Select-Object -Last 1
  "{0,-30} HTTP {1}" -f $a.Name, ($code.Value) | Write-Host
}
