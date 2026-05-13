# Environment Variables & Secrets

Single-page operator reference for everything the production deployment
consumes from `env` at runtime. Bindings (KV namespaces, AI, Vectorize,
Durable Objects, Queues, Analytics Engine) are configured in
[`wrangler.toml`](./wrangler.toml); plain env vars and secrets live in
the Cloudflare Pages project settings (or are set via
`wrangler pages secret put`).

> **Setting a secret:** `npx wrangler pages secret put <NAME>` — prompts
> for the value. Cloudflare encrypts secrets at rest; they're never
> visible after writing.
>
> **Setting a non-secret var:** Pages dashboard → Settings → Environment
> variables, or via `wrangler.toml`'s `[vars]` block for non-sensitive
> values.

---

## Required for any deploy

| Variable | Kind | Purpose |
|---|---|---|
| `ASSETS` | Binding (auto) | Cloudflare Pages-provided static assets fetcher. No configuration needed; injected by the runtime. |
| `RATE_KV` | KV namespace | The project's catch-all KV: rate-limit counters, daily analytics aggregates, passkey credentials, AI budget state, audit log entries, edge cache index. Defined in `wrangler.toml`. |

## Core authentication

| Variable | Kind | Purpose |
|---|---|---|
| `ACCOUNT_KEY` | Secret | The single bootstrap admin key. Required header for `/api/passkeys/register/*`, audit-log readback, zone-create/delete. The starting trust root for the whole platform. |
| `ACCESS_KEY` | Secret | Public-read AccessKey. Required header for `/api/assets`, `/api/insights/*`, `/api/transform`, `/api/ai/*`, etc. Distinct from `ACCOUNT_KEY` so you can rotate it independently. |
| `STORAGE_KEY` | Secret | Write key for `/api/storage/*` upload/delete operations. Scoped to mutation paths. |
| `PURGE_KEY` | Secret | API key for `/api/purge`. Also accepts a scoped Bearer token with `purge:write`. |
| `ANALYTICS_KEY` | Secret | API key for `/api/analytics` (GET reporting + POST tracking). Optional — if unset, both verbs are open. |

## Dashboard sign-in

| Variable | Kind | Purpose |
|---|---|---|
| `DASHBOARD_PASSWORD` | Secret | The dashboard's password-login secret. Verified in constant time via HMAC. **Required for dashboard access** unless you only use passkeys post-registration. |
| `DASHBOARD_SECRET` | Secret | Alias of `DASHBOARD_PASSWORD` — the code reads either. Use this if you want a longer rotating secret separate from a human-typed password. |
| `PASSKEY_CHALLENGE_SECRET` | Secret | HMAC key for signing stateless passkey challenges. Falls back to `DASHBOARD_SECRET`/`DASHBOARD_PASSWORD` when unset; setting it explicitly lets you rotate challenge signing without changing the password. |
| `PASSKEY_STRICT_VERIFY` | Secret | When `"1"`, real WebAuthn signature/origin/challenge verification failures return 401. When unset (loose mode, default), the failure reason is reported via `X-Passkey-Verification-Reason` but the login proceeds — used for safe rollout. Flip to `"1"` once you've confirmed `X-Passkey-Verification: ES256` consistently in DevTools. |
| `PASSKEY_USER` | Var | Display name for the registered admin user. Defaults to `admin@<rpId>`. |
| `PASSKEY_DISPLAY_NAME` | Var | Human-readable display name shown by the authenticator UI. Defaults to `CloudCDN Admin`. |

## Workers AI

| Variable | Kind | Purpose |
|---|---|---|
| `AI` | Binding | Workers AI binding. Required for `/api/chat`, `/api/ai/alt-text`, `/api/ai/smart-crop`, `/api/ai/moderate`, semantic search ingest. Without it, every AI endpoint returns 503. |
| `VECTOR_INDEX` | Binding | Vectorize index for semantic search. Required for `/api/search`. |

## Cache invalidation

| Variable | Kind | Purpose |
|---|---|---|
| `CLOUDFLARE_ZONE_ID` | Secret | Zone ID the `/api/purge` endpoint targets. Without this set, purge returns 500. |
| `CLOUDFLARE_API_TOKEN` | Secret | Token with `Zone:Cache Purge` permission for the above zone. |

## GitHub integration (optional)

| Variable | Kind | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | Secret | Personal access token used by `/api/webhooks` to post status comments. Optional. |
| `GITHUB_REPO` | Var | Default `owner/repo` for the GitHub integration. |

## Observability + scale (all optional)

Each of these unlocks a capability when configured; everything works
without them via in-process fallbacks.

| Variable | Kind | Purpose |
|---|---|---|
| `RATE_LIMITER` | Durable Object | Atomic rate limiting via `blockConcurrencyWhile`. When absent, `checkRateLimit()` in `_shared.js` falls back to KV — works fine for small fleets but races under high concurrency. Enable for production. |
| `METRICS` | Workers Analytics Engine | Per-request metrics emitted by the global middleware (endpoint, status, latency, trace id). Without this binding, `recordMetric()` is a no-op. Queries via WAE SQL. |
| `WEBHOOK_QUEUE` | Cloudflare Queue | Webhook delivery with exponential backoff (1s → 5s → 25s → 125s) and a DLQ. When absent, `dispatchWebhook()` delivers inline (works but blocks the request and has no retry). |
| `AUDIT_LOG_KV` | KV namespace (alias) | Distinct KV for audit log entries. When unset, audit entries co-locate in `RATE_KV` — fine in practice; separate them only if you need stricter retention or access policies on the audit trail specifically. |

## How to verify what's wired up

The deep health endpoint reports every binding's status:

```sh
curl -s https://cloudcdn.pro/api/health?deep=1 | jq .
```

Returns `{ bindings: { ... }, checks: [...] }` with `configured`,
`healthy`, and per-binding probe results. HTTP 200 = service healthy
(any optional bindings that aren't set don't degrade status); HTTP 503
= a required binding is missing or a configured binding is broken.

---

## Common rollout patterns

**Adding a new admin via passkey** (after `ACCOUNT_KEY` is set):
1. Sign in once with `DASHBOARD_PASSWORD` at `/dashboard/login`.
2. You'll land on `/dashboard/setup-passkey` — register a passkey.
3. Future logins use the passkey; password fallback remains.

**Enabling strict passkey verification:**
```sh
# Confirm `X-Passkey-Verification: ES256` in DevTools on the
# /api/passkeys/auth/complete response after a real login.
npx wrangler pages secret put PASSKEY_STRICT_VERIFY
# → enter: 1
```

**Rotating the access key without downtime:**
1. Add the new key to a header alias (briefly support both).
2. Update clients.
3. `wrangler pages secret put ACCESS_KEY` → enter new value.
4. Remove the alias.
