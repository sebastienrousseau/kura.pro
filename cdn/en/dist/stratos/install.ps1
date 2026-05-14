# =============================================================================
# Stratos installer (Windows / PowerShell) — production-grade.
#
# Hardening:
#   - Get-FileHash for SHA-256 verification (no manual string comparison)
#   - Invoke-WebRequest with -MaximumRetryCount and -RetryIntervalSec
#   - try/finally cleanup on partial-install failure
#   - Runtime-relative shim path so the install tree is relocatable
#
# Usage:
#   irm https://cloudcdn.pro/dist/stratos/install.ps1 | iex
#
# Override install location:
#   $env:STRATOS_PREFIX = "C:\Tools\stratos"
#   irm https://cloudcdn.pro/dist/stratos/install.ps1 | iex
# =============================================================================

$ErrorActionPreference = 'Stop'

# --- Configuration ---
$CdnBase = if ($env:CLOUDCDN_URL) { $env:CLOUDCDN_URL } else { 'https://cloudcdn.pro' }
$Source  = "$CdnBase/dist/stratos/stratos.mjs"
# Expected SHA-256 of stratos.mjs as delivered. Matches the source file
# in git verbatim — Invoke-WebRequest -OutFile writes the response body
# byte-for-byte. Bumped on each release.
$ExpectedSha = '98306c394345fc18b8610c0113e6ef94f071ceba47de0f07eb45a9204effaf27'
$Version = '0.1.0'

function Log-Info    ($m) { Write-Host "info: $m"    -ForegroundColor Blue }
function Log-Success ($m) { Write-Host "success: $m" -ForegroundColor Green }
function Log-Error   ($m) { Write-Host "error: $m"   -ForegroundColor Red }

# --- Pre-flight: Node ≥ 18 ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Log-Error 'Node ≥ 18 is required and was not found on PATH. Install from https://nodejs.org and retry.'
  exit 1
}
$nodeMajor = (& node -v).TrimStart('v').Split('.')[0]
if ([int]$nodeMajor -lt 18) {
  Log-Error "Node ≥ 18 required (built-in fetch + crypto.subtle); detected v$nodeMajor."
  exit 1
}

# --- Install prefix resolution ---
$Prefix = if ($env:STRATOS_PREFIX) {
  $env:STRATOS_PREFIX
} else {
  Join-Path $env:LocalAppData 'Programs\stratos'
}
$LibDir = Join-Path $Prefix 'lib'
New-Item -ItemType Directory -Force -Path $LibDir | Out-Null

# --- Download with retry/timeout ---
$Tmp = [System.IO.Path]::GetTempFileName()
try {
  Log-Info "Fetching Stratos v$Version from $Source ..."
  Invoke-WebRequest -UseBasicParsing -Uri $Source -OutFile $Tmp `
    -MaximumRetryCount 3 -RetryIntervalSec 2 -TimeoutSec 30

  # --- Native SHA-256 verification ---
  Log-Info 'Verifying SHA-256 of payload ...'
  $Got = (Get-FileHash -Algorithm SHA256 $Tmp).Hash.ToLower()
  if ($Got -ne $ExpectedSha.ToLower()) {
    Log-Error "SHA-256 mismatch.`n  expected: $ExpectedSha`n  got:      $Got"
    exit 1
  }

  # --- Atomic install ---
  Move-Item -Force $Tmp (Join-Path $LibDir 'stratos.mjs')
}
catch {
  Log-Error "Install failed: $($_.Exception.Message)"
  exit 1
}
finally {
  if (Test-Path $Tmp) { Remove-Item -Force $Tmp -ErrorAction SilentlyContinue }
}

# Shim uses a runtime-relative path — relocatable install tree.
$Shim = Join-Path $Prefix 'stratos.cmd'
@'
@echo off
setlocal
set "STRATOS_LIB=%~dp0lib"
where node >nul 2>nul || (echo stratos: node is required at runtime but was not found on PATH.>&2 & exit /b 1)
node "%STRATOS_LIB%\stratos.mjs" %*
'@ | Set-Content -Encoding ASCII -Path $Shim

Log-Success "Stratos v$Version installed at $Shim"

# Append to user PATH if not already there.
$userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $Prefix })) {
  [System.Environment]::SetEnvironmentVariable('Path', "$userPath;$Prefix", 'User')
  Log-Info "Added $Prefix to your User PATH. Open a new shell to pick it up."
}

Log-Info 'Try: stratos version  /  stratos help  (in a new shell)'
