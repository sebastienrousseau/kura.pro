# Stratos installer for Windows (PowerShell).
#
# Downloads stratos.mjs from https://cloudcdn.pro/dist/stratos/, writes a
# wrapper `stratos.cmd` to %LocalAppData%\Programs\stratos that execs
# `node <path-to-stratos.mjs>` with whatever args you pass.
#
#   irm https://cloudcdn.pro/dist/stratos/install.ps1 | iex
#
# Requires Node >= 18 on PATH. Refuses to install otherwise.

$ErrorActionPreference = 'Stop'

$CdnBase = if ($env:CLOUDCDN_URL) { $env:CLOUDCDN_URL } else { 'https://cloudcdn.pro' }
$Source = "$CdnBase/dist/stratos/stratos.mjs"
# Expected SHA-256 of stratos.mjs as served by https://cloudcdn.pro/dist/
# stratos/stratos.mjs. Cloudflare Pages appends a trailing newline on
# delivery, so this hash is taken from the *delivered* bytes, not the
# source file in git. Bumped on each release.
$ExpectedSha = '85aeca2967183e827ffb1e17c53f132bc14b8cd3c8c0a28532059fb1a6a7114e'
$Version = '0.1.0'

# Pre-flight: Node must be on PATH and >= 18.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "stratos install: Node.js >= 18 is required and was not found on PATH. Install from https://nodejs.org and retry."
  exit 1
}
$nodeMajor = (& node -e 'process.stdout.write(String(process.versions.node).split(".")[0])')
if ([int]$nodeMajor -lt 18) {
  Write-Error "stratos install: Node $nodeMajor detected; Stratos needs Node >= 18 (for built-in fetch and crypto.subtle)."
  exit 1
}

$Prefix = if ($env:STRATOS_PREFIX) { $env:STRATOS_PREFIX } else { Join-Path $env:LocalAppData 'Programs\stratos' }
$LibDir = Join-Path $Prefix 'lib'
New-Item -ItemType Directory -Force -Path $LibDir | Out-Null

$Tmp = [System.IO.Path]::GetTempFileName()
try {
  Write-Host "stratos install: fetching $Source ..."
  Invoke-WebRequest -UseBasicParsing -Uri $Source -OutFile $Tmp

  # Integrity check — refuses to install if the download doesn't match.
  $Got = (Get-FileHash -Algorithm SHA256 $Tmp).Hash.ToLower()
  if ($Got -ne $ExpectedSha.ToLower()) {
    Write-Error "stratos install: SHA-256 mismatch.`n  expected: $ExpectedSha`n  got:      $Got"
    exit 1
  }

  Move-Item -Force $Tmp (Join-Path $LibDir 'stratos.mjs')
} finally {
  if (Test-Path $Tmp) { Remove-Item -Force $Tmp }
}

$Shim = Join-Path $Prefix 'stratos.cmd'
@"
@echo off
node "$LibDir\stratos.mjs" %*
"@ | Set-Content -Encoding ASCII -Path $Shim

Write-Host "stratos install: installed v$Version at $Shim"

# Append $Prefix to user PATH if not already there.
$userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $Prefix })) {
  [System.Environment]::SetEnvironmentVariable('Path', "$userPath;$Prefix", 'User')
  Write-Host "stratos install: added $Prefix to your User PATH. Open a new shell to pick it up."
}

Write-Host "stratos install: try 'stratos version' or 'stratos help' (new shell)."
