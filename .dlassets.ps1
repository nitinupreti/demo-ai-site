New-Item -ItemType Directory -Path .assets -Force | Out-Null
$assets = @{
  # product card icons
  'oligos-icon.svg'          = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Group-2529.svg'
  'crispr-icon.svg'          = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/CRISPR-1.svg'
  'gene-synthesis-icon.svg'  = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Gene_Synthesis-1.svg'
  'ngs-icon.svg'             = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/Next_Generation_img-1.svg'
  # impact bg
  'impact-bg.jpg'            = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/home-banner-1-scaled.jpg'
  # newsletter
  'newsletter-logo.svg'      = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/idt-insider_logo.svg'
  # partner logos
  'partner-abcam.svg'        = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/abcam-1c.svg'
  'partner-aldevron.svg'     = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/aldevron.svg.svg'
  'partner-beckman.svg'      = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/beckman-coulter-life-sciences-m-1c.svg'
  'partner-genedata.svg'     = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/Genedata_Logo-1c.svg'
  'partner-idbs.svg'         = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/IDBS.svg'
  'partner-leica.svg'        = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/leica-microsystems-no-byline-1c.svg'
  'partner-phenomenex.svg'   = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/PHENOMENEX.svg'
  # article carousel
  'article-infectious.jpg'   = 'https://sg.idtdna.com/page/wp-content/uploads/2025/10/shutterstock_2204268225-15-300x201.jpg'
  'article-oligo-quant.jpg'  = 'https://sg.idtdna.com/page/wp-content/uploads/2025/10/shutterstock_2151433247-5-300x183.jpg'
  'article-pcr-basics.jpg'   = 'https://sg.idtdna.com/page/wp-content/uploads/2025/10/shutterstock_1896023431-5-300x225.jpg'
  # quote portrait
  'quote-aldevron.jpg'       = 'https://sg.idtdna.com/page/wp-content/uploads/2025/10/CRISPR-Cas12a-5-300x169.jpg'
  # What's New cards
  'whatsnew-oncology.jpg'    = 'https://sg.idtdna.com/page/wp-content/uploads/2025/10/shutterstock_2204268225-15-300x201.jpg'
  'whatsnew-viral.jpg'       = 'https://sg.idtdna.com/page/wp-content/uploads/2025/10/shutterstock_787202599-5-300x201.jpg'
  'whatsnew-webinar.jpg'     = 'https://sg.idtdna.com/page/wp-content/uploads/2025/10/shutterstock_2026544096-11-300x201.jpg'
  'whatsnew-exome.jpg'       = 'https://sg.idtdna.com/page/wp-content/uploads/2025/10/shutterstock_1094088212-11-300x207.jpg'
}
foreach ($f in $assets.Keys) {
  $out = ".assets/$f"
  if (Test-Path $out) { $len = (Get-Item $out).Length; if ($len -gt 200) { "{0,-30} SKIP {1} bytes" -f $f, $len | Write-Host; continue } }
  curl.exe --ssl-no-revoke -sL -A "Mozilla/5.0 (Windows NT 10.0)" -o $out $assets[$f]
  $len = (Get-Item $out).Length
  "{0,-30} {1,10} bytes" -f $f, $len | Write-Host
}
