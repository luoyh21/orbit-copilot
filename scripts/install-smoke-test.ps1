[CmdletBinding()]
param(
  [string]$InstallerPath,
  [string]$ReleaseRepo = "luoyh21/orbit-copilot",
  [string]$ExpectedSha256,
  [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$DownloadedFromRelease = [string]::IsNullOrWhiteSpace($InstallerPath)
if ($DownloadedFromRelease) {
  $Desktop = [Environment]::GetFolderPath("Desktop")
  if ([string]::IsNullOrWhiteSpace($Desktop)) {
    throw "Windows Desktop directory could not be resolved."
  }
  New-Item -ItemType Directory -Path $Desktop -Force | Out-Null

  $Headers = @{
    Accept = "application/vnd.github+json"
    "User-Agent" = "orbit-copilot-install-smoke-test"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
  Write-Host "Resolving the latest release from $ReleaseRepo..."
  $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$ReleaseRepo/releases/latest" -Headers $Headers
  $Asset = $Release.assets |
    Where-Object { $_.name -match "(?i)setup\.exe$" } |
    Select-Object -First 1
  if (-not $Asset) {
    throw "The latest release does not contain a Windows setup.exe asset."
  }

  $InstallerPath = Join-Path $Desktop $Asset.name
  Write-Host "Downloading $($Asset.browser_download_url) to $InstallerPath..."
  Invoke-WebRequest -Uri $Asset.browser_download_url -Headers $Headers -OutFile $InstallerPath

  if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) {
    if ($Asset.digest -notmatch "^sha256:(?<hash>[0-9a-fA-F]{64})$") {
      throw "GitHub did not return a SHA-256 digest for the release asset."
    }
    $ExpectedSha256 = $Matches.hash
  }
}

$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$ActualSha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
  $NormalizedExpected = $ExpectedSha256.Trim().ToLowerInvariant()
  if ($ActualSha256 -ne $NormalizedExpected) {
    throw "SHA-256 mismatch. Expected $NormalizedExpected but got $ActualSha256."
  }
}
Write-Host "SHA-256 verified: $ActualSha256" -ForegroundColor Green

$Signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
Write-Host "Authenticode status: $($Signature.Status)"

Write-Host "Installing for the current user..."
$Installer = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -PassThru
if ($Installer.ExitCode -ne 0) {
  throw "Installer exited with code $($Installer.ExitCode)."
}

function Find-OrbitCopilotExecutable {
  $RegistryPaths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  foreach ($RegistryPath in $RegistryPaths) {
    $Entries = Get-ItemProperty $RegistryPath -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match "(?i)Orbit Copilot|轨道智枢" } |
      Sort-Object DisplayVersion -Descending
    foreach ($Entry in $Entries) {
      if (-not [string]::IsNullOrWhiteSpace($Entry.DisplayIcon)) {
        $IconPath = ($Entry.DisplayIcon -replace ",\d+$", "").Trim('"')
        if ((Test-Path -LiteralPath $IconPath) -and $IconPath -match "(?i)\.exe$") {
          return (Resolve-Path -LiteralPath $IconPath).Path
        }
      }
      if (-not [string]::IsNullOrWhiteSpace($Entry.InstallLocation) -and
          (Test-Path -LiteralPath $Entry.InstallLocation)) {
        $Candidate = Get-ChildItem -LiteralPath $Entry.InstallLocation -Filter "*.exe" -File |
          Where-Object { $_.Name -notmatch "(?i)uninstall|unins" } |
          Select-Object -First 1
        if ($Candidate) {
          return $Candidate.FullName
        }
      }
    }
  }

  $KnownCandidates = @(
    (Join-Path $env:LOCALAPPDATA "轨道智枢 Orbit Copilot\轨道智枢 Orbit Copilot.exe"),
    (Join-Path $env:LOCALAPPDATA "Orbit Copilot\Orbit Copilot.exe"),
    (Join-Path $env:LOCALAPPDATA "orbit-copilot\orbit-copilot.exe")
  )
  foreach ($Candidate in $KnownCandidates) {
    if (Test-Path -LiteralPath $Candidate) {
      return (Resolve-Path -LiteralPath $Candidate).Path
    }
  }
  return $null
}

$AppPath = Find-OrbitCopilotExecutable
if ([string]::IsNullOrWhiteSpace($AppPath)) {
  throw "Installation finished, but the Orbit Copilot executable could not be located."
}

Write-Host "Launching $AppPath..."
$App = Start-Process -FilePath $AppPath -PassThru
Start-Sleep -Seconds 10
$App.Refresh()
if ($App.HasExited) {
  throw "Orbit Copilot exited during its 10-second launch smoke test (exit code $($App.ExitCode))."
}

$Result = [ordered]@{
  installer = $InstallerPath
  sha256 = $ActualSha256
  signatureStatus = $Signature.Status.ToString()
  executable = $AppPath
  processId = $App.Id
  launchSmokeTest = "passed"
}

if ($KeepRunning) {
  Write-Host "Orbit Copilot is running (PID $($App.Id))." -ForegroundColor Green
} else {
  Stop-Process -Id $App.Id -Force
  $Result.processStoppedAfterTest = $true
  Write-Host "Launch test passed; the test process was stopped." -ForegroundColor Green
}

$Result | ConvertTo-Json
