$raw = Get-Content -Raw -Path "c:\Users\nitin.upreti\AppData\Roaming\Code\User\workspaceStorage\9b3e2e7a7b3d5a5516b18e37027e1218\GitHub.copilot-chat\chat-session-resources\e74d8a67-c290-4bfe-a9e0-31843a06aad7\toolu_01UPdyZesShhG6gkFMFj1uHX__vscode-1789135286949\content.txt"
$raw = $raw -replace '^Result:\s*', ''
$unwrapped = $raw | ConvertFrom-Json
$dir = "c:\projects\Trainings\new\demo-ai-site\design\scratch\migration-60d383df-bbca-4e3b-886f-648e6867dbed\stage1"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$unwrapped | Out-File -FilePath "$dir\discovery-1440.json" -Encoding utf8
Write-Output ("Saved bytes: " + (Get-Item "$dir\discovery-1440.json").Length)
