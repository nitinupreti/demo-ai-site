$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$csrf = (Invoke-RestMethod -Uri "http://localhost:4506/libs/granite/csrf/token.json" -Headers $authHeader -UseBasicParsing).token
$headers = $authHeader.Clone()
$headers["CSRF-Token"] = $csrf
$headers["Referer"] = "http://localhost:4506/"

$base = "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container/container"

function Order-Node($nodeName, $target) {
    try {
        $resp = Invoke-WebRequest -Uri "$base/$nodeName" -Method Post -Headers $headers -Body @{ ":order" = "before $target" } -UseBasicParsing
        Write-Output "Ordered $nodeName before $target : HTTP $($resp.StatusCode)"
    } catch {
        $streamReader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errBody = $streamReader.ReadToEnd()
        Write-Output "FAILED order $nodeName : $errBody"
    }
}

Order-Node -nodeName "section1image" -target "section2title"
Order-Node -nodeName "section2image" -target "section3title"
Order-Node -nodeName "relatedimage1" -target "ZZZ_NONE_LAST"
