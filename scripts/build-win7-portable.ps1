[CmdletBinding()]
param(
  [switch]$SkipWebChecks,
  [switch]$SkipLaunchSmokeTest,
  [string]$OutputDirectory,
  [Alias("RuntimeInstallerPath")]
  [string]$RuntimeArchivePath,
  [string]$SevenZipPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$RuntimeName = "Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.x64.cab"
# Microsoft's retired WebView2 109 Fixed Version Runtime is no longer served by
# its original CDN. This is a byte-for-byte archive copy; the pinned archive
# hash and Microsoft Authenticode signatures on the extracted binaries are both
# verified below before anything is packaged.
$RuntimeUrl = "https://github.com/westinyang/WebView2RuntimeArchive/releases/download/109.0.1518.78/Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.x64.cab"
$RuntimeSha256 = "7622281cf83de1a35e3a471f432f7a897d65f0a7d3975df08512b7b253dd45c7"
$RuntimeVersion = "109.0.1518.78"
$RuntimeFolderName = "Microsoft.WebView2.FixedVersionRuntime.$RuntimeVersion.x64"
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
  if ($LASTEXITCODE -ne 0) { throw "7-Zip failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')" }
}

function Assert-Sha256([string]$Path, [string]$Expected) {
  $Actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "SHA-256 mismatch for $Path. Expected $Expected, got $Actual." }
}

if ([string]::IsNullOrWhiteSpace($RuntimeArchivePath)) {
  $DownloadDirectory = Join-Path $BuildCache "downloads"
  New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
  $RuntimeArchivePath = Join-Path $DownloadDirectory $RuntimeName
  $NeedsDownload = -not (Test-Path -LiteralPath $RuntimeArchivePath -PathType Leaf)
  if (-not $NeedsDownload) {
    try { Assert-Sha256 $RuntimeArchivePath $RuntimeSha256 } catch { $NeedsDownload = $true }
  }
  if ($NeedsDownload) {
    Remove-Item -LiteralPath $RuntimeArchivePath -Force -ErrorAction SilentlyContinue
    Write-Host "Downloading the pinned archive of Microsoft WebView2 Fixed Version Runtime 109..."
    Invoke-WebRequest -Uri $RuntimeUrl -OutFile $RuntimeArchivePath
  }
}
$RuntimeArchivePath = (Resolve-Path -LiteralPath $RuntimeArchivePath).Path
Assert-Sha256 $RuntimeArchivePath $RuntimeSha256
Write-Host "WebView2 fixed-runtime archive verified: $RuntimeSha256" -ForegroundColor Green

$ExtractRoot = Join-Path $BuildCache "webview2-109-extract"
if (Test-Path -LiteralPath $ExtractRoot) { Remove-Item -LiteralPath $ExtractRoot -Recurse -Force }
New-Item -ItemType Directory -Path $ExtractRoot -Force | Out-Null
Invoke-SevenZip @("x", "-y", "-o$ExtractRoot", $RuntimeArchivePath)
$ExtractedRuntime = Join-Path $ExtractRoot $RuntimeFolderName
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

foreach ($SignedRelativePath in @("msedgewebview2.exe", "msedge.dll", "EBWebView\x64\EmbeddedBrowserWebView.dll")) {
  $SignedPath = Join-Path $ExtractedRuntime $SignedRelativePath
  $Signature = Get-AuthenticodeSignature -LiteralPath $SignedPath
  if ($Signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
      -not $Signature.SignerCertificate -or
      $Signature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
    throw "Microsoft Authenticode verification failed for $SignedRelativePath (status=$($Signature.Status), signer=$($Signature.SignerCertificate.Subject))."
  }
}
Write-Host "WebView2 runtime binaries have valid Microsoft Authenticode signatures." -ForegroundColor Green

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
# Do not set Tauri's legacy STATIC_VCRUNTIME switch here. The Win7 Rust target
# already links the full CRT through +crt-static; combining both switches makes
# Tauri override the static UCRT with the dynamic import library.
Remove-Item Env:STATIC_VCRUNTIME -ErrorAction SilentlyContinue
Write-Host "Building with the real x86_64-win7-windows-msvc target and a static Visual C++ runtime..."

# x86_64-win7-windows-msvc is a Rust Tier 3 target. rustc supports it together
# with build-std, but rustup does not distribute it and therefore omits it from
# `rustup target list`. Tauri CLI 2.11 validates --target against that incomplete
# rustup list. Keep Cargo available as an explicit runner while hiding rustup
# from Tauri's PATH-based check so the real target reaches rustc.
$CargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
if (-not $CargoCommand) { $CargoCommand = Get-Command cargo -ErrorAction SilentlyContinue }
$NpxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $NpxCommand) { $NpxCommand = Get-Command npx -ErrorAction SilentlyContinue }
$RustupCommand = Get-Command rustup.exe -ErrorAction SilentlyContinue
if (-not $RustupCommand) { $RustupCommand = Get-Command rustup -ErrorAction SilentlyContinue }
if (-not $CargoCommand -or -not $NpxCommand -or -not $RustupCommand) {
  throw "cargo, npx, and rustup must all be available before building the Win7 target."
}

$OriginalPath = $env:PATH
$RustupDirectory = (Split-Path -Parent $RustupCommand.Source).TrimEnd('\')
$TauriPathShim = Join-Path $BuildCache "tauri-path-shim"
if (Test-Path -LiteralPath $TauriPathShim) { Remove-Item -LiteralPath $TauriPathShim -Recurse -Force }
New-Item -ItemType Directory -Path $TauriPathShim -Force | Out-Null
$ShimCargo = Join-Path $TauriPathShim "cargo.exe"
Copy-Item -LiteralPath $CargoCommand.Source -Destination $ShimCargo
$FilteredPathEntries = @($TauriPathShim) + @($OriginalPath -split [IO.Path]::PathSeparator | Where-Object {
  $_ -and $_.TrimEnd('\') -ine $RustupDirectory
})
$FilteredPath = $FilteredPathEntries -join [IO.Path]::PathSeparator
try {
  $env:PATH = $FilteredPath
  & $NpxCommand.Source tauri build `
    --runner $ShimCargo `
    --no-bundle `
    --target x86_64-win7-windows-msvc `
    --config src-tauri/tauri.win7.portable.conf.json `
    -- -Z build-std=std,panic_abort
  if ($LASTEXITCODE -ne 0) { throw "Win7 portable desktop build failed with exit code $LASTEXITCODE." }
} finally {
  $env:PATH = $OriginalPath
}

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
Copy-Item -LiteralPath "$ProjectRoot\docs\Win7虚拟机验收报告.md" -Destination $PackageDirectory
$EvidenceDirectory = Join-Path $PackageDirectory "assets\win7-vm"
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
Copy-Item -Path "$ProjectRoot\docs\assets\win7-vm\*" -Destination $EvidenceDirectory

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
