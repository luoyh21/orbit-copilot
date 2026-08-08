[CmdletBinding()]
param(
  [switch]$SkipInstallSmokeTest
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$PackageVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$TauriVersion = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
if ($PackageVersion -ne $TauriVersion) {
  throw "Version mismatch: package.json=$PackageVersion tauri.conf.json=$TauriVersion"
}

npm ci
npm run build
npm test
npm run desktop:build

$Installer = Get-ChildItem "src-tauri\target\release\bundle\nsis\*setup.exe" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $Installer) {
  throw "The Windows installer was not generated."
}

if (-not $SkipInstallSmokeTest) {
  & "$PSScriptRoot\install-smoke-test.ps1" -InstallerPath $Installer.FullName
}

Write-Host "Installer ready: $($Installer.FullName)" -ForegroundColor Green
