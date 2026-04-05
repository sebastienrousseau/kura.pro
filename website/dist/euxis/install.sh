#!/usr/bin/env bash
set -euo pipefail

VERSION="1.2.0"
BASE_URL="https://cloudcdn.pro/dist/euxis"
INSTALL_DIR="$HOME/.local/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${BOLD}%s${RESET}\n" "$*"; }
warn()  { printf "${YELLOW}warning:${RESET} %s\n" "$*"; }
error() { printf "${RED}error:${RESET} %s\n" "$*" >&2; exit 1; }

# --- Detect OS ---
detect_os() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux)
      if [ -f /proc/version ] && grep -qi 'microsoft\|wsl' /proc/version; then
        echo "linux"  # WSL is still a Linux binary
      else
        echo "linux"
      fi
      ;;
    *) error "Unsupported operating system: $(uname -s)" ;;
  esac
}

# --- Detect architecture ---
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)   echo "x64" ;;
    arm64|aarch64)   echo "arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
  esac
}

# --- Checksum verification ---
verify_checksum() {
  local file="$1" expected="$2" os="$3"
  if [ "$os" = "darwin" ]; then
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  else
    actual=$(sha256sum "$file" | awk '{print $1}')
  fi

  if [ "$actual" != "$expected" ]; then
    error "Checksum mismatch!\n  expected: ${expected}\n  actual:   ${actual}"
  fi
}

# --- Main ---
main() {
  local os arch filename checksum_file tmp_dir expected_sum

  os=$(detect_os)
  arch=$(detect_arch)
  filename="euxis-${VERSION}-${os}-${arch}.tar.gz"

  info "Installing euxis v${VERSION} (${os}-${arch})..."

  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  # Download binary and checksum
  info "Downloading ${filename}..."
  curl -fsSL "${BASE_URL}/${filename}" -o "${tmp_dir}/${filename}" \
    || error "Failed to download ${BASE_URL}/${filename}"

  info "Downloading checksum..."
  curl -fsSL "${BASE_URL}/${filename}.sha256" -o "${tmp_dir}/${filename}.sha256" \
    || error "Failed to download checksum file"

  # Verify checksum
  expected_sum=$(awk '{print $1}' "${tmp_dir}/${filename}.sha256")
  info "Verifying SHA-256 checksum..."
  verify_checksum "${tmp_dir}/${filename}" "$expected_sum" "$os"

  # Extract
  mkdir -p "$INSTALL_DIR"
  info "Extracting to ${INSTALL_DIR}..."
  tar -xzf "${tmp_dir}/${filename}" -C "$INSTALL_DIR"

  printf "\n${GREEN}${BOLD}euxis v${VERSION}${RESET} installed to ${BOLD}${INSTALL_DIR}/euxis${RESET}\n"

  # PATH hint
  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    warn "${INSTALL_DIR} is not in your PATH. Add it with:"
    printf "  export PATH=\"%s:\$PATH\"\n" "$INSTALL_DIR"
  fi
}

main
