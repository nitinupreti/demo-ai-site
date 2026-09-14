<#
.SYNOPSIS
    Bootstraps the AEM migration agent pipeline on Windows.

.DESCRIPTION
    Creates a virtual environment beside this script, installs the Python
    dependencies into it, and reports on the external tooling the agents need.
    Safe to re-run.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File design/site-url/scripts/setup.ps1
#>
[CmdletBinding()]
param(
    [string]$VenvPath,
    [switch]$Recreate
)

$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $VenvPath) { $VenvPath = Join-Path $scriptsDir '.venv' }

$repoRoot = $scriptsDir
while ($repoRoot -and -not (Test-Path (Join-Path $repoRoot 'pom.xml'))) {
    $parent = Split-Path -Parent $repoRoot
    if ($parent -eq $repoRoot) { break }
    $repoRoot = $parent
}
Push-Location $repoRoot
$launcher = (Resolve-Path -Relative (Join-Path $scriptsDir 'run_migration.py')) -replace '^\.\\', ''
Pop-Location

$minimumPython = [Version]'3.10'
$ok = $true

function Write-Step { param([string]$Text) Write-Host "`n$Text" -ForegroundColor Cyan }
function Write-Good { param([string]$Text) Write-Host "  OK    $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "  WARN  $Text" -ForegroundColor Yellow }
function Write-Bad  { param([string]$Text) Write-Host "  MISS  $Text" -ForegroundColor Red }

function Get-ToolVersion {
    param([string]$Command, [string[]]$Arguments)
    try {
        $output = & $Command @Arguments 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { return $null }
        return ($output -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
    } catch {
        return $null
    }
}

# --- Python -----------------------------------------------------------------

Write-Step 'Checking Python'

$pythonExe = $null
foreach ($candidate in @('python', 'python3', 'py')) {
    $resolved = Get-Command $candidate -ErrorAction SilentlyContinue
    if (-not $resolved) { continue }
    # No inner quotes: PowerShell strips them when passing to a native command.
    $reported = Get-ToolVersion $candidate @('-c', 'import platform; print(platform.python_version())')
    if (-not $reported) { continue }
    if ([Version]$reported -ge $minimumPython) {
        $pythonExe = $resolved.Source
        Write-Good "Python $reported at $pythonExe"
        break
    }
    Write-Warn "Python $reported at $($resolved.Source) is older than $minimumPython"
}

if (-not $pythonExe) {
    Write-Bad "Python $minimumPython or newer was not found."
    Write-Host @"

  Install Python, then re-run this script:

    winget install Python.Python.3.12
      - or -
    https://www.python.org/downloads/windows/

  During a manual install, tick "Add python.exe to PATH".
  Open a new terminal afterwards so PATH changes take effect.
"@ -ForegroundColor Yellow
    exit 1
}

# --- Virtual environment ----------------------------------------------------

Write-Step "Preparing virtual environment at $VenvPath"

if ($Recreate -and (Test-Path $VenvPath)) {
    Remove-Item -Recurse -Force $VenvPath
    Write-Good 'Removed the existing environment'
}

$venvPython = Join-Path $VenvPath 'Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    & $pythonExe -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) { throw "Could not create a virtual environment at $VenvPath" }
    Write-Good 'Created'
} else {
    Write-Good 'Already present'
}

Write-Step 'Installing Python dependencies'
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r (Join-Path $scriptsDir 'requirements.txt') --quiet
if ($LASTEXITCODE -ne 0) { throw 'pip install failed.' }
Write-Good "PyYAML $(Get-ToolVersion $venvPython @('-c', 'import yaml; print(yaml.__version__)'))"

# --- External tooling -------------------------------------------------------

Write-Step 'Checking external tooling'

$node = Get-ToolVersion 'node' @('--version')
if ($node) { Write-Good "Node.js $node" } else { $ok = $false; Write-Bad 'Node.js 18+ - https://nodejs.org/' }

$copilot = Get-ToolVersion 'copilot' @('--version')
if (-not $copilot -and $env:APPDATA) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $bundled = Join-Path $env:APPDATA "npm\node_modules\@github\copilot\node_modules\@github\copilot-win32-$arch\copilot.exe"
    if (Test-Path $bundled) { $copilot = Get-ToolVersion $bundled @('--version') }
}
if ($copilot) {
    Write-Good "GitHub Copilot CLI $copilot"
    Write-Warn 'Run `copilot login` if you have not authenticated on this machine.'
} else {
    $ok = $false
    Write-Bad 'GitHub Copilot CLI - `npm install -g @github/copilot` then `copilot login`'
}

$mvn = Get-ToolVersion 'mvn' @('-v')
if ($mvn) { Write-Good $mvn } else { $ok = $false; Write-Bad 'Maven - https://maven.apache.org/download.cgi' }

$javaLine = Get-ToolVersion 'java' @('-version')
if ($javaLine) { Write-Good $javaLine } else { $ok = $false; Write-Bad 'Java JDK - see .cloudmanager/java-version for the expected major version' }

# --- Local AEM --------------------------------------------------------------

Write-Step 'Checking local AEM author'

$aemHost = if ($env:AEM_HOST) { $env:AEM_HOST } else { 'localhost' }
$aemPort = if ($env:AEM_PORT) { $env:AEM_PORT } else { '4502' }
try {
    $response = Invoke-WebRequest -Uri "http://${aemHost}:${aemPort}/libs/granite/core/content/login.html" `
        -Method Head -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    Write-Good "AEM author reachable on http://${aemHost}:${aemPort} (HTTP $($response.StatusCode))"
} catch {
    Write-Warn "AEM author is not reachable on http://${aemHost}:${aemPort}. Start the SDK quickstart before a real run."
}

if (-not $env:AEM_CREDENTIALS) {
    Write-Warn 'AEM_CREDENTIALS is not set; the agents will fall back to the config default.'
}

# --- Next steps -------------------------------------------------------------

Write-Step 'Next steps'
Write-Host @"
  1. Activate the environment:

       $VenvPath\Scripts\Activate.ps1

  2. Set the AEM credentials for this session (never commit them):

       `$env:AEM_CREDENTIALS = 'admin:admin'

  3. From the repository root ($repoRoot), verify the resolved contract:

       python $launcher --show-plan
       python $launcher --dry-run

  4. Run a migration:

       python $launcher --url https://example.com/page --max-parallel 1
"@

if (-not $ok) {
    Write-Host "`nSome external tooling is missing. Install it before a real run." -ForegroundColor Yellow
    exit 1
}
Write-Host "`nSetup complete." -ForegroundColor Green
