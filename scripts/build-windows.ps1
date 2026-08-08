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

Write-Host "Installer ready under src-tauri\target\release\bundle\nsis" -ForegroundColor Green
