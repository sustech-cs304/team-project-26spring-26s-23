[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DownloadUrl,

  [Parameter(Mandatory = $true)]
  [ValidateSet('zip')]
  [string]$ArchiveKind,

  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,

  [Parameter(Mandatory = $true)]
  [string]$PythonVersion,

  [Parameter(Mandatory = $true)]
  [ValidateSet('x64', 'arm64')]
  [string]$ExpectedArch,

  [Parameter(Mandatory = $true)]
  [string]$PythonVersionFile,

  [Parameter(Mandatory = $true)]
  [string]$PyprojectFile,

  [string]$PythonExecutableRelative = 'python.exe',

  [string]$PythonSourceLabel
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-Version {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  $parts = $Version.Split('.')
  while ($parts.Count -lt 3) {
    $parts += '0'
  }

  return [System.Version]::new(
    [int]$parts[0],
    [int]$parts[1],
    [int]$parts[2]
  )
}

function Assert-OfficialPythonDownloadUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  if (($Url -notlike 'https://www.python.org/ftp/python/*') -and ($Url -notlike 'https://python.org/ftp/python/*')) {
    throw "Python downloads must come from the official python.org FTP release path, received: $Url"
  }
}

function Normalize-Architecture {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Architecture
  )

  $normalizedArchitecture = $Architecture.ToLowerInvariant()
  switch ($normalizedArchitecture) {
    { $_ -in @('x64', 'x86_64', 'amd64') } { return 'x64' }
    { $_ -in @('arm64', 'aarch64') } { return 'arm64' }
    default { return $normalizedArchitecture }
  }
}

function Assert-VersionConstraints {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ActualVersion,
    [Parameter(Mandatory = $true)]
    [string]$PythonVersionFilePath,
    [Parameter(Mandatory = $true)]
    [string]$PyprojectFilePath
  )

  $requiredSeries = (Get-Content -Path $PythonVersionFilePath -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($requiredSeries)) {
    throw "Python version file '$PythonVersionFilePath' is empty."
  }

  if (-not $ActualVersion.StartsWith($requiredSeries, [System.StringComparison]::Ordinal)) {
    throw "Resolved Python version $ActualVersion does not match required series $requiredSeries from $PythonVersionFilePath."
  }

  $pyprojectContent = Get-Content -Path $PyprojectFilePath -Raw
  $minimumMatch = [System.Text.RegularExpressions.Regex]::Match($pyprojectContent, 'requires-python\s*=\s*">=([^\"]+)"')
  if (-not $minimumMatch.Success) {
    throw "Cannot parse requires-python from '$PyprojectFilePath'."
  }

  $minimumVersion = $minimumMatch.Groups[1].Value
  if ((Normalize-Version -Version $ActualVersion) -lt (Normalize-Version -Version $minimumVersion)) {
    throw "Resolved Python version $ActualVersion does not satisfy requires-python >=$minimumVersion from $PyprojectFilePath."
  }
}

function Resolve-PythonRuntimeRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CandidateRoot,
    [Parameter(Mandatory = $true)]
    [string]$ExecutableRelativePath
  )

  $executablePath = Join-Path $CandidateRoot $ExecutableRelativePath
  if (Test-Path -LiteralPath $executablePath) {
    return $CandidateRoot
  }

  $childDirectories = Get-ChildItem -LiteralPath $CandidateRoot -Directory
  if ($childDirectories.Count -eq 1) {
    $childCandidate = $childDirectories[0].FullName
    $childExecutablePath = Join-Path $childCandidate $ExecutableRelativePath
    if (Test-Path -LiteralPath $childExecutablePath) {
      return $childCandidate
    }
  }

  throw "Cannot find Python executable '$ExecutableRelativePath' under extracted archive root '$CandidateRoot'."
}

function Write-StepOutput {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_OUTPUT)) {
    Add-Content -Path $env:GITHUB_OUTPUT -Value "$Key=$Value"
  }
}

Assert-OfficialPythonDownloadUrl -Url $DownloadUrl
$ExpectedArch = Normalize-Architecture -Architecture $ExpectedArch

$archiveName = Split-Path -Path $DownloadUrl -Leaf
if ([string]::IsNullOrWhiteSpace($PythonSourceLabel)) {
  $PythonSourceLabel = "python.org/$archiveName"
}

$installRootPath = [System.IO.Path]::GetFullPath($InstallRoot)
$workRoot = Join-Path $installRootPath 'work'
$runtimeRoot = Join-Path $installRootPath 'python-runtime'
$archivePath = Join-Path $workRoot $archiveName

if (Test-Path -LiteralPath $installRootPath) {
  Remove-Item -LiteralPath $installRootPath -Recurse -Force
}

New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

Write-Host "[python-download] Downloading official Python archive: $DownloadUrl"
Invoke-WebRequest -Uri $DownloadUrl -OutFile $archivePath

switch ($ArchiveKind) {
  'zip' {
    Write-Host '[python-download] Extracting Python zip archive.'
    Expand-Archive -Path $archivePath -DestinationPath $runtimeRoot -Force
  }
  default {
    throw "Unsupported archive kind: $ArchiveKind"
  }
}

$resolvedRuntimeRoot = Resolve-PythonRuntimeRoot -CandidateRoot $runtimeRoot -ExecutableRelativePath $PythonExecutableRelative
$pythonExecutablePath = Join-Path $resolvedRuntimeRoot $PythonExecutableRelative

$versionOutput = & $pythonExecutablePath --version 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  throw "Failed to execute '$pythonExecutablePath --version' (exit code $exitCode): $versionOutput"
}

$actualVersion = (($versionOutput | Select-Object -First 1) -replace '^Python\s+', '').Trim()
$actualArchitectureOutput = & $pythonExecutablePath -c 'import platform; print(platform.machine())' 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  throw "Failed to inspect Python architecture with '$pythonExecutablePath' (exit code $exitCode): $actualArchitectureOutput"
}

$actualArch = Normalize-Architecture -Architecture (($actualArchitectureOutput | Select-Object -First 1).Trim())
Assert-VersionConstraints -ActualVersion $actualVersion -PythonVersionFilePath $PythonVersionFile -PyprojectFilePath $PyprojectFile

if ($actualArch -ne $ExpectedArch) {
  throw "Resolved Python architecture $actualArch does not match expected architecture $ExpectedArch."
}

Write-Host "[python-download] Python directory: $resolvedRuntimeRoot"
Write-Host "[python-download] Python executable relative path: $PythonExecutableRelative"
Write-Host "[python-download] Python version: $actualVersion"
Write-Host "[python-download] Python architecture: $actualArch"
Write-Host "[python-download] Python source label: $PythonSourceLabel"

Write-StepOutput -Key 'python_dir' -Value $resolvedRuntimeRoot
Write-StepOutput -Key 'python_executable_relative' -Value $PythonExecutableRelative
Write-StepOutput -Key 'python_version' -Value $actualVersion
Write-StepOutput -Key 'python_arch' -Value $actualArch
Write-StepOutput -Key 'python_source_label' -Value $PythonSourceLabel
