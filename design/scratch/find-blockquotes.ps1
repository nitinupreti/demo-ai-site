$authHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))" }
$html = Invoke-RestMethod -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.html" -Headers $authHeader
$idx = 0
while ($true) {
  $idx = $html.IndexOf("<blockquote", $idx)
  if ($idx -lt 0) { break }
  Write-Output "--- match at $idx ---"
  Write-Output $html.Substring($idx, [Math]::Min(200, $html.Length - $idx))
  $idx += 1
}
