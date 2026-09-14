$ErrorActionPreference = 'Stop'
$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$headers = @{ Authorization = "Basic $cred" }
$tokenResp = Invoke-WebRequest -Uri "http://localhost:4506/libs/granite/csrf/token.json" -Headers $headers -UseBasicParsing
$token = ($tokenResp.Content | ConvertFrom-Json).token
$csrfHeaders = $headers.Clone()
$csrfHeaders["CSRF-Token"] = $token
$csrfHeaders["Referer"] = "http://localhost:4506/"

$jsonPath = "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-8930d173-ec32-4924-a19f-4265ff928216\cursor-article-body.json"
$jsonContent = Get-Content -Raw -Path $jsonPath

$boundary = [System.Guid]::NewGuid().ToString()
$LF = "`r`n"
$bodyLines = (
  "--$boundary",
  "Content-Disposition: form-data; name=`":operation`"",
  "",
  "import",
  "--$boundary",
  "Content-Disposition: form-data; name=`":contentType`"",
  "",
  "json",
  "--$boundary",
  "Content-Disposition: form-data; name=`":replaceProperties`"",
  "",
  "true",
  "--$boundary",
  "Content-Disposition: form-data; name=`":content`"; filename=`"body.json`"",
  "Content-Type: application/json",
  "",
  $jsonContent,
  "--$boundary--",
  ""
) -join $LF

$importHeaders = $csrfHeaders.Clone()
$importHeaders["Content-Type"] = "multipart/form-data; boundary=$boundary"

$resp = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container" -Method Post -Headers $importHeaders -Body $bodyLines -UseBasicParsing
Write-Output "Import status: $($resp.StatusCode)"
