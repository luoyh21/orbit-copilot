$ErrorActionPreference = "Stop"

$BundleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SsuName = "windows6.1-kb4490628-x64.msu"
$Sha2Name = "windows6.1-kb4474419-v3-x64.msu"
$RuntimeName = "MicrosoftEdgeWebView2Runtime-109.0.1518.140-x64.exe"
$SsuPath = Join-Path $BundleRoot $SsuName
$Sha2Path = Join-Path $BundleRoot $Sha2Name
$RuntimePath = Join-Path $BundleRoot $RuntimeName
$ChecksumPath = Join-Path $BundleRoot "SHA256SUMS.txt"
$AppInstaller = Get-ChildItem -Path $BundleRoot -Filter "Orbit-Copilot-Win7-*-setup.exe" |
  Select-Object -First 1

function Get-Sha256([string]$Path) {
  $Stream = [System.IO.File]::OpenRead($Path)
  try {
    $Sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($Sha256.ComputeHash($Stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $Sha256.Dispose()
    }
  } finally {
    $Stream.Dispose()
  }
}

function Get-ExpectedHashes([string]$Path) {
  $Hashes = @{}
  foreach ($Line in Get-Content -Path $Path) {
    if ($Line -match "^([0-9a-fA-F]{64})[ ]+[*]?(.+)$") {
      $Hashes[$Matches[2].Trim()] = $Matches[1].ToLowerInvariant()
    }
  }
  return $Hashes
}

function Get-WebView2Version {
  $ClientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  $Paths = @(
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$ClientId",
    "HKLM:\Software\Microsoft\EdgeUpdate\Clients\$ClientId",
    "HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\$ClientId"
  )
  foreach ($Path in $Paths) {
    $Value = Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue
    if ($Value -and $Value.pv) {
      return [string]$Value.pv
    }
  }
  return $null
}

function Test-HotFix([string]$Id) {
  return [bool](Get-HotFix -Id $Id -ErrorAction SilentlyContinue)
}

function Install-WindowsUpdate([string]$Id, [string]$Path) {
  if (Test-HotFix $Id) {
    Write-Host "$Id is already installed."
    return $false
  }
  Write-Host "Installing required Windows update $Id..."
  $Process = Start-Process -FilePath (Join-Path $env:WINDIR "System32\wusa.exe") -ArgumentList ('"' + $Path + '"'), "/quiet", "/norestart" -Wait -PassThru
  if ($Process.ExitCode -eq 3010) {
    return $true
  }
  # 0x80240017 means the update is not applicable, normally because a newer
  # servicing-stack or SHA-2 update supersedes this exact package.
  if ($Process.ExitCode -ne 0 -and $Process.ExitCode -ne -2145124329) {
    throw "$Id installer exited with code $($Process.ExitCode)."
  }
  return $false
}

function Find-OrbitCopilotExecutable {
  $RegistryPaths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  foreach ($RegistryPath in $RegistryPaths) {
    $Entries = Get-ItemProperty $RegistryPath -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match "Orbit Copilot" }
    foreach ($Entry in $Entries) {
      if ($Entry.DisplayIcon) {
        $IconPath = ([string]$Entry.DisplayIcon -replace ",\d+$", "").Trim('"')
        if (Test-Path -LiteralPath $IconPath) {
          return $IconPath
        }
      }
      if ($Entry.InstallLocation -and (Test-Path -LiteralPath $Entry.InstallLocation)) {
        $Candidate = Get-ChildItem -Path $Entry.InstallLocation -Filter "orbit-copilot.exe" |
          Select-Object -First 1
        if ($Candidate) {
          return $Candidate.FullName
        }
      }
    }
  }
  return $null
}

$Os = Get-WmiObject -Class Win32_OperatingSystem
if ($Os.Version -notmatch "^6\.1\.") {
  throw "This legacy package is only for Windows 7 SP1. Use the normal installer on Windows 10/11."
}
if ([int]$Os.ServicePackMajorVersion -lt 1) {
  throw "Windows 7 Service Pack 1 is required. Install SP1 before Orbit Copilot."
}
$Cpu = Get-WmiObject -Class Win32_Processor | Select-Object -First 1
if ([int]$Cpu.AddressWidth -ne 64) {
  throw "This package requires 64-bit Windows 7."
}
foreach ($RequiredPath in @($SsuPath, $Sha2Path, $RuntimePath)) {
  if (-not (Test-Path -LiteralPath $RequiredPath)) {
    throw "Missing $(Split-Path -Leaf $RequiredPath). Extract the complete package before running the installer."
  }
}
if (-not $AppInstaller) {
  throw "Orbit Copilot Win7 installer is missing. Extract the complete ZIP before running the installer."
}
if (-not (Test-Path -LiteralPath $ChecksumPath)) {
  throw "SHA256SUMS.txt is missing. Installation was stopped for safety."
}

$Expected = Get-ExpectedHashes $ChecksumPath
foreach ($File in @((Get-Item -LiteralPath $SsuPath), (Get-Item -LiteralPath $Sha2Path), (Get-Item -LiteralPath $RuntimePath), $AppInstaller)) {
  if (-not $Expected.ContainsKey($File.Name)) {
    throw "No SHA-256 entry exists for $($File.Name)."
  }
  Write-Host "Verifying $($File.Name)..."
  $Actual = Get-Sha256 $File.FullName
  if ($Actual -ne $Expected[$File.Name]) {
    throw "SHA-256 mismatch for $($File.Name). Expected $($Expected[$File.Name]), got $Actual."
  }
}
Write-Host "All SHA-256 checks passed." -ForegroundColor Green

$NeedsReboot = Install-WindowsUpdate "KB4490628" $SsuPath
if (Install-WindowsUpdate "KB4474419" $Sha2Path) {
  $NeedsReboot = $true
}
if ($NeedsReboot) {
  throw "Required Windows updates were installed. Restart Windows, then run this installer again."
}

$ExistingVersion = Get-WebView2Version
if (-not $ExistingVersion -or $ExistingVersion -notmatch "^109\.") {
  Write-Host "Installing Microsoft WebView2 Runtime 109 for Windows 7..."
  $RuntimeProcess = Start-Process -FilePath $RuntimePath -ArgumentList "/silent", "/install" -Wait -PassThru
  if ($RuntimeProcess.ExitCode -ne 0 -and $RuntimeProcess.ExitCode -ne 3010) {
    throw "WebView2 Runtime installer exited with code $($RuntimeProcess.ExitCode)."
  }
  Start-Sleep -Seconds 3
}

$InstalledVersion = Get-WebView2Version
if (-not $InstalledVersion -or $InstalledVersion -notmatch "^109\.") {
  throw "WebView2 Runtime 109 was not detected after installation. Restart Windows and run install-win7-offline.cmd again."
}
Write-Host "WebView2 Runtime detected: $InstalledVersion" -ForegroundColor Green

Write-Host "Installing Orbit Copilot for the current user..."
$AppProcess = Start-Process -FilePath $AppInstaller.FullName -ArgumentList "/S" -Wait -PassThru
if ($AppProcess.ExitCode -ne 0) {
  throw "Orbit Copilot installer exited with code $($AppProcess.ExitCode)."
}

$AppPath = Find-OrbitCopilotExecutable
if (-not $AppPath) {
  throw "Orbit Copilot was installed, but orbit-copilot.exe could not be located."
}
Start-Process -FilePath $AppPath | Out-Null
Write-Host "Orbit Copilot was installed and started successfully." -ForegroundColor Green
