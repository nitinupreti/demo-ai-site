@echo off
setlocal
set "INTERACTIVE=0"
if "%~1"=="" set "INTERACTIVE=1"

cd /d "%~dp0\..\.."
where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is required but was not found on PATH.
  set "EXIT_CODE=1"
  goto :finish
)

node "%~dp0run-migration.mjs" %*
set "EXIT_CODE=%ERRORLEVEL%"

:finish
if "%INTERACTIVE%"=="1" (
  echo.
  pause
)
exit /b %EXIT_CODE%