New-Item -ItemType Directory -Path .assets -Force | Out-Null
$urls = @{
  'Hero-Animation-Start.mp4'  = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Hero-Animation-Start.mp4'
  'Hero-Animation-Repeat.mp4' = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Hero-Animation-Repeat.mp4'
}
foreach ($f in $urls.Keys) {
  $out = ".assets/$f"
  curl.exe --ssl-no-revoke -sL -o $out $urls[$f]
  $len = (Get-Item $out).Length
  "{0,-30} {1} bytes" -f $f, $len | Write-Host
}
