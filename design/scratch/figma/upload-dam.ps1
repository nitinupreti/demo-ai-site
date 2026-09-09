$b = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes('admin:admin'))
$hdr = @{ Authorization = "Basic $b"; Referer = 'http://localhost:4502/' }
$tokenResp = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers $hdr -UseBasicParsing
$csrf = ($tokenResp.Content | ConvertFrom-Json).token
$hdr['CSRF-Token'] = $csrf

# Ensure DAM parent folders exist
foreach ($p in @('/content/dam/demo-ai-site/design','/content/dam/demo-ai-site/design/figma')) {
  try {
    $body = "./jcr:primaryType=sling:Folder"
    Invoke-WebRequest -Uri "http://localhost:4502$p" -Method POST -Headers $hdr -Body $body -ContentType 'application/x-www-form-urlencoded' -UseBasicParsing -ErrorAction Stop | Out-Null
  } catch { Write-Host "Folder $p exists or created" }
}

# Upload each asset. Use AEM createasset servlet on the parent folder.
$srcDir = 'design/scratch/figma/assets'
$dstFolder = '/content/dam/demo-ai-site/design/figma'
$files = Get-ChildItem $srcDir -File
foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $ext = $f.Extension.ToLower()
  $ct = if ($ext -eq '.png') { 'image/png' } elseif ($ext -eq '.jpg' -or $ext -eq '.jpeg') { 'image/jpeg' } elseif ($ext -eq '.svg') { 'image/svg+xml' } else { 'application/octet-stream' }
  $boundary = [Guid]::NewGuid().ToString('N')
  $LF = "`r`n"
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("--$boundary$LF")
  [void]$sb.Append("Content-Disposition: form-data; name=`"file`"; filename=`"$($f.Name)`"$LF")
  [void]$sb.Append("Content-Type: $ct$LF$LF")
  $header = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
  $footer = [System.Text.Encoding]::UTF8.GetBytes("$LF--$boundary--$LF")
  $ms = New-Object System.IO.MemoryStream
  $ms.Write($header, 0, $header.Length)
  $ms.Write($bytes, 0, $bytes.Length)
  $ms.Write($footer, 0, $footer.Length)
  $body = $ms.ToArray()
  $ms.Close()
  $uploadHdr = @{}
  foreach ($k in $hdr.Keys) { $uploadHdr[$k] = $hdr[$k] }
  $uploadHdr['Content-Type'] = "multipart/form-data; boundary=$boundary"
  try {
    $u = "http://localhost:4502$dstFolder.createasset.html"
    $resp = Invoke-WebRequest -Uri $u -Method POST -Headers $uploadHdr -Body $body -UseBasicParsing -ErrorAction Stop
    "{0,-25} status={1}" -f $f.Name, ([int]$resp.StatusCode)
  } catch {
    "{0,-25} FAILED: {1}" -f $f.Name, $_.Exception.Message
  }
}
