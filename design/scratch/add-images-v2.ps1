$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$csrf = (Invoke-RestMethod -Uri "http://localhost:4506/libs/granite/csrf/token.json" -Headers $authHeader -UseBasicParsing).token
$headers = $authHeader.Clone()
$headers["CSRF-Token"] = $csrf
$headers["Referer"] = "http://localhost:4506/"

$base = "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container"

function Create-Image($nodeName, $fileReference, $alt) {
    $body = @{
        ":operation" = "import"
        ":contentType" = "json"
        ":name" = $nodeName
        ":content" = (@{
            "jcr:primaryType" = "nt:unstructured"
            "sling:resourceType" = "demo-ai-site/components/image"
            "fileReference" = $fileReference
            "alt" = $alt
        } | ConvertTo-Json -Compress)
    }
    $resp = Invoke-WebRequest -Uri $base -Method Post -Headers $headers -Body $body -UseBasicParsing
    Write-Output "Created $nodeName : HTTP $($resp.StatusCode)"
}

function Order-Node($nodeName, $target) {
    try {
        $resp = Invoke-WebRequest -Uri "$base/$nodeName" -Method Post -Headers $headers -Body @{ ":order" = "before $target" } -UseBasicParsing
        Write-Output "Ordered $nodeName before $target : HTTP $($resp.StatusCode)"
    } catch {
        $streamReader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Output "FAILED order $nodeName : $($streamReader.ReadToEnd().Substring(0,200))"
    }
}

Create-Image -nodeName "section1image" -fileReference "/content/dam/demo-ai-site/customers/cursor/michael-truell.png" -alt "Michael Truell, Co-founder and CEO of Cursor"
Create-Image -nodeName "section2image" -fileReference "/content/dam/demo-ai-site/customers/cursor/ryo-lu.png" -alt "Ryo Lu, Head of Design at Cursor"
Create-Image -nodeName "relatedimage1" -fileReference "/content/dam/demo-ai-site/customers/cursor/figma-thumbnail.png" -alt "Figma's knowledge base keeps everyone informed and aligned"

Order-Node -nodeName "section1image" -target "section2title"
Order-Node -nodeName "section2image" -target "section3title"
