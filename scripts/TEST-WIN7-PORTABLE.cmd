@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0TEST-WIN7-PORTABLE.ps1" -PackageDirectory "%~dp0"
set "TEST_EXIT=%ERRORLEVEL%"
echo.
if not "%TEST_EXIT%"=="0" echo Portable package test failed with code %TEST_EXIT%.
pause
exit /b %TEST_EXIT%
