@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0WebView2Runtime\msedgewebview2.exe" (
  echo [ERROR] WebView2Runtime is incomplete.
  echo Please extract the complete portable ZIP to a local disk and try again.
  pause
  exit /b 2
)

start "" "%~dp0Orbit-Copilot.exe"
exit /b 0
