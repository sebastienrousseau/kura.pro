#!/usr/bin/env bash
# Stratos installer for macOS and Linux.
#
# Downloads stratos.mjs from https://cloudcdn.pro/dist/stratos/, writes a
# tiny shim at /usr/local/bin/stratos (falls back to ~/.local/bin if the
# system bin isn't writable) that execs `node <path-to-stratos.mjs>` with
# whatever args you pass.
#
#   curl -sL https://cloudcdn.pro/dist/stratos/install.sh | bash
#
# Override the install prefix:
#   curl -sL https://cloudcdn.pro/dist/stratos/install.sh | STRATOS_PREFIX=$HOME/bin bash
#
# Requires Node ≥ 18 on PATH. Refuses to install otherwise.

set -euo pipefail

CDN_BASE="${CLOUDCDN_URL:-https://cloudcdn.pro}"
SOURCE="$CDN_BASE/dist/stratos/stratos.mjs"
# Expected SHA-256 of stratos.mjs as delivered. Matches the source file
# in git verbatim — `curl -o` (used below) writes the response body
# byte-for-byte. Note: piping curl to a process (e.g. `curl ... |
# shasum`) appends one extra newline to the stream, giving a different
# hash. Verify with `curl -fsSL .../stratos.mjs -o /tmp/x && shasum
# -a 256 /tmp/x` to match this value. Bumped on each release.
EXPECTED_SHA="98306c394345fc18b8610c0113e6ef94f071ceba47de0f07eb45a9204effaf27"
VERSION="0.1.0"

# Pick an install prefix. Honour $STRATOS_PREFIX first; otherwise prefer
# /usr/local/bin if writable; otherwise drop to ~/.local/bin.
if [ -n "${STRATOS_PREFIX:-}" ]; then
  PREFIX="$STRATOS_PREFIX"
elif [ -w /usr/local/bin ]; then
  PREFIX="/usr/local/bin"
else
  PREFIX="$HOME/.local/bin"
fi

mkdir -p "$PREFIX"

# Pre-flight: Node must be present and ≥ 18.
if ! command -v node >/dev/null 2>&1; then
  echo "stratos install: Node.js ≥ 18 is required and was not found on PATH." >&2
  echo "  Install from https://nodejs.org or via your package manager, then retry." >&2
  exit 1
fi
NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node).split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "stratos install: Node $NODE_MAJOR detected; Stratos needs Node ≥ 18 (for built-in fetch and crypto.subtle)." >&2
  exit 1
fi

LIBDIR="$PREFIX/../lib/stratos"
mkdir -p "$LIBDIR"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "stratos install: fetching $SOURCE ..."
if ! curl -fsSL "$SOURCE" -o "$TMP"; then
  echo "stratos install: failed to download $SOURCE" >&2
  exit 1
fi

# Integrity check — refuses to install if the download doesn't match
# the expected SHA pinned above.
if command -v sha256sum >/dev/null 2>&1; then
  GOT="$(sha256sum "$TMP" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  GOT="$(shasum -a 256 "$TMP" | awk '{print $1}')"
else
  echo "stratos install: neither sha256sum nor shasum found; skipping integrity check." >&2
  GOT=""
fi
if [ -n "$GOT" ] && [ "$GOT" != "$EXPECTED_SHA" ]; then
  echo "stratos install: SHA-256 mismatch on stratos.mjs." >&2
  echo "  expected: $EXPECTED_SHA" >&2
  echo "  got:      $GOT" >&2
  exit 1
fi

install -m 0644 "$TMP" "$LIBDIR/stratos.mjs"

cat > "$PREFIX/stratos" <<EOF
#!/usr/bin/env bash
exec node "$LIBDIR/stratos.mjs" "\$@"
EOF
chmod 0755 "$PREFIX/stratos"

echo "stratos install: installed v$VERSION at $PREFIX/stratos"
case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *) echo "stratos install: note — $PREFIX is not on PATH. Add it to your shell rc." ;;
esac
echo "stratos install: try 'stratos version' or 'stratos help'."
