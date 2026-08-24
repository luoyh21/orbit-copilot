@echo off
setlocal
cd /d "%~dp0"
echo Orbit Copilot Windows 7 SP1 x64 offline installer
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-win7-offline.ps1"
set RESULT=%ERRORLEVEL%
echo.
if not "%RESULT%"=="0" (
  echo Installation failed. Keep this window open and send the error text to support.
) else (
  echo Installation completed successfully.
)
pause
exit /b %RESULT%
