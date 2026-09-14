$csrf = "eyJleHAiOjE3ODkxNDQ3NTAsImlhdCI6MTc4OTE0NDE1MH0.qiacJQzHsPajXMWA8AXTs1TqQ5PTYe4NW-A7Ap3HePI"
$authHeader = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))"
$damFolder = "http://localhost:4506/content/dam/demo-ai-site/customers/cursor"

function Upload-Asset($filePath, $fileName, $contentType) {
    $boundary = [System.Guid]::NewGuid().ToString()
    $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
    $enc = [System.Text.Encoding]::GetEncoding("ISO-8859-1")
    $fileContent = $enc.GetString($fileBytes)

    $bodyLines = @(
        "--$boundary",
        "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"",
        "Content-Type: $contentType",
        "",
        $fileContent,
        "--$boundary--",
        ""
    ) -join "`r`n"

    $bodyBytes = $enc.GetBytes($bodyLines)

    $headers = @{
        Authorization = $authHeader
        "CSRF-Token"  = $csrf
        Referer       = "http://localhost:4506/"
    }

    try {
        $r = Invoke-WebRequest -Uri "$damFolder.createasset.html" -Method Post -Headers $headers -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyBytes -UseBasicParsing
        Write-Output "UPLOAD $fileName -> $($r.StatusCode)"
    } catch {
        Write-Output "UPLOAD $fileName FAILED: $($_.Exception.Message)"
    }
}

Upload-Asset "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current\dam-source\remote-logo.png" "remote-logo.png" "image/png"
Upload-Asset "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current\dam-source\remote-thumbnail.png" "remote-thumbnail.png" "image/png"
