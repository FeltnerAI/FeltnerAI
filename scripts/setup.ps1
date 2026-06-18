$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$missing = 0
$warnings = 0

function Write-Ok($message) {
  Write-Host "  ok   $message"
}

function Write-Warn($message) {
  $script:warnings++
  Write-Warning "  warn $message"
}

function Write-Miss($message) {
  $script:missing++
  Write-Host "  miss $message" -ForegroundColor Red
}

function Test-VersionGe {
  param(
    [string]$Current,
    [string]$Required
  )

  $cur = $Current.Split(".") | ForEach-Object { [int]$_ }
  $req = $Required.Split(".") | ForEach-Object { [int]$_ }
  for ($i = 0; $i -lt 3; $i++) {
    $c = if ($i -lt $cur.Count) { $cur[$i] } else { 0 }
    $r = if ($i -lt $req.Count) { $req[$i] } else { 0 }
    if ($c -gt $r) { return $true }
    if ($c -lt $r) { return $false }
  }
  return $true
}

function Test-Command {
  param(
    [string]$Name,
    [string]$Hint
  )

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -ne $cmd) {
    Write-Ok "$Name ($($cmd.Source))"
    return $true
  }

  Write-Miss "$Name not found - $Hint"
  return $false
}

function Test-Rust {
  if (-not (Test-Command "rustc" "install Rust 1.96+ from https://rustup.rs")) {
    return
  }
  if (-not (Test-Command "cargo" "install Rust 1.96+ from https://rustup.rs")) {
    return
  }

  $version = (rustc --version).Split(" ")[1]
  if (Test-VersionGe $version "1.96.0") {
    Write-Ok "rustc $version"
    Write-Ok "cargo $((cargo --version).Split(' ')[1])"
  } else {
    Write-Miss "rustc $version is older than required 1.96.0 - run: rustup update stable"
  }
}

function Test-Bun {
  if (-not (Test-Command "bun" "install Bun 1.3+ from https://bun.sh")) {
    return
  }

  $version = bun --version
  if (Test-VersionGe $version "1.3.0") {
    Write-Ok "bun $version"
  } else {
    Write-Miss "bun $version is older than required 1.3.0 - run: bun upgrade"
  }
}

function Test-PortalDeps {
  Write-Host ""
  Write-Host "Portal build prerequisites (Windows):"

  $webviewKey = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  if (Test-Path $webviewKey) {
    Write-Ok "Microsoft Edge WebView2 Runtime"
  } else {
    Write-Miss "Microsoft Edge WebView2 Runtime not found - install the Evergreen Bootstrapper from https://developer.microsoft.com/microsoft-edge/webview2/"
  }

  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $msvc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($msvc) {
      Write-Ok "Microsoft C++ Build Tools ($msvc)"
    } else {
      Write-Miss "Microsoft C++ Build Tools not found - install Visual Studio Build Tools with Desktop development with C++"
    }
  } else {
    Write-Warn "vswhere not found; could not verify Microsoft C++ Build Tools"
    Write-Host "  hint Install Visual Studio Build Tools with Desktop development with C++ if Portal builds fail."
  }
}

Write-Host "Checking system tools..."
Test-Command "just" "install from https://github.com/casey/just#installation" | Out-Null
Test-Rust
Test-Bun
Test-PortalDeps

Write-Host ""
Write-Host "Installing project dependencies..."
if (Get-Command bun -ErrorAction SilentlyContinue) {
  bun install --cwd frontend
  if ($LASTEXITCODE -ne 0) { throw "bun install failed" }
  bun run --cwd frontend playwright:install
  if ($LASTEXITCODE -ne 0) { throw "playwright install failed" }
  Write-Ok "frontend npm packages and Playwright Chromium"
} else {
  Write-Warn "Skipped frontend install because bun is missing"
}

if (Get-Command cargo -ErrorAction SilentlyContinue) {
  cargo fetch
  if ($LASTEXITCODE -ne 0) { throw "cargo fetch failed" }
  Write-Ok "Rust crate sources fetched"
} else {
  Write-Warn "Skipped cargo fetch because cargo is missing"
}

Write-Host ""
Write-Host "Summary:"
if ($missing -gt 0) {
  Write-Host "  $missing required system prerequisite(s) missing." -ForegroundColor Red
  Write-Host "  Fix the items above, then run: just setup"
  exit 1
}

if ($warnings -gt 0) {
  Write-Host "  Setup finished with $warnings warning(s)."
} else {
  Write-Host "  Setup complete. Try: just server (terminal 1) and just dev (terminal 2)."
}
