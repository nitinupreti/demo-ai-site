param([string]$Base = 'http://localhost:4504')
$b = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes('admin:admin'))
$hdr = @{ Authorization = "Basic $b"; Referer = "$Base/" }
$page = "$Base/content/demo-ai-site/figma/e-learning-landing.html?wcmmode=disabled"
try {
  $r = Invoke-WebRequest -Uri $page -Headers $hdr -UseBasicParsing -ErrorAction Stop
  "Disabled status: $([int]$r.StatusCode)"
  "Length: $($r.Content.Length)"
  $body = $r.Content
  foreach ($cls in @('Studying Online','Our Success','All-In-One Cloud','What is TOTC','Our Features','Explore Course','What They Say','Latest News','Subscribe','SightlyException','cmp-hero','cmp-stats-strip','cmp-feature-list','cmp-testimonials','15K+','75%','Gloria Rose','Class adds')) {
    $n = ([regex]::Matches($body, [regex]::Escape($cls))).Count
    "{0,-25} {1}" -f $cls, $n
  }
} catch { Write-Warning $_ }

$editor = "$Base/editor.html/content/demo-ai-site/figma/e-learning-landing.html"
try {
  $e = Invoke-WebRequest -Uri $editor -Headers $hdr -UseBasicParsing -ErrorAction Stop
  "Editor status: $([int]$e.StatusCode)"
  "Editor length: $($e.Content.Length)"
} catch { Write-Warning $_ }

foreach ($cat in @('hero','stats-strip','feature-list','testimonials')) {
  $u = "$Base/etc.clientlibs/demo-ai-site/components/$cat/clientlibs/clientlib-$cat.css"
  try {
    $c = Invoke-WebRequest -Uri $u -Headers $hdr -UseBasicParsing -ErrorAction Stop
    "clientlib-$cat status=$([int]$c.StatusCode) bytes=$($c.Content.Length)"
  } catch { "clientlib-$cat FAILED: $_" }
}
