$ErrorActionPreference = 'Continue'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$hdr = @{ Authorization = $auth }
$new = Invoke-WebRequest -Uri 'http://localhost:4502/content/demo-ai-site/us/en/sustainability/jcr:content.4.json' -Headers $hdr -UseBasicParsing
Write-Host "SUSTAINABILITY_TREE:"; $new.Content
Write-Host "`n---IDT_HOME_TREE---"
$ref = Invoke-WebRequest -Uri 'http://localhost:4502/content/demo-ai-site/us/en/idt-home/jcr:content.4.json' -Headers $hdr -UseBasicParsing
$ref.Content.Substring(0, [Math]::Min(2400, $ref.Content.Length))
