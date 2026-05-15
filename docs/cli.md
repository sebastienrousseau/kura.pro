# Stratos — the CloudCDN CLI

[Stratos](https://github.com/sebastienrousseau/stratos) is the
companion command-line client for CloudCDN. It lives in its own
MIT-licensed repository so users can install it without cloning this
one. The CLI is a single Node ≥ 18 script.

## Install

```bash
# macOS / Linux
curl -sL https://cloudcdn.pro/dist/stratos/install.sh | bash

# Windows (PowerShell)
irm https://cloudcdn.pro/dist/stratos/install.ps1 | iex
```

Each installer verifies a **pinned SHA-256** before placing a `stratos`
shim on `$PATH`. The pinned hash is checked against the served bytes —
a CDN-side tampering would fail the integrity check before the script
runs.

Alternatively, clone the [stratos repo](https://github.com/sebastienrousseau/stratos)
and run `bin/stratos.mjs` directly.

## Configure

Stratos reads configuration from environment variables. The minimum
set:

```bash
export CLOUDCDN_URL="https://cloudcdn.pro"        # Default; override for staging
export CLOUDCDN_ACCESS_KEY="sk_live_..."          # Storage, Assets, Insights
export CLOUDCDN_ACCOUNT_KEY="ak_live_..."         # Core, Pipeline, Webhooks
export CLOUDCDN_PURGE_KEY="pk_live_..."           # Cache purge
export SIGNED_URL_SECRET="..."                    # For local URL signing
```

See [SECRETS.md](../SECRETS.md) for the full reference.

## Commands

```bash
stratos version                      # Print version + build SHA
stratos health [--deep]              # Service health; --deep exercises every binding
stratos assets [filters]             # Browse the asset catalog
stratos zones                        # List tenant zones
stratos zone <name> [--create]       # Get or create a zone
stratos purge <urls...|--tag <t>...|--everything>
                                     # Invalidate cache
stratos signed <path> --expires <unix-seconds>
                                     # Mint a signed URL locally
stratos transform <url> [--w] [--h] [--format] [--q] [--blur] [--sharpen]
                                     # Build a transform URL
stratos chat <question>              # Ask the AI concierge
stratos search <query>               # Semantic asset search
```

Run `stratos help <command>` for full per-command flags.

## Examples

```bash
# Operator health-check
stratos health --deep
# {"status":"ok","bindings":{"ASSETS":{"ok":true,"latency_ms":4}, ...}}

# Purge by tag
stratos purge --tag project-akande --tag type-banner

# Mint a 24-hour signed download URL
stratos signed /clients/acme/contract.pdf --expires "$(date -v+24H +%s)"
# https://cloudcdn.pro/clients/acme/contract.pdf?sig=...&exp=...

# Filter the catalog
stratos assets --project=akande --format=svg --per-page=20

# Build a transform URL without firing the request
stratos transform /akande/v1/logos/akande.svg --w=400 --format=webp --q=80
# https://cloudcdn.pro/api/transform?url=/akande/v1/logos/akande.svg&w=400&format=webp&q=80
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Generic error (the message says what) |
| `2` | Missing required argument |
| `3` | Missing required env var (e.g. `CLOUDCDN_ACCOUNT_KEY` not set) |
| `4` | HTTP request failed (network or non-2xx) |
| `5` | Authentication failed (401) |
| `6` | Rate-limited (429) |

The full table is documented in the
[Stratos repo](https://github.com/sebastienrousseau/stratos) along with
the per-command exit-code mapping.

## Testing

```bash
npm test                # exercises scripts/tests/stratos-cli.test.js
```

The Stratos test surface lives in this repo because the CLI's
behaviour is coupled to the API contract here. The companion repo's
own CI runs the same suite against the published binary.
