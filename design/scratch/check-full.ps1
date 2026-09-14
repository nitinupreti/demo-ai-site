$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$r = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.infinity.json" -Headers $authHeader -UseBasicParsing
$json = $r.Content | ConvertFrom-Json
$json.'jcr:content'.root.container.container.container.PSObject.Properties.Name
