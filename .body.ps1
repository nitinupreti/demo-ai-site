$base='http://localhost:4502'
$page='/content/demo-ai-site/us/en/idt-home'
$pair = "admin:admin"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{Authorization = "Basic $b64"; Referer = "$base/"}
$r = Invoke-WebRequest -Uri "$base$page.html?wcmmode=disabled" -Headers $headers -UseBasicParsing
$out = $r.Content
$hits = [regex]::Matches($out, 'cmp-container|cmp-hero|cmp-card|cmp-product|cmp-impact|cmp-quote|cmp-article|cmp-newsletter|cmp-partner|cmp-section')
$hits | ForEach-Object { $_.Value } | Group-Object | Sort-Object Count -Descending | Format-Table -AutoSize | Out-String | Write-Host
Write-Host '---middle of body---'
$idx = $out.IndexOf('cmp-experiencefragment--footer')
if ($idx -gt 0) {
  $start = [Math]::Max(0, $idx - 3000)
  Write-Host ($out.Substring($start, [Math]::Min(3000, $out.Length - $start)))
}
