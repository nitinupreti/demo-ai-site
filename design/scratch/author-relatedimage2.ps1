$csrf = "eyJleHAiOjE3ODkxNDQ3NTAsImlhdCI6MTc4OTE0NDE1MH0.qiacJQzHsPajXMWA8AXTs1TqQ5PTYe4NW-A7Ap3HePI"
$authHeader = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))"
$headers = @{
    Authorization = $authHeader
    "CSRF-Token"  = $csrf
    Referer       = "http://localhost:4506/"
}

$parentPath = "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container/container"

$form = @{
    "relatedimage2/jcr:primaryType" = "nt:unstructured"
    "relatedimage2/sling:resourceType" = "demo-ai-site/components/image"
    "relatedimage2/fileReference" = "/content/dam/demo-ai-site/customers/cursor/remote-thumbnail.png"
    "relatedimage2/alt" = "Remote built a world-class IT help desk with orchestrated Notion custom agents"
    "relatedimage2:order" = "after relatedimage1"
}

try {
    $r = Invoke-WebRequest -Uri $parentPath -Method Post -Headers $headers -Body $form -UseBasicParsing
    Write-Output "AUTHOR relatedimage2 -> $($r.StatusCode)"
} catch {
    Write-Output "AUTHOR relatedimage2 FAILED: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Output $reader.ReadToEnd()
    }
}
