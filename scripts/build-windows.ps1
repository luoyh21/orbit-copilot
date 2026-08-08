[CmdletBinding()]
param(
  [switch]$SkipInstallSmokeTest
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$PackageVersion = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$TauriVersion = (Get-Content src-tauri\tauri.conf.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($PackageVersion -ne $TauriVersion) {
  throw "Version mismatch: package.json=$PackageVersion tauri.conf.json=$TauriVersion"
}

npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit code $LASTEXITCODE." }
npm test
if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE." }
npm run desktop:build
if ($LASTEXITCODE -ne 0) { throw "Desktop build failed with exit code $LASTEXITCODE." }

$TauriTargetDir = if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
  Join-Path $ProjectRoot "src-tauri\target"
} else {
  $env:CARGO_TARGET_DIR
}
$Installer = Get-ChildItem (Join-Path $TauriTargetDir "release\bundle\nsis\*setup.exe") -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $Installer) {
  throw "The Windows installer was not generated."
}

if (-not $SkipInstallSmokeTest) {
  & "$PSScriptRoot\install-smoke-test.ps1" -InstallerPath $Installer.FullName
}

Write-Host "Installer ready: $($Installer.FullName)" -ForegroundColor Green
