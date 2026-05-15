# Security Policy

CloudCDN takes the integrity of the assets we deliver and the systems we run very seriously. This document explains how to report vulnerabilities responsibly and what to expect in response.

## Supported versions

CloudCDN is delivered as a continuously deployed service from `main`. There are no long-lived release branches — the only supported version of the code is the current `HEAD` of `main` on this repository. Security fixes are rolled forward, never backported.

The published API exposes a date-based version (`X-API-Version`, currently `2026-04-01`). When a new API version is published, the previous version is supported for **at least 12 months** before sunset. Sunset dates are announced via the `Deprecation` and `Sunset` response headers (RFC 8594) at least 90 days in advance.

## Reporting a vulnerability

Please report suspected vulnerabilities to **security@cloudcdn.pro**. Encrypt sensitive details using the PGP key published at <https://cloudcdn.pro/.well-known/security.txt>.

When reporting, please include:

- A description of the issue and the impact you observed
- A minimal reproduction (URL, request, payload)
- The affected endpoint(s) or component(s)
- Your environment (browser, region, time of observation)
- Whether you have disclosed the issue elsewhere

**Do not** open a public GitHub issue, post on social media, or share the finding with third parties before we have had a chance to respond.

## What to expect

| Stage | Target |
|---|---|
| Acknowledgement of receipt | within **3 business days** |
| Initial severity assessment | within **7 days** |
| Status update cadence during investigation | every **14 days** |
| Coordinated disclosure window | **90 days** from report, extendable by mutual agreement |

We will credit reporters in the release notes for the fix unless you ask us not to. We do not currently run a paid bug bounty programme, but we routinely thank researchers publicly and via in-product acknowledgement.

## Scope

In scope:

- The CloudCDN API and its endpoints (`/api/*`)
- The asset delivery surface served from `cloudcdn.pro` and configured custom domains
- The MCP server (`@cloudcdn/mcp-server`) published to npm
- The asset dashboard (`/dashboard/*`) and supporting client libraries
- The CI/CD pipeline and its supply chain (signed commits, SLSA provenance)

Out of scope:

- Denial-of-service attacks (please do not run load tests against production)
- Findings that depend on a compromised user device, browser, or third-party account
- Self-XSS in the dashboard that requires the victim to paste payloads into their own console
- Reports based solely on the absence of a defence-in-depth header where the underlying class of attack is otherwise mitigated
- Outdated dependency reports without a working exploit chain — please file these as a Dependabot alert or PR instead

## Disclosure principles

- We will not pursue legal action against good-faith security research conducted in accordance with this policy.
- We will keep you informed of progress and target dates for remediation.
- We will give you the option to review the fix and the public advisory text before disclosure.
- Critical fixes ship as soon as a verified mitigation is available; the advisory follows once the fleet is patched.

Thank you for helping keep CloudCDN and its users safe.

---

## Security architecture

For reviewers who want to know *how* the system is hardened — not just where to report when it isn't — this section documents the active controls.

### Authentication

Three distinct keys with deliberately disjoint scopes:

| Key | Header | Scope | Threat addressed |
| :--- | :--- | :--- | :--- |
| **AccountKey** | `AccountKey: ak_live_…` | Control plane — zones, domains, edge rules, tokens, webhooks, pipeline | Tenant-level admin actions; mis-scoped access keys can't escalate |
| **AccessKey** | `AccessKey: sk_live_…` | Data plane — Storage CRUD, Assets read, Insights read | Day-to-day asset operations without admin power |
| **PurgeKey** | `x-api-key: pk_live_…` | Cache invalidation only | Limits blast radius if leaked — purging is reversible (re-cache), domain mutation is not |

All three are validated via **constant-time HMAC** (XOR-based comparison) — timing attacks against the secret are mitigated regardless of where the comparison sits in the request pipeline.

Authentication is **fail-closed in production**. The deployment bakes `STRICT_AUTH=1` into `wrangler.toml`'s `[vars]` block, which flips a guard inside every auth helper: when a required secret (`ACCOUNT_KEY`, `STORAGE_KEY`, `DASHBOARD_PASSWORD`) is unset, the endpoint returns 401 instead of allowing the request through. Without `STRICT_AUTH` the helpers fail-open when no key is configured — the dev-mode convenience that local `wrangler pages dev` and the test suite rely on. The `STRICT_AUTH=1` baked into deploy is a defence-in-depth backstop: even if a secret is accidentally cleared in the Pages dashboard, the request still fails closed.

**Scoped API tokens** (`/api/tokens`) extend the AccessKey/AccountKey model with per-scope minting. Tokens are SHA-256 hashed at rest; the plaintext is returned **once** in the create response. Token lookups are O(1) — the request header carries the full token, we compare its SHA-256 against the stored hash. Eight-character prefixes are kept in the list-output for human identification (`sk_token_abcd1234…`).

### Dashboard auth — passkeys + HMAC sessions

The dashboard (`/dashboard/*`) authenticates via **WebAuthn passkeys** with an HMAC-session cookie fallback.

- **Sessions** are HMAC-SHA256 signatures over `{expires_unix}.{hmac_hex}`, signed with `DASHBOARD_PASSWORD` (or `DASHBOARD_SECRET`). 7-day rolling TTL, `HttpOnly`, `Secure`, `SameSite=Strict`. The HMAC verification path is the same constant-time comparison used for API keys.
- **Passkey challenges** are **stateless** — `{nonce}.{expires_unix}.{type}.{hmac_hex}` — so we never need a KV round-trip on every WebAuthn flow start. The `type` field (`auth` vs `register`) prevents cross-flow replay. `CHALLENGE_TTL_SECONDS = 300`.
- **Passkey registration / authentication** writes credentials to KV indexed by credential ID. The list endpoint (`GET /api/passkeys`) exposes credential metadata but never the raw public key. Revocation is by ID — once revoked, the credential cannot reauthenticate.
- **`PASSKEY_STRICT_VERIFY=1`** opts into strict cryptographic verification of WebAuthn assertions. The default (loose mode) was used during the rollout to log signature failures without rejecting legitimate users on edge-case authenticators; flip the env var when comfortable.

### Signed URLs

`/api/signed` mints HMAC-SHA256 time-limited URLs for protected assets. Format: `path?sig={hex}&exp={unix-seconds}`. The edge verifies the signature with constant-time comparison and the expiry against the current time. Past-expired URLs return 410 Gone (not 403) so caches don't accidentally hold them. The HMAC secret is `SIGNED_URL_SECRET` — rotate it to invalidate every outstanding URL simultaneously.

### Rate limiting

Two layers:

1. **Per-endpoint counters** in KV (`rate:{endpoint}:{ip}:{day}`) for daily caps — purge is 100/day per IP, chat is 1,000/month per IP.
2. **Atomic Durable Object** rate limiter (`RATE_LIMITER`) for burst-sensitive endpoints. Opt-in via `wrangler.toml` — when present, the worker auto-detects the binding and uses it; when absent, falls back to non-atomic KV (good enough for low-fanout deployments).

The Workers AI quota also has its own circuit breaker — per-day neuron budget in KV (`ai:neurons:YYYY-MM-DD`) trips `ai:cb:open` for `AI_CB_TTL_SEC` on quota-shaped errors. Search degrades to fuzzy; chat degrades to a 30-entry curated FAQ. AI failures **never surface as 5xx** to the client.

### Content Security Policy

Three CSP profiles by route:

| Route | `script-src` | Notes |
| :--- | :--- | :--- |
| Public pages (default) | `'self'` | No inline, no third-party scripts. The dashboard's old inline `onclick=…` attributes were all externalised. |
| `/dashboard/*` | `'self' 'unsafe-inline'` | Necessary for the dashboard's runtime form handlers; admin-only surface, no attacker-controlled content rendered |
| `/api-reference` | `'self' 'unsafe-inline' https://cdn.jsdelivr.net` | Scalar's bundle + runtime inline injection. Documented in `functions/_middleware.js`; the OpenAPI spec is a build artefact, not attacker-controlled |

`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, and `upgrade-insecure-requests` are present on **every** route. The CSP is asserted by middleware unit tests on every PR.

### Transport + clickjacking + sniffing

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` on every response.
- `X-Content-Type-Options: nosniff` — MIME-type sniffing disabled.
- `X-Frame-Options: DENY` (with `frame-ancestors 'none'` as the modern equivalent).
- `Referrer-Policy: strict-origin-when-cross-origin` — full URL preserved same-origin (so dashboard analytics work) but stripped cross-origin.
- `Permissions-Policy` disables `geolocation`, `microphone`, `camera`, `payment`, `usb`, `magnetometer`, `gyroscope`, `interest-cohort`.

### Path validation

`/api/auto` and `/api/transform` validate user-supplied paths:

- Reject `..`, `\0` (null byte), or `//` (double slash) — defeats traversal, embedded-null bypasses, and protocol-relative injection.
- Reject `.git/*` paths anywhere.
- Encode/decode normalised before comparison.

### Supply chain

- **Signed commits enforced end-to-end.** Every commit on `main` is verified via the GitHub API in a `verify-signatures` job before the deploy pipeline runs. An unsigned commit on the push payload fails the build closed — the unsigned change never reaches the edge.
- **GitHub Actions pinned by full commit SHA**, not version tags. The pinned SHA is recorded with a `# vN` comment for readability but ignored by the runner. Dependabot updates the SHAs.
- **SLSA provenance attestation** generated on every Pages deploy (`actions/attest-build-provenance@…`). The deploy subject is a SHA-256 hash over a sorted file manifest, so the same input bytes always produce the same digest.
- **`npm ci` everywhere** — never `npm install` in CI — locks the dependency graph to `package-lock.json`. `npm audit --audit-level=high` runs on every PR.
- **CycloneDX SBOM** generated on every PR and uploaded as a workflow artefact (90-day retention).

### Cache hardening

`/cdn/<locale>/...` canonicalisation 301s ship with `Cache-Control: no-store`. The redirect is logically permanent, but during rollouts the target has churned (308 loops, strict-CSP HTML, no-slash forms), so we keep the redirect itself out of browser caches. This stops a future rule iteration from poisoning cached 301s and trapping returning users in a loop.

### What's intentionally not done

- **CAA records / DNSSEC** — host-level, not service-level. Documented separately in the platform runbook.
- **mTLS for the API** — single-tenant deployments could enable this via a custom domain; the multi-tenant default uses keys.
- **WAF rules beyond Cloudflare defaults** — the platform's threat model is API-driven, not exploit-driven; we lean on Cloudflare's managed rules.

If you find a gap that this section glosses over, please report it — see [Reporting a vulnerability](#reporting-a-vulnerability) above.
