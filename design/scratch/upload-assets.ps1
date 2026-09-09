$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$authH = @{ Authorization = "Basic $b64"; Referer = "http://localhost:4504/" }
$csrf = (Invoke-RestMethod -Uri "http://localhost:4504/libs/granite/csrf/token.json" -Headers $authH).token

# Ensure DAM folders exist
foreach ($p in @('/content/dam/demo-ai-site','/content/dam/demo-ai-site/design')) {
    try {
        Invoke-WebRequest -Method Post -Uri "http://localhost:4504$p" -Headers ($authH + @{"CSRF-Token"=$csrf}) -Body @{ "jcr:primaryType"="sling:OrderedFolder" } -UseBasicParsing | Out-Null
    } catch { }
}

function Upload-Asset($localPath, $damParent, $fileName, $mime) {
    $csrfLocal = (Invoke-RestMethod -Uri "http://localhost:4504/libs/granite/csrf/token.json" -Headers $authH).token
    $bytes = [System.IO.File]::ReadAllBytes($localPath)
    $boundary = [Guid]::NewGuid().ToString('N')
    $LF = "`r`n"
    $prefix = [System.Text.Encoding]::UTF8.GetBytes("--$boundary$LF" + "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"$LF" + "Content-Type: $mime$LF$LF")
    $suffix = [System.Text.Encoding]::UTF8.GetBytes("$LF" + "--$boundary--$LF")
    $ms = New-Object System.IO.MemoryStream
    $ms.Write($prefix, 0, $prefix.Length)
    $ms.Write($bytes, 0, $bytes.Length)
    $ms.Write($suffix, 0, $suffix.Length)
    $body = $ms.ToArray()
    Invoke-WebRequest -Method Post -Uri "http://localhost:4504$damParent.createasset.html" -Headers ($authH + @{"CSRF-Token"=$csrfLocal}) -ContentType "multipart/form-data; boundary=$boundary" -Body $body -UseBasicParsing
}

$r1 = Upload-Asset "C:\projects\Trainings\new\demo-ai-site\design\scratch\assets\cursor-hero.jpg" "/content/dam/demo-ai-site/design" "cursor-hero.jpg" "image/jpeg"
"hero upload status: $($r1.StatusCode)"

$r2 = Upload-Asset "C:\projects\Trainings\new\demo-ai-site\design\scratch\assets\cursor-logo.svg" "/content/dam/demo-ai-site/design" "cursor-logo.svg" "image/svg+xml"
"logo upload status: $($r2.StatusCode)"

# Verify
foreach ($p in @('/content/dam/demo-ai-site/design/cursor-hero.jpg','/content/dam/demo-ai-site/design/cursor-logo.svg')) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:4504$p" -Headers $authH -UseBasicParsing -MaximumRedirection 3
        "{0}  {1}b  {2}" -f $r.StatusCode, $r.RawContentLength, $p
    } catch { "FAIL $p  $($_.Exception.Message)" }
}
