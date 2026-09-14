$ErrorActionPreference = "Stop"
$host_ = "http://localhost:4506"
$csrfResp = Invoke-RestMethod -Uri "$host_/libs/granite/csrf/token.json" -Headers @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" } -UseBasicParsing
$authHeader = @{
    Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))"
    "CSRF-Token" = $csrfResp.token
    "Referer" = "$host_/"
}
$folderPath = "/content/dam/demo-ai-site/customers/cursor"

function Upload-Asset($localFile, $damFolder, $fileName, $mime) {
    $boundary = [System.Guid]::NewGuid().ToString()
    $bytes = [System.IO.File]::ReadAllBytes($localFile)
    $enc = [System.Text.Encoding]::GetEncoding("ISO-8859-1")
    $fileContent = $enc.GetString($bytes)

    $bodyLines = @(
        "--$boundary",
        "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"",
        "Content-Type: $mime",
        "",
        $fileContent,
        "--$boundary--",
        ""
    ) -join "`r`n"

    $bodyBytes = $enc.GetBytes($bodyLines)

    $uri = "$host_$damFolder.createasset.html"
    $resp = Invoke-WebRequest -Uri $uri -Method Post -Headers $authHeader -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyBytes -UseBasicParsing
    return $resp.StatusCode
}

$srcDir = "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current\dam-source"

# ensure folder exists
try {
    Invoke-WebRequest -Uri "$host_$folderPath" -Method Post -Headers $authHeader -Body @{ "jcr:primaryType" = "sling:OrderedFolder" } -UseBasicParsing | Out-Null
    Write-Output "Folder ensured: $folderPath"
} catch {
    Write-Output "Folder step: $($_.Exception.Message)"
}

$files = @(
    @{ file = "michael-truell.png"; mime = "image/png" },
    @{ file = "ryo-lu.png"; mime = "image/png" },
    @{ file = "figma-logo.svg"; mime = "image/svg+xml" },
    @{ file = "figma-thumbnail.png"; mime = "image/png" }
)

foreach ($f in $files) {
    $local = Join-Path $srcDir $f.file
    try {
        $status = Upload-Asset -localFile $local -damFolder $folderPath -fileName $f.file -mime $f.mime
        Write-Output "Uploaded $($f.file): HTTP $status"
    } catch {
        Write-Output "FAILED upload $($f.file): $($_.Exception.Message)"
    }
}
