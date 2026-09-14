$runId = [guid]::NewGuid().ToString()
Write-Output "RUN_ID=$runId"
$start = Get-Date
Write-Output "RUN_START=$($start.ToString('o'))"
$evidenceDir = "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-$runId"
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
New-Item -ItemType Directory -Force -Path "$evidenceDir\discovery" | Out-Null
"$runId" | Out-File -FilePath "$evidenceDir\run-id.txt" -Encoding utf8
"RUN_START=$($start.ToString('o'))" | Out-File -FilePath "$evidenceDir\timing.txt" -Encoding utf8
Write-Output "EVIDENCE_DIR=$evidenceDir"
