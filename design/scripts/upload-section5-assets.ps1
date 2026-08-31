$ErrorActionPreference = 'Continue'
$dam = 'C:\projects\Trainings\new\demo-ai-site\ui.content\src\main\content\jcr_root\content\dam\demo-ai-site\design'
$assets = @(
  @{ url = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/right-check-icon.svg'; name = 'sustainability-check-icon.svg';   mime = 'image/svg+xml' },
  @{ url = 'https://sg.idtdna.com/page/wp-content/uploads/idt-headquarters.png';          name = 'sustainability-headquarters.png'; mime = 'image/png' }
)
foreach ($a in $assets) {
  $local = Join-Path $dam $a.name
  try {
    Invoke-WebRequest -Uri $a.url -OutFile $local -UseBasicParsing -TimeoutSec 30
    $len = (Get-Item $local).Length
    $up = & curl.exe -s -u admin:admin -w "HTTP:%{http_code}`n" -F "fileName=$($a.name)" -F ("file=@" + $local + ";type=" + $a.mime) 'http://localhost:4502/content/dam/demo-ai-site/design.createasset.html' -o "$env:TEMP\up.txt"
    Write-Host "$($a.name): $len bytes -> $($up | Select-String 'HTTP:' | Select-Object -First 1)"
  } catch { Write-Host "$($a.name): ERROR $($_.Exception.Message)" }
}
