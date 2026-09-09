$out = 'design/scratch/figma/assets'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$assets = @{
  'landing-export.png' = 'https://www.figma.com/api/mcp/asset/f7de5203-3ee4-437e-863c-31ad71aa5c95.png'
  'raw_01.png'         = 'https://www.figma.com/api/mcp/asset/b36f20cb-3be9-4f28-a92c-4e457dd15063'
  'raw_02.png'         = 'https://www.figma.com/api/mcp/asset/e1a2d74c-a68d-4ef7-8c8f-9b7035d4eaa7'
  'raw_03.png'         = 'https://www.figma.com/api/mcp/asset/30a7ab6e-cbbd-4c09-abd2-64d7b7e9f2a4'
  'raw_04.png'         = 'https://www.figma.com/api/mcp/asset/12fe68fa-e7f0-4e16-baf1-d1c2abd12445'
  'raw_05.png'         = 'https://www.figma.com/api/mcp/asset/8b805583-2a15-496e-a050-789c59bc7f04'
  'raw_06.png'         = 'https://www.figma.com/api/mcp/asset/3f072c10-b658-4821-9915-6d14e9665300'
  'raw_07.png'         = 'https://www.figma.com/api/mcp/asset/5000efda-886d-47f8-9d4c-13167d03ea7d'
  'raw_08.png'         = 'https://www.figma.com/api/mcp/asset/4f82c8bb-6eb1-46d2-b5f4-6e9af16ffe24'
  'raw_09.jpg'         = 'https://www.figma.com/api/mcp/asset/f51ef04f-c03d-4aa2-9c93-59df9fea63a7'
  'raw_10.png'         = 'https://www.figma.com/api/mcp/asset/9c5e7f8f-9443-4110-8ac9-8105af04e16a'
  'raw_11.jpg'         = 'https://www.figma.com/api/mcp/asset/2a053649-d600-4197-ad9e-37376c055c97'
  'raw_12.png'         = 'https://www.figma.com/api/mcp/asset/1cef068a-17af-4532-885f-61b552111ca5'
  'raw_13.png'         = 'https://www.figma.com/api/mcp/asset/5006e1c1-3336-4180-a721-4fcd6b63e9d5'
  'raw_14.png'         = 'https://www.figma.com/api/mcp/asset/17b898ee-840f-4223-a4bd-7f903283a49d'
  'raw_15.png'         = 'https://www.figma.com/api/mcp/asset/616fe6c7-3e68-4319-b194-1fc5fdd04272'
  'raw_16.png'         = 'https://www.figma.com/api/mcp/asset/427d8f2c-9038-4ce5-a8b6-4f9ee640e2fc'
  'raw_17.png'         = 'https://www.figma.com/api/mcp/asset/0574992d-7fa0-41b8-bdb0-7f1edac1892d'
  'raw_18.png'         = 'https://www.figma.com/api/mcp/asset/36c0092f-58d1-465f-b976-01742a8ba690'
  'raw_19.png'         = 'https://www.figma.com/api/mcp/asset/2bb7b90a-5e49-409b-bedc-243c3a80554b'
  'raw_20.png'         = 'https://www.figma.com/api/mcp/asset/9168b86b-f933-441e-bbb0-953da315c46c'
}
foreach ($k in $assets.Keys) {
  $dst = Join-Path $out $k
  if (-not (Test-Path $dst)) {
    try { Invoke-WebRequest -Uri $assets[$k] -OutFile $dst -UseBasicParsing } catch { Write-Warning "$k failed: $_" }
  }
}
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize
