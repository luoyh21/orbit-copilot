[CmdletBinding()]
param(
  [switch]$SkipWebChecks,
  [switch]$SkipLaunchSmokeTest,
  [string]$OutputDirectory,
  [string]$RuntimeInstallerPath,
  [string]$SevenZipPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$RuntimeName = "MicrosoftEdgeWebView2Runtime-109.0.1518.140-x64.exe"
$RuntimeUrl = "https://catalog.s.download.windowsupdate.com/c/msdownload/update/software/updt/2023/09/microsoftedgestandaloneinstallerx64_1c890b4b8dd6b7c93da98ebdc08ecdc5e30e50cb.exe"
$RuntimeSha256 = "eac95c8095ec5f9971eade9827d8fb67fd251f5c16e702b5312d31067e39119b"
$RuntimeVersion = "109.0.1518.140"
$Win7Toolchain = "nightly-2026-08-25"

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $ProjectRoot "release\win7-portable"
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$BuildCache = Join-Path $OutputDirectory "build-cache"
New-Item -ItemType Directory -Path $BuildCache -Force | Out-Null

$PackageVersion = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$TauriVersion = (Get-Content src-tauri\tauri.conf.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$CargoText = Get-Content src-tauri\Cargo.toml -Raw -Encoding UTF8
if ($CargoText -notmatch '(?ms)^\[package\].*?^version\s*=\s*"(?<version>[^"]+)"') {
  throw "Could not read the package version from src-tauri/Cargo.toml."
}
$CargoVersion = $Matches.version
if ($PackageVersion -ne $TauriVersion -or $PackageVersion -ne $CargoVersion) {
  throw "Version mismatch: package.json=$PackageVersion tauri.conf.json=$TauriVersion Cargo.toml=$CargoVersion"
}

if ([string]::IsNullOrWhiteSpace($SevenZipPath)) {
  $SevenZipCommand = Get-Command 7z.exe -ErrorAction SilentlyContinue
  if (-not $SevenZipCommand) { $SevenZipCommand = Get-Command 7z -ErrorAction SilentlyContinue }
  if ($SevenZipCommand) { $SevenZipPath = $SevenZipCommand.Source }
}
if ([string]::IsNullOrWhiteSpace($SevenZipPath)) {
  $SevenZipCandidates = @(
    (Join-Path $env:ProgramFiles "7-Zip\7z.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "7-Zip\7z.exe")
  )
  $SevenZipPath = $SevenZipCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($SevenZipPath) -or -not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) {
  throw "7-Zip was not found. Install 7-Zip or pass -SevenZipPath."
}

function Invoke-SevenZip([string[]]$Arguments) {
  & $SevenZipPath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "7-Zip failed with exit code $LASTEXITCODE: $($Arguments -join ' ')" }
}

function Assert-Sha256([string]$Path, [string]$Expected) {
  $Actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "SHA-256 mismatch for $Path. Expected $Expected, got $Actual." }
}

if ([string]::IsNullOrWhiteSpace($RuntimeInstallerPath)) {
  $DownloadDirectory = Join-Path $BuildCache "downloads"
  New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
  $RuntimeInstallerPath = Join-Path $DownloadDirectory $RuntimeName
  $NeedsDownload = -not (Test-Path -LiteralPath $RuntimeInstallerPath -PathType Leaf)
  if (-not $NeedsDownload) {
    try { Assert-Sha256 $RuntimeInstallerPath $RuntimeSha256 } catch { $NeedsDownload = $true }
  }
  if ($NeedsDownload) {
    Remove-Item -LiteralPath $RuntimeInstallerPath -Force -ErrorAction SilentlyContinue
    Write-Host "Downloading Microsoft WebView2 109 from the pinned Microsoft Update Catalog URL..."
    Invoke-WebRequest -Uri $RuntimeUrl -OutFile $RuntimeInstallerPath
  }
}
$RuntimeInstallerPath = (Resolve-Path -LiteralPath $RuntimeInstallerPath).Path
Assert-Sha256 $RuntimeInstallerPath $RuntimeSha256
Write-Host "WebView2 installer source verified: $RuntimeSha256" -ForegroundColor Green

$ExtractRoot = Join-Path $BuildCache "webview2-109-extract"
if (Test-Path -LiteralPath $ExtractRoot) { Remove-Item -LiteralPath $ExtractRoot -Recurse -Force }
$OuterDirectory = Join-Path $ExtractRoot "outer"
$PayloadDirectory = Join-Path $ExtractRoot "payload"
$RuntimeDirectory = Join-Path $ExtractRoot "runtime"
New-Item -ItemType Directory -Path $OuterDirectory,$PayloadDirectory,$RuntimeDirectory -Force | Out-Null

Invoke-SevenZip @("x", "-y", "-o$OuterDirectory", $RuntimeInstallerPath)
$NestedInstaller = Get-ChildItem -LiteralPath $OuterDirectory -Recurse | Where-Object {
  -not $_.PSIsContainer -and $_.Name -match "^MicrosoftEdge_X64_$([Regex]::Escape($RuntimeVersion))\.exe\."
} | Select-Object -First 1
if (-not $NestedInstaller) { throw "The x64 WebView2 payload was not found in the verified installer." }
Invoke-SevenZip @("x", "-y", "-o$PayloadDirectory", $NestedInstaller.FullName)
$MSEdgeArchive = Get-ChildItem -LiteralPath $PayloadDirectory -Recurse -Filter "MSEDGE.7z" | Select-Object -First 1
if (-not $MSEdgeArchive) { throw "MSEDGE.7z was not found in the verified WebView2 payload." }
Invoke-SevenZip @("x", "-y", "-o$RuntimeDirectory", $MSEdgeArchive.FullName)

$ExtractedRuntime = Join-Path $RuntimeDirectory "Chrome-bin\$RuntimeVersion"
$RequiredRuntimeFiles = @(
  "msedgewebview2.exe",
  "msedge.dll",
  "EBWebView\x64\EmbeddedBrowserWebView.dll",
  "icudtl.dat"
)
foreach ($RelativePath in $RequiredRuntimeFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $ExtractedRuntime $RelativePath) -PathType Leaf)) {
    throw "Extracted fixed runtime is incomplete: $RelativePath"
  }
}

$TauriRuntimeDirectory = Join-Path $ProjectRoot "src-tauri\WebView2Runtime"
if (Test-Path -LiteralPath $TauriRuntimeDirectory) {
  Remove-Item -LiteralPath $TauriRuntimeDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $TauriRuntimeDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $ExtractedRuntime "*") -Destination $TauriRuntimeDirectory -Recurse -Force
Write-Host "Fixed WebView2 $RuntimeVersion staged beside the application resource path." -ForegroundColor Green

if (-not $SkipWebChecks) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit code $LASTEXITCODE." }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE." }
}

$Rustup = Get-Command rustup.exe -ErrorAction SilentlyContinue
if (-not $Rustup) { $Rustup = Get-Command rustup -ErrorAction SilentlyContinue }
if (-not $Rustup) { throw "rustup was not found." }
$InstalledToolchains = (& $Rustup.Source toolchain list) -join "`n"
if ($InstalledToolchains -notmatch [Regex]::Escape($Win7Toolchain)) {
  & $Rustup.Source toolchain install $Win7Toolchain --profile minimal --component rust-src
  if ($LASTEXITCODE -ne 0) { throw "Failed to install Rust $Win7Toolchain." }
} else {
  & $Rustup.Source component add rust-src --toolchain $Win7Toolchain
  if ($LASTEXITCODE -ne 0) { throw "Failed to verify rust-src for $Win7Toolchain." }
}

if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
  $env:CARGO_TARGET_DIR = Join-Path $BuildCache "cargo-target"
}
$env:RUSTUP_TOOLCHAIN = $Win7Toolchain
$env:CARGO_UNSTABLE_BUILD_STD = "std,panic_abort"
$env:CARGO_TARGET_X86_64_WIN7_WINDOWS_MSVC_RUSTFLAGS = "-C target-feature=+crt-static"
$env:STATIC_VCRUNTIME = "true"
Write-Host "Building with the real x86_64-win7-windows-msvc target and a static Visual C++ runtime..."
npm run desktop:build:win7:portable
if ($LASTEXITCODE -ne 0) { throw "Win7 portable desktop build failed with exit code $LASTEXITCODE." }

$TargetReleaseDirectory = Join-Path $env:CARGO_TARGET_DIR "x86_64-win7-windows-msvc\release"
$BuiltExecutable = Join-Path $TargetReleaseDirectory "orbit-copilot.exe"
if (-not (Test-Path -LiteralPath $BuiltExecutable -PathType Leaf)) {
  throw "The Win7 application executable was not generated: $BuiltExecutable"
}

$PackageName = "Orbit-Copilot-$PackageVersion-Win7-SP1-x64-portable"
$PackageDirectory = Join-Path $OutputDirectory $PackageName
if (Test-Path -LiteralPath $PackageDirectory) { Remove-Item -LiteralPath $PackageDirectory -Recurse -Force }
New-Item -ItemType Directory -Path $PackageDirectory -Force | Out-Null
Copy-Item -LiteralPath $BuiltExecutable -Destination (Join-Path $PackageDirectory "Orbit-Copilot.exe")
Copy-Item -LiteralPath $TauriRuntimeDirectory -Destination (Join-Path $PackageDirectory "WebView2Runtime") -Recurse
Copy-Item -LiteralPath "$PSScriptRoot\START-ORBIT-COPILOT.cmd" -Destination $PackageDirectory
Copy-Item -LiteralPath "$PSScriptRoot\TEST-WIN7-PORTABLE.cmd" -Destination $PackageDirectory
Copy-Item -LiteralPath "$PSScriptRoot\test-win7-portable.ps1" -Destination (Join-Path $PackageDirectory "TEST-WIN7-PORTABLE.ps1")
Copy-Item -LiteralPath "$ProjectRoot\docs\Win7离线安装.md" -Destination (Join-Path $PackageDirectory "README-Win7.md")

$SmokeReport = Join-Path $PackageDirectory "BUILD-SMOKE-TEST.txt"
$TestArguments = @(
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", "$PSScriptRoot\test-win7-portable.ps1",
  "-PackageDirectory", $PackageDirectory,
  "-ReportPath", $SmokeReport
)
if ($SkipLaunchSmokeTest) { $TestArguments += "-SkipLaunch" }
& powershell.exe @TestArguments
if ($LASTEXITCODE -ne 0) { throw "Portable package verification failed with exit code $LASTEXITCODE." }

$ChecksumTargets = @(
  "Orbit-Copilot.exe",
  "WebView2Runtime\msedgewebview2.exe",
  "WebView2Runtime\msedge.dll",
  "WebView2Runtime\EBWebView\x64\EmbeddedBrowserWebView.dll"
)
$Checksums = foreach ($RelativePath in $ChecksumTargets) {
  $Hash = (Get-FileHash -LiteralPath (Join-Path $PackageDirectory $RelativePath) -Algorithm SHA256).Hash.ToLowerInvariant()
  "$Hash  $($RelativePath.Replace('\', '/'))"
}
$Checksums | Set-Content -LiteralPath (Join-Path $PackageDirectory "SHA256SUMS.txt") -Encoding ASCII

$ZipPath = Join-Path $OutputDirectory "$PackageName.zip"
if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
Push-Location $OutputDirectory
try {
  Invoke-SevenZip @("a", "-tzip", "-mx=9", $ZipPath, $PackageName)
} finally {
  Pop-Location
}
$ZipSha256 = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$ZipSha256  $(Split-Path -Leaf $ZipPath)" | Set-Content -LiteralPath "$ZipPath.sha256" -Encoding ASCII
Copy-Item -LiteralPath $SmokeReport -Destination (Join-Path $OutputDirectory "$PackageName-test-report.txt") -Force

Write-Host "Win7 portable ZIP ready: $ZipPath" -ForegroundColor Green
Write-Host "SHA-256: $ZipSha256" -ForegroundColor Green
