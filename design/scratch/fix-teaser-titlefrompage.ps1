$csrf = "eyJleHAiOjE3ODkxNDY5MDksImlhdCI6MTc4OTE0NjMwOX0.EIZDecJFdTMNwpUSl3N23vH7V91US3ejZKzGg_yoROU"
$authHeader = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))"
$headers = @{ Authorization = $authHeader; "CSRF-Token" = $csrf; Referer = "http://localhost:4506/" }
$base = "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container"

function Post-Form($path, $form) {
    try {
        $r = Invoke-WebRequest -Uri $path -Method Post -Headers $script:headers -Body $form -UseBasicParsing
        Write-Output "$path -> $($r.StatusCode)"
    } catch {
        Write-Output "$path FAILED: $($_.Exception.Message)"
    }
}

Post-Form "$base/teaser1" @{
    "titleFromPage" = "false"
    "descriptionFromPage" = "false"
    "titleFromPage@TypeHint" = "Boolean"
    "descriptionFromPage@TypeHint" = "Boolean"
}
Post-Form "$base/teaser2" @{
    "titleFromPage" = "false"
    "descriptionFromPage" = "false"
    "titleFromPage@TypeHint" = "Boolean"
    "descriptionFromPage@TypeHint" = "Boolean"
}
