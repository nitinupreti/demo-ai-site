$more = @{
  'pcr-icon.svg'        = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/PCR-_qPCR-_dPCR-1.svg'
  'cgmp-icon.svg'       = 'https://sg.idtdna.com/page/wp-content/uploads/2024/08/cGMP_Manufacturing-1.svg'
  'partner-moledev.svg' = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/MOLEDEV.svg'
  'partner-sciex.svg'   = 'https://sg.idtdna.com/page/wp-content/uploads/2024/09/SCIEX.svg'
}
foreach ($f in $more.Keys) {
  curl.exe --ssl-no-revoke -sL -A "Mozilla/5.0" -o ".assets/$f" $more[$f]
  "{0,-30} {1} bytes" -f $f, (Get-Item ".assets/$f").Length | Write-Host
}
