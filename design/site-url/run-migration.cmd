@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "INTERACTIVE=0"
if "%~1"=="" set "INTERACTIVE=1"

cd /d "%~dp0\..\.."
where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is required but was not found on PATH.
  set "EXIT_CODE=1"
  goto :finish
)

set "HAS_URL=0"
set "HAS_AEM_PORT=0"
set "SHOW_HELP=0"
set "LIST_MODELS=0"
set "HAS_LOGIN_MODE=0"
set "LOGIN_ARG="
for %%A in (%*) do (
  if /i "%%~A"=="--url" set "HAS_URL=1"
  if /i "%%~A"=="-u" set "HAS_URL=1"
  if /i "%%~A"=="--aem-port" set "HAS_AEM_PORT=1"
  if /i "%%~A"=="--help" set "SHOW_HELP=1"
  if /i "%%~A"=="-h" set "SHOW_HELP=1"
  if /i "%%~A"=="--list-models" set "LIST_MODELS=1"
  if /i "%%~A"=="--login" set "HAS_LOGIN_MODE=1"
  if /i "%%~A"=="--no-login" set "HAS_LOGIN_MODE=1"
)

if "!SHOW_HELP!"=="1" goto :run_existing

if "!HAS_LOGIN_MODE!"=="0" (
  set "LOGIN_CHOICE="
  set /p "LOGIN_CHOICE=Open GitHub login in browser? [Y/n]: "
  set "RAW_LOGIN_CHOICE=!LOGIN_CHOICE!"
  set "LOGIN_CHOICE="
  for /f "tokens=* delims= " %%A in ("!RAW_LOGIN_CHOICE!") do set "LOGIN_CHOICE=%%A"
  if /i "!LOGIN_CHOICE!"=="n" (
    set "LOGIN_ARG=--no-login"
  ) else (
    set "LOGIN_ARG=--login"
  )
)

if "!LIST_MODELS!"=="1" goto :run_existing
if "!HAS_URL!"=="1" if "!HAS_AEM_PORT!"=="1" goto :run_existing

for /f "tokens=1,* delims==" %%A in ('node "%~dp0run-migration.mjs" --print-defaults') do (
  if /i "%%A"=="SITE_URL" set "DEFAULT_SITE_URL=%%B"
  if /i "%%A"=="AEM_PORT" set "DEFAULT_AEM_PORT=%%B"
)
if not defined DEFAULT_SITE_URL (
  echo ERROR: Could not read the default SITE_URL from prompt_new.md.
  set "EXIT_CODE=1"
  goto :finish
)
if not defined DEFAULT_AEM_PORT (
  echo ERROR: Could not read the default AEM port.
  set "EXIT_CODE=1"
  goto :finish
)

if "!HAS_URL!"=="0" (
  set "SITE_URL="
  set /p "SITE_URL=Live site URL [!DEFAULT_SITE_URL!]: "
  set "RAW_SITE_URL=!SITE_URL!"
  set "SITE_URL="
  for /f "tokens=* delims= " %%A in ("!RAW_SITE_URL!") do set "SITE_URL=%%A"
  if not defined SITE_URL set "SITE_URL=!DEFAULT_SITE_URL!"
)

if "!HAS_AEM_PORT!"=="0" (
  set "AEM_PORT="
  set /p "AEM_PORT=Local AEM author port [!DEFAULT_AEM_PORT!]: "
  set "RAW_AEM_PORT=!AEM_PORT!"
  set "AEM_PORT="
  for /f "tokens=* delims= " %%A in ("!RAW_AEM_PORT!") do set "AEM_PORT=%%A"
  if not defined AEM_PORT set "AEM_PORT=!DEFAULT_AEM_PORT!"
)

if "!HAS_URL!"=="0" if "!HAS_AEM_PORT!"=="0" goto :run_both
if "!HAS_URL!"=="0" goto :run_url
if "!HAS_AEM_PORT!"=="0" goto :run_port

:run_existing
node "%~dp0run-migration.mjs" !LOGIN_ARG! %*
goto :after_run

:run_both
node "%~dp0run-migration.mjs" --url "!SITE_URL!" --aem-port "!AEM_PORT!" !LOGIN_ARG! %*
goto :after_run

:run_url
node "%~dp0run-migration.mjs" --url "!SITE_URL!" !LOGIN_ARG! %*
goto :after_run

:run_port
node "%~dp0run-migration.mjs" --aem-port "!AEM_PORT!" !LOGIN_ARG! %*

:after_run
set "EXIT_CODE=%ERRORLEVEL%"

:finish
if "%INTERACTIVE%"=="1" (
  echo.
  pause
)
exit /b %EXIT_CODE%