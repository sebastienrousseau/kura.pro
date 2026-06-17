# Changelog

All notable changes to CloudCDN are documented here. Format inspired by
[Keep a Changelog](https://keepachangelog.com/); commit-level history
lives in `git log`.

Versioning is calendar-based on the **`apiVersion`** field returned by
every API envelope (currently `2026-04-01`). This file groups commits
into the *sprints* used during development.

## [Unreleased]

### Sprint 15 — cleanup & open-source

Polish toward top-decile open-source signal: zero stale numbers in
headline docs, the MCP package overhauled to library-grade publication
standard, every empty placeholder filled with a single source of truth.

#### Added
- **`@cloudcdn/mcp-server`** — first publishable revision of the MCP
  package. Adds `exports` map (`/server`, `/api-client`), `bin`,
  `files` allowlist, runnable `examples/` (quickstart-stdio,
  programmatic-embed, semantic-search, cache-purge, transform-image),
  JSDoc on every public surface, and a `test:coverage` script.
- **MCP test suite expanded** from 91 to 133 tests across 13 files:
  direct units for `assets`, `webhooks`, `tokens`, `logs`,
  `resources`, plus the `index.js` entry point, plus branch-coverage
  gap fillers in `api-client`, `ai`, `core`, `delivery`, `storage`.
  100% statements / branches / functions / lines gated in
  `mcp/vitest.config.js`.
- **New client zones**: `acmt001`, `euxis`, `inclusio`, `stratos`,
  plus `sebastienrousseau/v2`. Manifest now indexes 1,824 assets.
- **Filled CDN README stubs** for `clients/cmn`, `clients/common`,
  `clients/dotfiles/v1`, `clients/dotfiles/v2` — each describes
  whether the directory is a tenant zone or a shared library.

#### Changed
- **Hardened `webhook_delete` and `token_revoke`** to pass `id` as a
  URL-encoded query param via the api-client rather than interpolating
  it into the URL string. Defensive against ids with reserved chars.
- **Refreshed root README** to live source-of-truth counts: 3,190
  tests across 72 suites (was 2,994), 1,824 manifest assets (was
  1,647), 65 tenant zones + 2 shared libraries (was 59), 42 MCP tools
  + 6 resources (was 22 + 3), 36 edge API endpoints (was 38).
- **Hot-path dependency bumps** (Dependabot): `actions/checkout` 6.0.2
  → 6.0.3, `sharp` 0.34.5 → 0.35.1, `@vitest/coverage-v8` 4.1.7 →
  4.1.9, `vitest` 4.1.7 → 4.1.9, `happy-dom` 20.9.0 → 20.10.3,
  `tailwindcss` + `@tailwindcss/cli` 4.3.0 → 4.3.1.

## 2026-05-14 — Sprint 14

End-to-end strict CSP, dashboard hardening, and the first **Stratos** CLI
release. `apiVersion` unchanged at `2026-04-01`.

### Added
- **Stratos v0.1.0** — official CloudCDN CLI shipped at
  `https://cloudcdn.pro/dist/stratos/`. Single-file Node ≥ 18 script
  (`stratos.mjs`) plus `install.sh` / `install.ps1` with pinned
  SHA-256 verification. Commands: `version`, `health [--deep]`,
  `purge <url|--tag|--everything>`, `signed <path> --expires`,
  `assets [--project= --format= --page=]`. One-liner installer:
  ```
  curl -sL https://cloudcdn.pro/dist/stratos/install.sh | bash
  ```
- `functions/dist/_middleware.js` PUBLIC_ARTIFACT_RE bypass so the
  install one-liner reaches `/dist/<pkg>/install.{sh,ps1}` and
  artifact files without the dashboard session check.
- `cdn/en/dist/_dist.js` rewritten to advertise real Stratos +
  static-site-generator (`sebastienrousseau/static-site-generator`)
  packages, with byte-accurate sizes and SHA-256s.
- `npm run` ops scripts: `build:all`, `health`, `secrets:list`,
  `secrets:set`, `ci:status`, `ci:alerts`, `lint:csp`.
- 14 new tests across `_middleware.js` and `_shared.js` to close 100%
  coverage gate after adding them to the gated file list.

### Changed
- **Strict Content-Security-Policy** site-wide. `script-src 'self'`
  enforced; public pages and dashboard now share an identical CSP
  header. Inline scripts externalised into 5 new files: chat widget
  (`/shared/widgets/chat.js`), homepage lang switcher
  (`/shared/homepage-lang-switcher.js`), dashboard login (`/dashboard/
  _login.js`), passkey setup (`/dashboard/_setup-passkey.js`), upload
  tab (`/cdn/en/dashboard/_upload-tab.js`), upload page (`/cdn/en/
  dashboard/_upload-page.js`), dist page (`/cdn/en/dist/_dist.js`).
  Plus the new Stratos package script (`/cdn/en/dist/stratos/
  _dist.js` content moved into `/cdn/en/dist/_dist.js`).
- 6 inline `onclick`/`onchange`/`oninput` attributes in the dashboard
  upload UI converted to event delegation listeners attached on
  `DOMContentLoaded`.
- `JsonErrorResponse` OpenAPI schema rewritten to reflect the
  `legacyErrorJson()` envelope (`error` + `HttpCode` + `Message` +
  `requestId` + `timestamp` + `apiVersion`).
- Top nav alignment switched to Apple-style `flex: 1` centring (was
  `margin: 0 auto`, off-centre with asymmetric brand/CTA widths).
- README points at SECRETS.md and documents `/api/health?deep=1`.

### Fixed
- `/dist/` was rendering `Detected: detecting...` because its inline
  script and the dynamically-injected `onclick="copyCmd(this)"` were
  blocked by strict CSP. Externalised to `_dist.js`; copy button
  uses `data-action="copy"` + delegated listener.
- Curl-stdout vs `-o file` SHA mismatch on Stratos artefacts —
  documented and pinned SHAs to the `-o`-pattern (matches git source).

### Security
- `functions/_middleware.js` global CSP now: `script-src 'self';
  style-src 'self' 'unsafe-inline'; base-uri 'self'; form-action
  'self'; frame-ancestors 'none'; object-src 'none';
  upgrade-insecure-requests`.
- Coverage gate expanded to include `functions/_middleware.js` and
  `functions/api/_shared.js`; both at 100%.

## 2026-05-13 — Sprint 13

Background-removal stub, OpenAPI cleanup, dashboard XSS hardening, and
the entire CodeQL backlog cleared.

### Added
- `POST /api/ai/background-remove` — 501 Not Implemented stub plus
  MCP tool. Documents the endpoint shape while Workers AI lacks a
  segmentation model. ([914a291])
- `SECRETS.md` — single-page operator reference for every env var,
  binding, and secret the runtime consumes, with the wrangler command
  to set each. ([16c2e66])
- A `defer`-attached `<script src="/shared/widgets/chat.js">` for the
  chat widget; previously inline.

### Changed
- `functions/api/pipeline.js sanitizeSvg` rewritten as a string-walker
  state machine; no regex over tag names. Fixes
  `js/incomplete-multi-character-sanitization` and `js/bad-tag-filter`
  CodeQL flags. ([eb1a37e])
- URI denylist extended to cover `vbscript:` and broad `data:`
  subtypes (only inert binary image types are allowed). ([9b845d7])

### Fixed
- 32 open CodeQL alerts closed (28 `js/xss-through-dom` across locale
  files + 4 `js/incomplete-multi-character-sanitization` /
  `js/bad-tag-filter` on `pipeline.js`). ([2cd8eb5], [eb1a37e],
  [9b845d7])
- Dashboard copy-to-clipboard snippet for `<img src>` now
  HTML-escapes the URL — previously broke for the one `&`-named
  asset (`henry-&-co-2059736.webp`). ([81c0a0d])
- Upload page SVG preview switched from `innerHTML = svgText` to
  `<img src="blob:...">` to prevent self-XSS from a malicious
  dropped SVG. ([2583b46])
- Spotlight search dropped inline `onclick` for event delegation;
  upload-result commit line built via DOM ops. ([c3453e0], [f6fc3c9])

### Security
- Minimal CSP shipped: `base-uri 'self'; form-action 'self';
  frame-ancestors 'none'; object-src 'none';
  upgrade-insecure-requests`. ([7cf015e])

## 2026-05-13 — Sprint 12

Cryptographic WebAuthn verification with a safe rollout flag.

### Added
- `verifyAssertion()` in `functions/api/passkeys/index.js` — full
  Level 2 WebAuthn assertion verify (clientDataJSON type/origin/
  challenge + signature over `authData || sha256(clientDataJSON)`).
  Supports ES256 (P-256) and RS256, with DER → raw signature
  conversion for ECDSA. ([4c595be])
- `PASSKEY_STRICT_VERIFY` env-gated knob — when `"1"`, real
  verification failures return 401; default loose mode logs and
  accepts to make rollout safe. ([3bd0488])

### Changed
- Stale `Path=/dashboard` session cookie cleared on every successful
  passkey login (matches the password-login flow).

## 2026-05-13 — Sprint 11

KV-quota fire (passkey lockout), error envelope migration, expanded
image format chain, and the health-probe deep mode.

### Added
- **Animated AVIF (`.avifs`), animated WebP, APNG, GIF, HEIC, HEIF**
  added to `/api/auto` format negotiation. Accept-gated so non-Apple
  clients don't waste probes on HEIF. ([80989ad])
- **`GET /api/health?deep=1`** — exercises every binding (ASSETS
  manifest fetch, RATE_KV probe, AI/Vectorize/DO/WAE/Queue shape
  checks) and returns 503 when a required binding is missing or
  broken. ([33d600b])
- `legacyErrorJson()` envelope helper in `_shared.js` — preserves
  the legacy `{ error: "<string>" }` body for back-compat and
  layers the standard envelope (HttpCode, Message, requestId,
  timestamp, apiVersion) on top.

### Changed
- 5 endpoints migrated to the envelope: `/api/purge`, `/api/stream`,
  `/api/auto`, `/api/analytics`, `/api/transform`. ([b8670a2])

### Fixed
- **Passkey login fixed** after a KV-quota outage:
  1. `/api/passkeys/*` handlers now return structured JSON 500
     instead of letting exceptions crash the Worker. ([80959ce])
  2. WebAuthn challenges moved off KV onto a stateless HMAC
     scheme — no `kv.put()` per `authBegin`, so the daily KV
     write quota can no longer DoS sign-in. ([cba735f])
  3. signCount/lastUsedAt KV write made fail-soft so login
     succeeds even when KV is over quota. ([bab2699])

[80959ce]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/80959ce
[cba735f]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/cba735f
[80989ad]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/80989ad
[33d600b]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/33d600b
[bab2699]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/bab2699
[4c595be]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/4c595be
[3bd0488]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/3bd0488
[914a291]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/914a291
[16c2e66]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/16c2e66
[2cd8eb5]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/2cd8eb5
[eb1a37e]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/eb1a37e
[9b845d7]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/9b845d7
[81c0a0d]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/81c0a0d
[2583b46]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/2583b46
[c3453e0]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/c3453e0
[f6fc3c9]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/f6fc3c9
[7cf015e]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/7cf015e
[b8670a2]: https://github.com/sebastienrousseau/cloudcdn.pro/commit/b8670a2
