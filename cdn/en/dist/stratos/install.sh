#!/usr/bin/env bash
# ==============================================================================
# Stratos installer (macOS / Linux) — production-grade.
#
# Hardening:
#   - native sha256sum -c / shasum -c --status (no manual hash-string compare)
#   - curl --connect-timeout 10 --retry 3 (survives flaky networks)
#   - install(1) for the binary drop (atomic on the same filesystem)
#   - relative-path shim ($(dirname "$0")/../lib/stratos) so users can
#     relocate the bin/lib pair without breaking
#
# Usage:
#   curl -sL https://cloudcdn.pro/dist/stratos/install.sh | bash
#
# Override install location:
#   curl -sL https://cloudcdn.pro/dist/stratos/install.sh | STRATOS_PREFIX=$HOME/bin bash
# ==============================================================================

set -euo pipefail

# --- Configuration ---
CDN_BASE="${CLOUDCDN_URL:-https://cloudcdn.pro}"
SOURCE="$CDN_BASE/dist/stratos/stratos.mjs"
# Expected SHA-256 of stratos.mjs as delivered. Matches the source file
# in git verbatim — `curl -o` (used below) writes the response body
# byte-for-byte. Bumped on each release.
EXPECTED_SHA="98306c394345fc18b8610c0113e6ef94f071ceba47de0f07eb45a9204effaf27"
VERSION="0.1.0"

# --- Styling ---
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; BLUE=''; NC=''
fi
log_info()    { printf "%sinfo:%s %s\n"    "$BLUE"  "$NC" "$1"; }
log_success() { printf "%ssuccess:%s %s\n" "$GREEN" "$NC" "$1"; }
log_error()   { printf "%serror:%s %s\n"   "$RED"   "$NC" "$1" >&2; }

# --- Pre-flight: dependencies ---
check_dep() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "'$1' is required but not found on PATH. Install it and re-run."
    exit 1
  fi
}
check_dep curl
check_dep node

# Node ≥ 18 (built-in fetch + crypto.subtle).
NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  log_error "Node ≥ 18 required (built-in fetch + crypto.subtle); detected v$NODE_MAJOR."
  exit 1
fi

# --- Install prefix resolution ---
if [ -n "${STRATOS_PREFIX:-}" ]; then
  PREFIX="$STRATOS_PREFIX"
elif [ -w /usr/local/bin ]; then
  PREFIX="/usr/local/bin"
else
  PREFIX="$HOME/.local/bin"
fi

LIBDIR="$(dirname "$PREFIX")/lib/stratos"
mkdir -p "$PREFIX" "$LIBDIR"

# --- Download with retry/timeout ---
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

log_info "Fetching Stratos v$VERSION from $SOURCE ..."
if ! curl -fsSL --connect-timeout 10 --retry 3 "$SOURCE" -o "$TMP"; then
  log_error "Failed to download $SOURCE"
  exit 1
fi

# --- Native checksum verification (sha256sum -c / shasum -c --status) ---
log_info "Verifying SHA-256 of payload ..."
CHECK_LINE="$EXPECTED_SHA  $TMP"
if command -v sha256sum >/dev/null 2>&1; then
  if ! printf '%s\n' "$CHECK_LINE" | sha256sum -c --status; then
    log_error "SHA-256 mismatch. The download is corrupted or tampered."
    exit 1
  fi
elif command -v shasum >/dev/null 2>&1; then
  if ! printf '%s\n' "$CHECK_LINE" | shasum -a 256 -c --status; then
    log_error "SHA-256 mismatch. The download is corrupted or tampered."
    exit 1
  fi
else
  log_error "Neither sha256sum nor shasum is available — cannot verify integrity. Aborting."
  exit 1
fi

# --- Atomic install ---
install -m 0644 "$TMP" "$LIBDIR/stratos.mjs"

# Shim uses a runtime-relative path so moving the install tree doesn't break.
cat > "$PREFIX/stratos" <<'EOF'
#!/usr/bin/env bash
set -e
STRATOS_LIB="$(cd "$(dirname "$0")/../lib/stratos" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "stratos: node is required at runtime but was not found on PATH." >&2
  exit 1
fi
exec node "$STRATOS_LIB/stratos.mjs" "$@"
EOF
chmod 0755 "$PREFIX/stratos"

log_success "Stratos v$VERSION installed at $PREFIX/stratos"

case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *) log_info "$PREFIX is not on PATH. Add 'export PATH=\"\$PATH:$PREFIX\"' to your shell rc." ;;
esac
log_info "Try: stratos version  /  stratos help"
