$ErrorActionPreference = 'Continue'
$dam = 'C:\projects\Trainings\new\demo-ai-site\ui.content\src\main\content\jcr_root\content\dam\demo-ai-site\design'
$local = Join-Path $dam 'sustainability-tom-speedy.jpg'
Invoke-WebRequest -Uri 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Tom-Speedy.jpg' -OutFile $local -UseBasicParsing -TimeoutSec 30
$len = (Get-Item $local).Length
$up = & curl.exe -s -u admin:admin -w "HTTP:%{http_code}`n" -F "fileName=sustainability-tom-speedy.jpg" -F ("file=@" + $local + ";type=image/jpeg") 'http://localhost:4502/content/dam/demo-ai-site/design.createasset.html' -o "$env:TEMP\up.txt"
Write-Host "tom-speedy: $len bytes -> $($up | Select-String 'HTTP:' | Select-Object -First 1)"

$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin'))
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$prime = Invoke-WebRequest -Uri 'http://localhost:4502/libs/granite/csrf/token.json' -Headers @{ Authorization = $auth } -WebSession $session -UseBasicParsing
$csrf = ($prime.Content | ConvertFrom-Json).token
$hdr = @{ Authorization = $auth; 'CSRF-Token' = $csrf; Referer = 'http://localhost:4502/' }
function Post($url, $body) { try { $r = Invoke-WebRequest -Uri $url -Method Post -Headers $hdr -WebSession $session -Body $body -UseBasicParsing -TimeoutSec 30; return [int]$r.StatusCode } catch { return "ERR:$($_.Exception.Message)" } }

$grid = '/content/demo-ai-site/us/en/sustainability/jcr:content/root/container/container'

Write-Host "section6_heading: $(Post ("http://localhost:4502$grid/section6_heading") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/section-heading'
  'heading' = 'Building sustainability into our manufacturing'
  'align' = 'center'
  'level' = 'h2'
})"

Write-Host "section6_quote: $(Post ("http://localhost:4502$grid/section6_quote") @{
  'jcr:primaryType' = 'nt:unstructured'
  'sling:resourceType' = 'demo-ai-site/components/quote-carousel'
})"
Write-Host "section6_quote.quotes: $(Post ("http://localhost:4502$grid/section6_quote/quotes") @{ 'jcr:primaryType' = 'nt:unstructured' })"

$quoteText = 'One of the things I am most proud about at IDT is that we began building sustainability into our manufacturing, research, and commercial operations many years before it began to be widely adopted globally as a result of the dramatic climate changes we are experiencing.'
Write-Host "quote.item0: $(Post ("http://localhost:4502$grid/section6_quote/quotes/item0") @{
  'jcr:primaryType' = 'nt:unstructured'
  'quote' = $quoteText
  'attribution' = ("Tom Speedy" + [char]0x2014 + " Commercial Product Manager Synthetic Biology, IDT")
  'image' = '/content/dam/demo-ai-site/design/sustainability-tom-speedy.jpg'
  'imageAlt' = 'Headshot of Tom Speedy, Commercial Product Manager for Synthetic Biology at IDT'
  'ctaLabel' = ''
  'ctaLabel@Delete' = ''
  'ctaLink' = ''
  'ctaLink@Delete' = ''
})"
