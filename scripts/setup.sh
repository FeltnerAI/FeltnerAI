#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

missing=0
warnings=0

ok() {
  printf '  ok   %s\n' "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf '  warn %s\n' "$1" >&2
}

fail() {
  missing=$((missing + 1))
  printf '  miss %s\n' "$1" >&2
}

require_cmd() {
  local name="$1"
  local hint="$2"
  if command -v "$name" >/dev/null 2>&1; then
    ok "$name ($(command -v "$name"))"
  else
    fail "$name not found — $hint"
  fi
}

version_ge() {
  local current="$1"
  local required="$2"
  local IFS=.
  read -r -a cur <<<"$current"
  read -r -a req <<<"$required"
  local i
  for i in 0 1 2; do
    local c="${cur[$i]:-0}"
    local r="${req[$i]:-0}"
    if ((10#$c > 10#$r)); then
      return 0
    fi
    if ((10#$c < 10#$r)); then
      return 1
    fi
  done
  return 0
}

check_rust() {
  if ! command -v rustc >/dev/null 2>&1; then
    fail "rustc not found — install Rust 1.96+ from https://rustup.rs"
    return
  fi
  if ! command -v cargo >/dev/null 2>&1; then
    fail "cargo not found — install Rust 1.96+ from https://rustup.rs"
    return
  fi

  local version
  version="$(rustc --version | awk '{print $2}')"
  if version_ge "$version" "1.96.0"; then
    ok "rustc $version"
    ok "cargo $(cargo --version | awk '{print $2}')"
  else
    fail "rustc $version is older than required 1.96.0 — run: rustup update stable"
  fi
}

check_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    fail "bun not found — install Bun 1.3+ from https://bun.sh"
    return
  fi

  local version
  version="$(bun --version)"
  if version_ge "$version" "1.3.0"; then
    ok "bun $version"
  else
    fail "bun $version is older than required 1.3.0 — run: bun upgrade"
  fi
}

check_pkg_config_module() {
  local module="$1"
  local package="$2"
  if pkg-config --exists "$module" 2>/dev/null; then
    ok "pkg-config $module"
  else
    fail "pkg-config $module not found — install $package"
  fi
}

linux_portal_hint() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}${ID_LIKE:-}" in
      *debian* | *ubuntu*)
        cat <<'EOF'
Install Tauri Linux dependencies (Debian/Ubuntu):
  sudo apt update
  sudo apt install -y \
    build-essential curl wget file pkg-config libssl-dev \
    libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
    librsvg2-dev libxdo-dev
EOF
        ;;
      *fedora* | *rhel* | *centos*)
        cat <<'EOF'
Install Tauri Linux dependencies (Fedora/RHEL):
  sudo dnf install -y \
    gcc gcc-c++ make pkg-config openssl-devel gtk3-devel \
    webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel
EOF
        ;;
      *arch* | *manjaro*)
        cat <<'EOF'
Install Tauri Linux dependencies (Arch):
  sudo pacman -S --needed \
    base-devel curl wget file pkgconf openssl gtk3 webkit2gtk-4.1 \
    libappindicator-gtk3 librsvg
EOF
        ;;
      *opensuse* | *suse*)
        cat <<'EOF'
Install Tauri Linux dependencies (openSUSE):
  sudo zypper install -y \
    gcc gcc-c++ make pkg-config libopenssl-devel gtk3-devel \
    webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg-devel
EOF
        ;;
      *)
        cat <<'EOF'
Install Tauri Linux dependencies for your distro.
See https://v2.tauri.app/start/prerequisites/#linux
Packages typically needed: GTK 3, WebKit2GTK 4.1, OpenSSL, AppIndicator, librsvg, build tools, pkg-config.
EOF
        ;;
    esac
  else
    warn "Could not detect Linux distribution; see https://v2.tauri.app/start/prerequisites/#linux"
  fi
}

check_linux_portal_deps() {
  printf '\nPortal build prerequisites (Linux):\n'
  if ! command -v pkg-config >/dev/null 2>&1; then
    fail "pkg-config not found — install pkg-config for your distribution"
    linux_portal_hint
    return
  fi
  ok "pkg-config ($(command -v pkg-config))"

  local had_missing=$missing
  check_pkg_config_module "gdk-3.0" "libgtk-3-dev (Debian/Ubuntu) or gtk3-devel"
  check_pkg_config_module "gtk+-3.0" "libgtk-3-dev (Debian/Ubuntu) or gtk3-devel"
  check_pkg_config_module "webkit2gtk-4.1" "libwebkit2gtk-4.1-dev"
  check_pkg_config_module "javascriptcoregtk-4.1" "libjavascriptcoregtk-4.1-dev (often bundled with WebKit packages)"
  check_pkg_config_module "libsoup-3.0" "libsoup-3.0-dev"
  check_pkg_config_module "openssl" "libssl-dev"

  if ((missing > had_missing)); then
    printf '\n'
    linux_portal_hint
  fi
}

check_macos_portal_deps() {
  printf '\nPortal build prerequisites (macOS):\n'
  if xcode-select -p >/dev/null 2>&1; then
    ok "Xcode Command Line Tools ($(xcode-select -p))"
  else
    fail "Xcode Command Line Tools not found — run: xcode-select --install"
  fi
}

printf 'Checking system tools...\n'
require_cmd just "install from https://github.com/casey/just#installation"
check_rust
check_bun

case "$(uname -s)" in
  Linux)
    check_linux_portal_deps
    ;;
  Darwin)
    check_macos_portal_deps
    ;;
  *)
    warn "Unknown Unix platform for Portal checks; install Tauri prerequisites manually if building the Portal."
    ;;
esac

printf '\nInstalling project dependencies...\n'
if command -v bun >/dev/null 2>&1; then
  bun install --cwd frontend
  ok "frontend packages installed"
else
  warn "Skipped frontend install because bun is missing"
fi

if command -v cargo >/dev/null 2>&1; then
  cargo fetch
  ok "Rust crate sources fetched"
else
  warn "Skipped cargo fetch because cargo is missing"
fi

printf '\nSummary:\n'
if ((missing > 0)); then
  printf '  %d required system prerequisite(s) missing.\n' "$missing" >&2
  printf '  Fix the items above, then run: just setup\n' >&2
  exit 1
fi

if ((warnings > 0)); then
  printf '  Setup finished with %d warning(s).\n' "$warnings"
else
  printf '  Setup complete. Try: just server (terminal 1) and just dev (terminal 2).\n'
fi
