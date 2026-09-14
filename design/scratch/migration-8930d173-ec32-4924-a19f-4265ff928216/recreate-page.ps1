$ErrorActionPreference = 'Stop'
$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$headers = @{ Authorization = "Basic $cred" }

$tokenResp = Invoke-WebRequest -Uri "http://localhost:4506/libs/granite/csrf/token.json" -Headers $headers -UseBasicParsing
$token = ($tokenResp.Content | ConvertFrom-Json).token
$csrfHeaders = $headers.Clone()
$csrfHeaders["CSRF-Token"] = $token
$csrfHeaders["Referer"] = "http://localhost:4506/"

# Delete the malformed page
$delForm = @{ ":operation" = "delete" }
$resp = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor" -Method Post -Headers $csrfHeaders -Body $delForm -UseBasicParsing
Write-Output "Delete status: $($resp.StatusCode)"

# Recreate via standard WCM create-page command so template structure is properly instantiated
$createForm = @{
  "cmd" = "createPage"
  "parentPath" = "/content/demo-ai-site/us/en/customers"
  "template" = "/conf/demo-ai-site/settings/wcm/templates/page-content"
  "title" = "How the world's fastest-growing startup stays fast with Notion"
  "label" = "cursor"
}
$resp2 = Invoke-WebRequest -Uri "http://localhost:4506/bin/wcmcommand" -Method Post -Headers $csrfHeaders -Body $createForm -UseBasicParsing
Write-Output "Create status: $($resp2.StatusCode)"
Write-Output $resp2.Content
