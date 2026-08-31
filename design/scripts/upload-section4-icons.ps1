$ErrorActionPreference = 'Continue'
$dam = 'C:\projects\Trainings\new\demo-ai-site\ui.content\src\main\content\jcr_root\content\dam\demo-ai-site\design'
if (-not (Test-Path $dam)) { New-Item -ItemType Directory -Force -Path $dam | Out-Null }
$assets = @(
  @{ url = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Waste_reduction.svg'; name = 'sustainability-waste-reduction.svg'; mime = 'image/svg+xml' },
  @{ url = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Recycling.svg';        name = 'sustainability-recycling.svg';       mime = 'image/svg+xml' },
  @{ url = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Energy-Reduction.png'; name = 'sustainability-energy-reduction.png'; mime = 'image/png' },
  @{ url = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Shipping.svg';         name = 'sustainability-shipping.svg';        mime = 'image/svg+xml' }
)
foreach ($a in $assets) {
  $local = Join-Path $dam $a.name
  try {
    Invoke-WebRequest -Uri $a.url -OutFile $local -UseBasicParsing -TimeoutSec 30
    $len = (Get-Item $local).Length
    $upload = & curl.exe -s -u admin:admin -w "HTTP:%{http_code}\n" -F "fileName=$($a.name)" -F ("file=@" + $local + ";type=" + $a.mime) 'http://localhost:4502/content/dam/demo-ai-site/design.createasset.html' -o "$env:TEMP\up.txt"
    $code = ($upload -split "`n" | Where-Object { $_ -match 'HTTP:' } | Select-Object -First 1)
    Write-Host "$($a.name): $len bytes -> $code"
  } catch { Write-Host "$($a.name): ERROR $($_.Exception.Message)" }
}
