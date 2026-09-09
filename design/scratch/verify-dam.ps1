$auth = @{Authorization="Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))"; Referer="http://localhost:4504/"}
$base = 'http://localhost:4504'
$paths = @(
  '/content/dam/demo-ai-site/design/figma/raw_02.png',
  '/content/dam/demo-ai-site/design/figma/raw_04.png',
  '/content/dam/demo-ai-site/design/figma/raw_06.png',
  '/content/dam/demo-ai-site/design/figma/raw_07.png',
  '/content/dam/demo-ai-site/design/figma/raw_08.png',
  '/content/dam/demo-ai-site/design/figma/raw_09.jpg',
  '/content/dam/demo-ai-site/design/figma/raw_10.png',
  '/content/dam/demo-ai-site/design/figma/raw_11.jpg',
  '/content/dam/demo-ai-site/design/figma/raw_12.png',
  '/content/dam/demo-ai-site/design/figma/raw_13.png',
  '/content/dam/demo-ai-site/design/figma/raw_14.png',
  '/content/dam/demo-ai-site/design/figma/raw_15.png',
  '/content/dam/demo-ai-site/design/figma/raw_16.png',
  '/content/dam/demo-ai-site/design/figma/raw_17.png',
  '/content/dam/demo-ai-site/design/figma/raw_18.png',
  '/content/dam/demo-ai-site/design/figma/raw_19.png',
  '/content/dam/demo-ai-site/design/figma/raw_20.png'
)
foreach ($p in $paths) {
  try {
    $r = Invoke-WebRequest -Uri "$base$p" -Headers $auth -Method Head -UseBasicParsing -ErrorAction Stop
    "{0}  {1,7} bytes  {2}" -f $r.StatusCode, $r.Headers['Content-Length'], $p
  } catch {
    "ERR {0} {1}" -f $_.Exception.Response.StatusCode.value__, $p
  }
}
