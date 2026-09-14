try {
  $r = Invoke-WebRequest -Uri "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor.html" -UseBasicParsing
  Write-Output ("STATUS=" + $r.StatusCode)
  Write-Output ("LENGTH=" + $r.Content.Length)
  $r.Content | Out-File -FilePath "design\scratch\cursor-render-check.html" -Encoding utf8
} catch {
  Write-Output ("ERROR: " + $_.Exception.Message)
  if ($_.Exception.Response) {
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $body = $reader.ReadToEnd()
    Write-Output $body.Substring(0, [Math]::Min(2000, $body.Length))
  }
}
