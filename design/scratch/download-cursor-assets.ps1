$ErrorActionPreference = "Stop"
$outDir = "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-4506-current\dam-source"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$assets = @(
    @{ name = "michael-truell.png"; url = "https://images.ctfassets.net/spoqsaf9291f/6UDph3FMKbYrnCe95kylQI/fdd7e7a54e6a10c1b12eddade96e2f9f/Michael.png" },
    @{ name = "ryo-lu.png"; url = "https://images.ctfassets.net/spoqsaf9291f/QuRlvc5RjleR2K6nRWI5Z/21ff39cb6ca1158ddd03d30eb638a1eb/Ryo.png" },
    @{ name = "figma-logo.svg"; url = "https://images.ctfassets.net/spoqsaf9291f/502ApiNcRHgIwrDU8XRYTQ/497492503acb3fa21bbd9dd1aec193c3/Figma-logo-color.svg" },
    @{ name = "figma-thumbnail.png"; url = "https://images.ctfassets.net/spoqsaf9291f/3uxABpww6Fd8ONXvvP2IqN/5c5197b2089369f7444eab6eac3293a5/Screenshot_2026-02-19_at_3.54.31_PM.png" },
    @{ name = "remote-logo.png"; url = "https://images.ctfassets.net/spoqsaf9291f/6ZVUaDoQZ55MG7bGE90gR9/678b1c5da78031dcbd13de0ca1092717/remote-logo-freelogovectors.net_.png" },
    @{ name = "remote-thumbnail.png"; url = "https://images.ctfassets.net/spoqsaf9291f/46kqY3VdTG1jsFIGONIBzv/a9ed4acd86aea72eca4dd7ec8e82b910/remote-thumbnail.png" }
)

foreach ($a in $assets) {
    $dest = Join-Path $outDir $a.name
    Invoke-WebRequest -Uri $a.url -OutFile $dest -UseBasicParsing
    Write-Output "Downloaded $($a.name) -> $((Get-Item $dest).Length) bytes"
}
