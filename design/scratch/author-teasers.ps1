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
function Delete-Node($path) {
    try {
        $r = Invoke-WebRequest -Uri $path -Method Post -Headers $script:headers -Body @{ ":operation" = "delete" } -UseBasicParsing
        Write-Output "DELETE $path -> $($r.StatusCode)"
    } catch {
        Write-Output "DELETE $path FAILED: $($_.Exception.Message)"
    }
}

# Remove the ad-hoc image + list-text composition
Delete-Node "$base/relatedimage1"
Delete-Node "$base/relatedimage2"
Delete-Node "$base/relatedtext"

# Author 2 real Teaser component instances in its place
Post-Form $base @{
    "teaser1/jcr:primaryType" = "nt:unstructured"
    "teaser1/sling:resourceType" = "demo-ai-site/components/teaser"
    "teaser1/fileReference" = "/content/dam/demo-ai-site/customers/cursor/figma-thumbnail.png"
    "teaser1/alt" = "Figma's knowledge base keeps everyone informed and aligned"
    "teaser1/jcr:title" = "Figma"
    "teaser1/titleType" = "h3"
    "teaser1/description" = "<p>Figma's knowledge base keeps everyone informed and aligned.</p>"
    "teaser1:order" = "after relatedtitle"
}

Post-Form $base @{
    "teaser2/jcr:primaryType" = "nt:unstructured"
    "teaser2/sling:resourceType" = "demo-ai-site/components/teaser"
    "teaser2/fileReference" = "/content/dam/demo-ai-site/customers/cursor/remote-thumbnail.png"
    "teaser2/alt" = "Remote built a world-class IT help desk with orchestrated Notion custom agents"
    "teaser2/jcr:title" = "Remote"
    "teaser2/titleType" = "h3"
    "teaser2/description" = "<p>Remote built a world-class IT help desk with orchestrated Notion custom agents.</p>"
    "teaser2:order" = "after teaser1"
}
