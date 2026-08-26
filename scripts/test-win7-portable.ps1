[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PackageDirectory,
  [string]$ReportPath,
  [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"
$PackageDirectory = (Resolve-Path -LiteralPath $PackageDirectory).Path
if (-not $ReportPath -or $ReportPath.Trim().Length -eq 0) {
  $ReportPath = Join-Path $PackageDirectory "TEST-REPORT.txt"
}

$Report = New-Object System.Collections.ArrayList
function Add-Report([string]$Line) {
  [void]$Report.Add($Line)
  Write-Host $Line
}

function Assert-File([string]$RelativePath) {
  $Path = Join-Path $PackageDirectory $RelativePath
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required portable file is missing: $RelativePath"
  }
  return $Path
}

function Get-PeCompatibility([string]$Path) {
  $Stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $Reader = New-Object IO.BinaryReader($Stream)
  try {
    if ($Reader.ReadUInt16() -ne 0x5A4D) { throw "Not a PE executable: $Path" }
    [void]$Stream.Seek(0x3C, [IO.SeekOrigin]::Begin)
    $PeOffset = $Reader.ReadUInt32()
    [void]$Stream.Seek($PeOffset, [IO.SeekOrigin]::Begin)
    if ($Reader.ReadUInt32() -ne 0x00004550) { throw "Invalid PE signature: $Path" }
    $Machine = $Reader.ReadUInt16()
    [void]$Stream.Seek($PeOffset + 24, [IO.SeekOrigin]::Begin)
    $Magic = $Reader.ReadUInt16()
    if ($Magic -ne 0x20B) { throw "Expected a PE32+ x64 executable, got optional-header magic $Magic." }
    [void]$Stream.Seek($PeOffset + 24 + 40, [IO.SeekOrigin]::Begin)
    $MajorOs = $Reader.ReadUInt16()
    $MinorOs = $Reader.ReadUInt16()
    [void]$Stream.Seek($PeOffset + 24 + 48, [IO.SeekOrigin]::Begin)
    $MajorSubsystem = $Reader.ReadUInt16()
    $MinorSubsystem = $Reader.ReadUInt16()
    return New-Object PSObject -Property @{
      Machine = $Machine
      MajorOs = $MajorOs
      MinorOs = $MinorOs
      MajorSubsystem = $MajorSubsystem
      MinorSubsystem = $MinorSubsystem
    }
  } finally {
    $Reader.Close()
    $Stream.Close()
  }
}

try {
  Add-Report "Orbit Copilot Win7 portable verification"
  Add-Report ("UTC time: " + [DateTime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ss") + "Z")
  $Is64BitOs = ([IntPtr]::Size -eq 8) -or -not [string]::IsNullOrEmpty($env:PROCESSOR_ARCHITEW6432)
  Add-Report ("Host OS: " + [Environment]::OSVersion.VersionString + "; 64-bit OS=" + $Is64BitOs)
  Add-Report ("Package: " + $PackageDirectory)

  $AppPath = Assert-File "Orbit-Copilot.exe"
  $RuntimeExe = Assert-File "WebView2Runtime\msedgewebview2.exe"
  $RuntimeDll = Assert-File "WebView2Runtime\msedge.dll"
  [void](Assert-File "WebView2Runtime\EBWebView\x64\EmbeddedBrowserWebView.dll")
  [void](Assert-File "WebView2Runtime\icudtl.dat")

  $Forbidden = Get-ChildItem -LiteralPath $PackageDirectory -Recurse | Where-Object {
    -not $_.PSIsContainer -and (
      $_.Name -match '(?i)setup\.exe$' -or
      $_.Extension -match '(?i)^\.(msi|msu)$' -or
      $_.Name -match '(?i)^MicrosoftEdgeWebView2Runtime.*\.exe$'
    )
  }
  if ($Forbidden) {
    throw "Installer files are forbidden in the portable package: $($Forbidden.FullName -join ', ')"
  }
  Add-Report "Installer-free check: PASS (no setup.exe, MSI, MSU, or WebView installer)"

  $Pe = Get-PeCompatibility $AppPath
  if ($Pe.Machine -ne 0x8664) { throw "The application is not AMD64 (machine=0x$('{0:X4}' -f $Pe.Machine))." }
  if ($Pe.MajorOs -gt 6 -or ($Pe.MajorOs -eq 6 -and $Pe.MinorOs -gt 1)) {
    throw "PE minimum OS is newer than Windows 7: $($Pe.MajorOs).$($Pe.MinorOs)."
  }
  if ($Pe.MajorSubsystem -gt 6 -or ($Pe.MajorSubsystem -eq 6 -and $Pe.MinorSubsystem -gt 1)) {
    throw "PE subsystem is newer than Windows 7: $($Pe.MajorSubsystem).$($Pe.MinorSubsystem)."
  }
  Add-Report ("PE target: PASS (AMD64, OS " + $Pe.MajorOs + "." + $Pe.MinorOs + ", subsystem " + $Pe.MajorSubsystem + "." + $Pe.MinorSubsystem + ")")

  $RuntimeVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($RuntimeExe).ProductVersion
  if (-not $RuntimeVersion -or -not $RuntimeVersion.StartsWith("109.0.1518.140")) {
    throw "Unexpected fixed WebView2 version: $RuntimeVersion"
  }
  Add-Report ("Fixed WebView2: PASS (" + $RuntimeVersion + ")")
  Add-Report ("Fixed runtime executable: " + $RuntimeExe)

  $Files = Get-ChildItem -LiteralPath $PackageDirectory -Recurse | Where-Object { -not $_.PSIsContainer }
  $TotalBytes = ($Files | Measure-Object -Property Length -Sum).Sum
  Add-Report ("Package inventory: " + $Files.Count + " files, " + [Math]::Round($TotalBytes / 1MB, 1) + " MiB unpacked")

  if (-not $SkipLaunch) {
    $App = $null
    try {
      Add-Report "Launch smoke test: starting Orbit-Copilot.exe..."
      $App = Start-Process -FilePath $AppPath -WorkingDirectory $PackageDirectory -PassThru
      $WindowReady = $false
      for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
        Start-Sleep -Seconds 1
        $App.Refresh()
        if ($App.HasExited) {
          throw "Orbit Copilot exited during startup (exit code $($App.ExitCode))."
        }
        if ($App.MainWindowHandle -ne 0) {
          $WindowReady = $true
          break
        }
      }
      if (-not $WindowReady) { throw "Orbit Copilot did not create a window within 30 seconds." }

      $ExpectedRuntimeRoot = (Resolve-Path -LiteralPath (Join-Path $PackageDirectory "WebView2Runtime")).Path
      $RuntimeProcesses = Get-WmiObject Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($ExpectedRuntimeRoot, [StringComparison]::OrdinalIgnoreCase)
      }
      if (-not $RuntimeProcesses) {
        throw "The app window opened, but no WebView2 process was loaded from the bundled fixed runtime."
      }
      Add-Report ("Launch smoke test: PASS (window handle " + $App.MainWindowHandle + ", bundled WebView2 processes=" + @($RuntimeProcesses).Count + ")")
    } finally {
      if ($App -and -not $App.HasExited) {
        & taskkill.exe /PID $App.Id /T /F | Out-Null
      }
    }
  } else {
    Add-Report "Launch smoke test: SKIPPED by caller"
  }

  Add-Report "RESULT: PASS"
  $Report | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  Write-Host "Portable verification passed: $ReportPath" -ForegroundColor Green
  exit 0
} catch {
  Add-Report ("RESULT: FAIL - " + $_.Exception.Message)
  $Report | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  Write-Error $_
  exit 1
}
