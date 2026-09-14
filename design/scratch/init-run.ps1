$runId = [guid]::NewGuid().ToString()
$evidenceDir = "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-$runId"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
New-Item -ItemType Directory -Path "$evidenceDir\stage1" -Force | Out-Null
Write-Output "RUN_ID=$runId"
Write-Output "EVIDENCE_DIR=$evidenceDir"
$runId | Out-File -FilePath "$evidenceDir\run-id.txt" -Encoding utf8
$startTs = Get-Date -Format "o"
Write-Output "STAGE1_START=$startTs"
"STAGE1_START=$startTs" | Out-File -FilePath "$evidenceDir\stage1\timing.txt" -Encoding utf8
