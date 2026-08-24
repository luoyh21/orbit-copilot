[CmdletBinding()]
param(
  [switch]$SkipWebChecks,
  [switch]$SkipInstallSmokeTest,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$RuntimeName = "MicrosoftEdgeWebView2Runtime-109.0.1518.140-x64.exe"
$RuntimeUrl = "https://catalog.s.download.windowsupdate.com/c/msdownload/update/software/updt/2023/09/microsoftedgestandaloneinstallerx64_1c890b4b8dd6b7c93da98ebdc08ecdc5e30e50cb.exe"
$RuntimeSha256 = "eac95c8095ec5f9971eade9827d8fb67fd251f5c16e702b5312d31067e39119b"
$SsuName = "windows6.1-kb4490628-x64.msu"
$SsuUrl = "https://catalog.s.download.windowsupdate.com/c/msdownload/update/software/secu/2019/03/windows6.1-kb4490628-x64_d3de52d6987f7c8bdc2c015dca69eac96047c76e.msu"
$SsuSha256 = "8075f6d889bcb27be6f52ed47081675e5bb8a5390f2f5bfe4ec27a2bb70cbf5e"
$Sha2Name = "windows6.1-kb4474419-v3-x64.msu"
$Sha2Url = "https://catalog.s.download.windowsupdate.com/c/msdownload/update/software/secu/2019/09/windows6.1-kb4474419-v3-x64_b5614c6cea5cb4e198717789633dca16308ef79c.msu"
$Sha2Sha256 = "99312df792b376f02e25607d2eb3355725c47d124d8da253193195515fe90213"
$Version = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$TauriVersion = (Get-Content src-tauri\tauri.conf.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($Version -ne $TauriVersion) {
  throw "Version mismatch: package.json=$Version tauri.conf.json=$TauriVersion"
}

if (-not $SkipWebChecks) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit code $LASTEXITCODE." }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE." }
}

npm run desktop:build:win7
if ($LASTEXITCODE -ne 0) { throw "Win7 desktop build failed with exit code $LASTEXITCODE." }

$TauriTargetDir = if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
  Join-Path $ProjectRoot "src-tauri\target"
} else {
  $env:CARGO_TARGET_DIR
}
$BuiltInstaller = Get-ChildItem (Join-Path $TauriTargetDir "release\bundle\nsis\*setup.exe") -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $BuiltInstaller) {
  throw "The Win7 application installer was not generated."
}
if (-not $SkipInstallSmokeTest) {
  & "$PSScriptRoot\install-smoke-test.ps1" -InstallerPath $BuiltInstaller.FullName
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $ProjectRoot "release\win7"
}
$BundleDirectory = Join-Path $OutputDirectory "Orbit-Copilot-$Version-Win7-SP1-x64-offline"
New-Item -ItemType Directory -Path $BundleDirectory -Force | Out-Null

function Get-VerifiedDownload([string]$Name, [string]$Url, [string]$Sha256) {
  $Path = Join-Path $BundleDirectory $Name
  $LastError = $null
  for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
    try {
      Invoke-WebRequest -Uri $Url -OutFile $Path
      $Actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($Actual -ne $Sha256) {
        throw "SHA-256 mismatch. Expected $Sha256, got $Actual."
      }
      return $Path
    } catch {
      $LastError = $_
      Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
      if ($Attempt -lt 3) { Start-Sleep -Seconds (2 * $Attempt) }
    }
  }
  throw "Failed to download and verify $Name after 3 attempts: $LastError"
}

$SsuPath = Get-VerifiedDownload $SsuName $SsuUrl $SsuSha256
$Sha2Path = Get-VerifiedDownload $Sha2Name $Sha2Url $Sha2Sha256
$RuntimePath = Get-VerifiedDownload $RuntimeName $RuntimeUrl $RuntimeSha256

$AppName = "Orbit-Copilot-Win7-$Version-x64-setup.exe"
$AppPath = Join-Path $BundleDirectory $AppName
Copy-Item -LiteralPath $BuiltInstaller.FullName -Destination $AppPath
Copy-Item -LiteralPath "$PSScriptRoot\install-win7-offline.ps1" -Destination $BundleDirectory
Copy-Item -LiteralPath "$PSScriptRoot\install-win7-offline.cmd" -Destination $BundleDirectory
Copy-Item -LiteralPath "$ProjectRoot\docs\Win7离线安装.md" -Destination (Join-Path $BundleDirectory "README-Win7.md")

$AppSha256 = (Get-FileHash -LiteralPath $AppPath -Algorithm SHA256).Hash.ToLowerInvariant()
@(
  "$SsuSha256  $SsuName",
  "$Sha2Sha256  $Sha2Name",
  "$RuntimeSha256  $RuntimeName",
  "$AppSha256  $AppName"
) | Set-Content -LiteralPath (Join-Path $BundleDirectory "SHA256SUMS.txt") -Encoding ASCII

$ZipPath = Join-Path $OutputDirectory "Orbit-Copilot-$Version-Win7-SP1-x64-offline.zip"
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
Compress-Archive -Path (Join-Path $BundleDirectory "*") -DestinationPath $ZipPath -CompressionLevel Optimal
if (-not (Get-Command makensis.exe -ErrorAction SilentlyContinue)) {
  throw "makensis.exe was not found. Install NSIS 3 and add it to PATH."
}
$WrapperPath = Join-Path $OutputDirectory "Orbit-Copilot-$Version-Win7-SP1-x64-offline-setup.exe"
& makensis.exe "/DAPP_VERSION=$Version" "/DBUNDLE_DIR=$BundleDirectory" "/DOUTPUT_FILE=$WrapperPath" "$PSScriptRoot\win7-offline-wrapper.nsi"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $WrapperPath)) {
  throw "NSIS Win7 wrapper build failed with exit code $LASTEXITCODE."
}
$WrapperSha256 = (Get-FileHash -LiteralPath $WrapperPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$WrapperSha256  $(Split-Path -Leaf $WrapperPath)" | Set-Content -LiteralPath (Join-Path $OutputDirectory "Orbit-Copilot-$Version-Win7-SP1-x64-offline-setup.exe.sha256") -Encoding ASCII
Write-Host "Win7 offline bundle ready: $ZipPath" -ForegroundColor Green
Write-Host "Win7 standalone installer ready: $WrapperPath" -ForegroundColor Green
