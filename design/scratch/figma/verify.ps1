$b = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes('admin:admin'))
$hdr = @{ Authorization = "Basic $b"; Referer = 'http://localhost:4502/' }
$page = 'http://localhost:4502/content/demo-ai-site/figma/e-learning-landing.html?wcmmode=disabled'
try {
  $r = Invoke-WebRequest -Uri $page -Headers $hdr -UseBasicParsing -ErrorAction Stop
  "Status: $([int]$r.StatusCode)"
  "Length: $($r.Content.Length)"
  $body = $r.Content
  foreach ($cls in @('Studying Online','Our Success','All-In-One Cloud','What is TOTC','Our Features','Explore Course','What They Say','Latest News','Subscribe','SightlyException','15K+','75%','Instructors','Students','Gloria Rose','Class adds')) {
    $n = ([regex]::Matches($body, [regex]::Escape($cls))).Count
    "{0,-25} {1}" -f $cls, $n
  }
} catch { Write-Warning $_ }
