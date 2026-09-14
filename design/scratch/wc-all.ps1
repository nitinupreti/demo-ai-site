$root = "c:\projects\Trainings\new\demo-ai-site\design\site-url"
$files = @("prompt_new.md","01-source-discovery.md","02-component-authoring.md","03-assets-runtime.md","04-visual-parity.md","05-completion-output.md","references\capture-gates.md","references\skill-routing.md")
$total = 0
foreach ($f in $files) {
    $text = Get-Content (Join-Path $root $f) -Raw
    $wc = ($text -split '\s+' | Where-Object { $_ -ne '' }).Count
    Write-Output "$f = $wc"
    $total += $wc
}
Write-Output "TOTAL=$total"
