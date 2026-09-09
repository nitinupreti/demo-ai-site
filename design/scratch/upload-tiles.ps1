$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$authH = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4504/" }

function Upload-Asset($localPath, $damParent, $fileName, $mime) {
    $csrf = (Invoke-RestMethod -Uri "http://localhost:4504/libs/granite/csrf/token.json" -Headers $authH).token
    $bytes = [System.IO.File]::ReadAllBytes($localPath)
    $boundary = [Guid]::NewGuid().ToString('N')
    $LF = "`r`n"
    $prefix = [System.Text.Encoding]::UTF8.GetBytes("--$boundary$LF" + "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"$LF" + "Content-Type: $mime$LF$LF")
    $suffix = [System.Text.Encoding]::UTF8.GetBytes("$LF" + "--$boundary--$LF")
    $ms = New-Object System.IO.MemoryStream
    $ms.Write($prefix, 0, $prefix.Length)
    $ms.Write($bytes, 0, $bytes.Length)
    $ms.Write($suffix, 0, $suffix.Length)
    Invoke-WebRequest -Method Post -Uri "http://localhost:4504$damParent.createasset.html" -Headers ($authH + @{"CSRF-Token"=$csrf}) -ContentType "multipart/form-data; boundary=$boundary" -Body $ms.ToArray() -UseBasicParsing
}

foreach ($f in @('tile-morning-brew.png','tile-little-plains.png','tile-ryo.png')) {
    $r = Upload-Asset "C:\projects\Trainings\new\demo-ai-site\design\scratch\assets\$f" "/content/dam/demo-ai-site/design" $f "image/png"
    "{0}: {1}" -f $f, $r.StatusCode
}

foreach ($p in @('/content/dam/demo-ai-site/design/tile-morning-brew.png','/content/dam/demo-ai-site/design/tile-little-plains.png','/content/dam/demo-ai-site/design/tile-ryo.png')) {
    $r = Invoke-WebRequest -Uri "http://localhost:4504$p" -Headers $authH -UseBasicParsing -MaximumRedirection 3
    "verify {0}  {1}b" -f $p, $r.RawContentLength
}
