# CloudCDN architecture

A pragmatic, code-anchored description of how the system is built. Read alongside the repo — every claim below points at a file you can open.

## Topology

CloudCDN runs entirely on Cloudflare. There are no other origins, no databases off-platform, no third-party object stores in the request path.

```
            ┌─────────────────────────────────────────────┐
            │  GitHub (origin of truth — signed commits)  │
            └──────────────────────┬──────────────────────┘
                                   │ push to main
                                   ▼
            ┌─────────────────────────────────────────────┐
            │  Cloudflare Pages build + deploy            │
            │  - SLSA provenance attestation              │
            │  - Wrangler deploy to 300+ PoPs             │
            └──────────────────────┬──────────────────────┘
                                   │
                                   ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  Pages Functions runtime (Workers)                             │
   │                                                                │
   │  functions/_middleware.js  → request routing, analytics        │
   │  functions/api/*           → 12 endpoints, 6 logical planes    │
   │                                                                │
   │  Bindings:                                                     │
   │    ASSETS         (static asset fetcher)                       │
   │    RATE_KV        (KV: rate counters, AI budget, tokens, ...)  │
   │    AI             (Workers AI: embeddings + LLM)               │
   │    VECTOR_INDEX   (Vectorize: cloudcdn-knowledge)              │
   │    caches.default (edge Cache API)                             │
   └────────────────────────────────────────────────────────────────┘
```

The Git repo is the only source of truth for both code and assets. The deploy pipeline verifies that every commit on `main` is cryptographically signed before it can reach the edge (see `.github/workflows/deploy.yml`).

## Data layout

```
/
├─ clients/          59 tenant zones, each `clients/<name>/v1/<...>`
├─ stocks/           global stock media (images, diagrams, videos)
├─ cdn/              application layer
│   ├─ en/, fr/, de/, ...  28 localised homepages + content
│   ├─ dashboard/    asset dashboard SPA (Tailwind)
│   ├─ api-reference/ OpenAPI 3.1 docs viewer
│   └─ shared/       language-agnostic shared assets
├─ functions/        Pages Functions (the API)
├─ scripts/          build, manifest, knowledge sync, generators, tests
├─ mcp/              @cloudcdn/mcp-server — agent-facing tool surface
├─ manifest.json     auto-generated catalog of every deliverable asset
└─ wrangler.toml     Cloudflare bindings + deploy config
```

`manifest.json` is the single source for "what assets exist", regenerated from the filesystem by `scripts/generate-manifest.mjs`. The same script emits TypeScript path typedefs (`cloudcdn-paths.d.ts`) so consumers get static guarantees about asset URLs.

## Routing

`functions/_middleware.js` runs on every request and performs zero-allocation path classification:

- Asset extension (`.webp`, `.avif`, `.jxl`, `.png`, `.svg`, `.ico`, `.mp4`) → static fetch from one of `clients/`, `stocks/`, or `cdn/`.
- Functions-owned prefixes (`/dashboard/`, `/dist/`) → delegated to nested Pages Functions.
- Localised content prefixes (`/content/`, `/api-reference/`) → resolved against the requested locale with a fallback to `en/`.
- Language root (`/{lang}/`) → resolved against the `LOCALES` set.

This middleware is performance-critical: it uses `lastIndexOf`, `slice`, and a pre-compiled extension `Set` instead of regex or `new URL()` to keep the hot path allocation-free.

## API surface

Twelve endpoints across six planes. Authentication scope is enforced per plane and not per endpoint.

| Plane | Endpoints | Auth |
|---|---|---|
| Storage | `/api/storage/...`, `/api/storage/batch` | AccessKey |
| Core | `/api/core/zones`, `/api/core/domains`, `/api/core/rules`, `/api/core/statistics` | AccountKey |
| Assets | `/api/assets` (paginated catalog), `/api/assets/{path}` | AccessKey |
| Insights | `/api/insights/{summary,top,geo,errors}` | Any control-plane key |
| Delivery | `/api/transform`, `/api/auto`, `/api/signed`, `/api/stream`, `/api/purge` | Public (rate-limited) |
| AI | `/api/search`, `/api/chat` | Public (rate-limited) |

Cross-cutting concerns live in `functions/api/_shared.js`:

- Manifest cache (isolate-scoped, 30s TTL).
- Streaming JSON envelope helper (`streamJsonArray`).
- HMAC primitives (`hmacSign`, `hmacVerify`, `hmacVerifyCached`) using constant-time comparison.
- Auth helpers (`authenticateAccess`, `authenticateAccount`, `authenticateAny`).
- Rate limiting (KV-backed, non-atomic — see "Known limits").
- Structured JSON logger (`log.info/warn/error`).
- W3C trace context (`createTrace`).
- RFC 9457 + Microsoft-style error envelope (`errorResponse`).
- Workers AI quota guard (`aiBudgetState/Charge/Trip`, `isAiQuotaError`).
- Edge response cache (`buildCacheKey`, `cacheGet`, `cacheSet`).

## AI request flow

Two endpoints depend on Workers AI and Vectorize: `/api/search` and `/api/chat`. Both run a layered fallback so users do not see errors when the daily neuron budget is exhausted.

```
                        ┌──────────────────────────────┐
                        │ Edge response cache (Cache API)
                        │ Day-bucketed key path        │
                        │ search: 1h TTL  chat: 24h    │
                        └─────────────┬────────────────┘
                                      │ miss
                                      ▼
                        ┌──────────────────────────────┐
                        │ Neuron budget gate (RATE_KV) │
                        │ ai:neurons:YYYY-MM-DD vs cap │
                        │ ai:cb:open circuit breaker   │
                        └─────────────┬────────────────┘
                                      │ allowed
                                      ▼
                        ┌──────────────────────────────┐
                        │ Workers AI embedding + LLM   │
                        │ @cf/baai/bge-base-en-v1.5    │
                        │ @cf/meta/llama-3.1-8b-fast   │
                        └─────────────┬────────────────┘
                                      │ quota error
                                      ▼
                        ┌──────────────────────────────┐
                        │ Curated fallback             │
                        │ functions/api/chat-fallback  │
                        │ Token-Jaccard match          │
                        │ Same SSE event shape         │
                        └──────────────────────────────┘
```

Search annotates `mode: vector | fuzzy | cached` on every response. Chat annotates `metadata.source: ai | cached | curated` and `metadata.degraded`. Clients render the same UI regardless of which layer served the response.

The neuron budget is capped per UTC day by `AI_DAILY_BUDGET` (default `9000`, ~90% of the free tier). Quota-shaped errors (HTTP 429 or Workers AI codes 3040/7006/9001, plus message heuristics) flip the circuit breaker for `AI_CB_TTL_SEC` (default `60s`) so subsequent requests skip the AI call entirely.

## Asset pipeline

A push to `main` triggers two side-effect workflows alongside the deploy:

- `compress-images.yml` — every new PNG/JPEG is auto-converted to WebP (q80) and AVIF (q65). Originals stay in the repo. Workflow uses a signed commit so the trail stays intact.
- `generate-manifest.yml` — rebuilds `manifest.json` and `cloudcdn-paths.d.ts`. Also signed.
- `sync-knowledge.yml` — when `cdn/**/content/` changes, re-embeds the markdown into Vectorize for the AI Concierge to retrieve.

The asset pipeline endpoint (`/api/pipeline`) scaffolds a tenant zone from a single SVG: it generates a PWA icon set, banners, and a favicon, then commits them back to GitHub.

## Observability

All log entries are structured JSON written to stdout (`functions/api/_shared.js`, `log`). Each entry has `level`, `code`, `message`, `timestamp`, and operation-specific metadata. The intent is direct ingestion via Cloudflare Logpush.

The `createTrace(request)` helper emits a W3C-compatible trace ID and span ID per request. Threading the trace ID through downstream logs is in-progress work — see the audit notes in the issue tracker.

## Security model

A short list of the load-bearing controls — the long form lives in [`SECURITY.md`](SECURITY.md).

- Signed commits enforced before deploy. The `verify-signatures` job in `deploy.yml` queries the GitHub API for each commit's verification status and fails the deploy if any commit in the push range is unverified.
- SLSA provenance attestation on every build.
- All third-party GitHub Actions pinned by commit SHA.
- HMAC verification uses constant-time comparison.
- Path inputs are decoded, normalised, and checked for `..`, null bytes, and `.git` segments before reaching the asset store.
- The dashboard session cookie is HMAC-signed and expires server-side.
- The AI chat context comes from Vectorize-indexed Markdown that any push can change — this surface is treated as untrusted and is being moved behind PR review for the `cdn/**/content/` paths.

## Operator-controlled bindings

Three Cloudflare bindings are shipped commented-out in `wrangler.toml`. The code paths that depend on them auto-detect each binding and fall back to a safe default when absent — so production keeps running through every migration. Enabling each is a one-time uncomment + deploy.

### Atomic rate limiter (`RATE_LIMITER`)

```toml
[[durable_objects.bindings]]
name       = "RATE_LIMITER"
class_name = "RateLimiterDO"

[[migrations]]
tag         = "v1"
new_classes = ["RateLimiterDO"]
```

`functions/api/_shared.js#checkRateLimit` prefers the Durable Object when bound (atomic increment-if-below via `blockConcurrencyWhile`) and falls back to the non-atomic KV path when it isn't. First deploy after the uncomment provisions the namespace; subsequent requests use atomic limits automatically. To verify: `npx wrangler tail` and look for `"ai_circuit_open"` log entries — they should be absent or rare in steady state.

### Observability metrics (`METRICS`)

```toml
[[analytics_engine_datasets]]
binding = "METRICS"
dataset = "cloudcdn_metrics"
```

`recordMetric()` in `_shared.js` writes one data point per request:

| Field | Type | Source |
|---|---|---|
| `blob1` | string | request pathname (also indexed) |
| `blob2` | string | HTTP status |
| `blob3` | string | `metadata.source` for AI endpoints (`ai`/`cached`/`curated`/`fuzzy`/`vector`) |
| `blob4` | string | trace ID |
| `double1` | number | duration in ms |
| `index1` | string | request pathname |

The dataset is provisioned on first write — no migration step. Query with the Workers Analytics Engine SQL API. Common patterns:

```sql
-- p50 / p95 / p99 latency per endpoint over the last hour
SELECT
  blob1                              AS endpoint,
  quantileWeighted(0.50)(double1, _sample_interval) AS p50_ms,
  quantileWeighted(0.95)(double1, _sample_interval) AS p95_ms,
  quantileWeighted(0.99)(double1, _sample_interval) AS p99_ms,
  count() * any(_sample_interval)    AS request_count
FROM cloudcdn_metrics
WHERE timestamp > now() - INTERVAL '1' HOUR
GROUP BY blob1
ORDER BY request_count DESC
LIMIT 20;

-- Status-code mix per endpoint (4xx/5xx watch)
SELECT
  blob1 AS endpoint,
  blob2 AS status,
  sum(_sample_interval) AS requests
FROM cloudcdn_metrics
WHERE timestamp > now() - INTERVAL '1' HOUR
  AND toUInt16(blob2) >= 400
GROUP BY blob1, blob2
ORDER BY requests DESC;

-- AI fallback rate — what fraction of /api/chat or /api/search served
-- degraded responses?
SELECT
  blob1                                    AS endpoint,
  blob3                                    AS source,
  sum(_sample_interval)                    AS requests,
  sum(_sample_interval) * 100.0
    / sum(sum(_sample_interval)) OVER (PARTITION BY blob1) AS pct
FROM cloudcdn_metrics
WHERE timestamp > now() - INTERVAL '1' DAY
  AND blob1 IN ('/api/search', '/api/chat')
GROUP BY blob1, blob3
ORDER BY blob1, requests DESC;

-- Trace lookup — fetch a single request by trace ID
SELECT timestamp, blob1, blob2, blob3, double1
FROM cloudcdn_metrics
WHERE blob4 = 'PASTE-TRACE-ID-FROM-X-TRACE-ID-HEADER'
LIMIT 100;
```

`_sample_interval` is the WAE sample interval — multiplying counts by it gives unbiased totals. The trace ID column is the same value clients see in the `X-Trace-Id` response header.

### Webhook delivery queue (`WEBHOOK_QUEUE`)

```toml
[[queues.producers]]
binding    = "WEBHOOK_QUEUE"
queue      = "cloudcdn-webhooks"
```

`dispatchWebhook()` in `functions/api/webhooks.js` auto-detects this binding. When present, it enqueues one message per matching webhook target; when absent, it falls back to direct fire-and-forget delivery (single attempt, 5s timeout).

Pages Functions cannot run queue consumers natively. The canonical consumer handler is in `functions/api/webhook_consumer.js` and must be deployed as a separate Worker:

```bash
# 1. Create the queue and (optional) dead-letter queue
npx wrangler queues create cloudcdn-webhooks
npx wrangler queues create cloudcdn-webhooks-dlq

# 2. Scaffold the consumer Worker — a thin shell around webhook_consumer.js
mkdir -p workers/webhook-consumer/src
cat > workers/webhook-consumer/src/index.js <<'JS'
export { webhookQueueHandler as default } from '../../../functions/api/webhook_consumer.js';
JS

# 3. Consumer wrangler.toml (workers/webhook-consumer/wrangler.toml)
cat > workers/webhook-consumer/wrangler.toml <<'TOML'
name = "cloudcdn-webhook-consumer"
main = "src/index.js"
compatibility_date = "2026-01-01"

[[queues.consumers]]
queue             = "cloudcdn-webhooks"
max_batch_size    = 10
max_batch_timeout = 5
max_retries       = 5
dead_letter_queue = "cloudcdn-webhooks-dlq"
TOML

# 4. Deploy the consumer
cd workers/webhook-consumer && npx wrangler deploy
```

The consumer applies exponential backoff (1s → 5s → 25s → 125s) up to 4 attempts per message, then routes to the DLQ. HMAC signing matches the inline delivery path, so receivers see the same `X-Webhook-Signature` header shape regardless of which path delivered.

To inspect the DLQ:

```bash
# List messages waiting in the dead-letter queue
npx wrangler queues consumer dead-letter cloudcdn-webhooks-dlq
```

## Known limits and trade-offs

- **Rate limiting has two backends.** `checkRateLimit` (in `_shared.js`) prefers the `RateLimiterDO` Durable Object (`functions/api/rate_limiter_do.js`) when bound — atomic increment-if-below via `blockConcurrencyWhile`. When the DO binding is absent it falls back to the legacy KV path, which is read-then-write and therefore non-atomic under burst concurrency. The DO binding is shipped commented-out in `wrangler.toml`; enabling it is a one-time `wrangler deploy` operation to provision the namespace.
- **Cache API is per-PoP.** Hot queries warm each colo independently. Cold PoPs still pay the AI cost until they accumulate hits.
- **Manifest cache is per-isolate.** Different isolates within the same PoP may have slightly different views of the manifest for up to 30 seconds after a deploy.
- **Workers AI free-tier neurons are the binding cost.** All AI features assume they may be temporarily unavailable and degrade gracefully.

## Testing strategy

- `npm test` runs the full unit and integration suite (2,000+ tests).
- `vitest.config.js` declares a 100% gate on a curated set of files. The set is intentionally narrow — expanding it to the full API surface is sprint work.
- Visual regressions are caught by Playwright snapshots under `scripts/tests/visual/`.
- Load behaviour is exercised by a k6 script (`scripts/tests/load.k6.js`).
- The OpenAPI spec and the implementation are kept in sync by `spec-sync.test.js`.

## Where to look first

If you are new to the codebase and have ten minutes:

1. `functions/_middleware.js` — the routing model in 200 lines.
2. `functions/api/_shared.js` — every cross-cutting helper, with rationale.
3. `functions/api/chat.js` — the AI fallback architecture, end to end.
4. `wrangler.toml` — the bindings list (small; tells you what's wired up).
5. `scripts/generate-manifest.mjs` — the asset catalog generator.

Then pick an endpoint from `functions/api/` and follow it through to its test in `scripts/tests/`.
