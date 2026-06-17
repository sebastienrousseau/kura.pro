# CloudCDN status

CloudCDN doesn't run a separate status page — the edge runtime exposes its own
live health snapshot, which is the **single source of truth** that operators
(and external watchdogs) should consume.

## Live health endpoint

| Endpoint | What it returns | Auth |
|---|---|---|
| [`GET /api/health`](https://cloudcdn.pro/api/health) | Cheap binding-presence summary — does the runtime see ASSETS, KV, AI, Vectorize, Durable Object, WAE, Queue bindings? Returns in <50 ms. | Public |
| [`GET /api/health?deep=1`](https://cloudcdn.pro/api/health?deep=1) | Actively exercises every binding (ASSETS manifest fetch, KV probe, AI/Vectorize/Durable-Object/WAE/Queue shape checks) and returns per-binding latency + healthy/unhealthy state. Slower (~200–500 ms). | Public |

Both endpoints return `200 ok` when required bindings are reachable, and `503
degraded` otherwise. The `X-API-Version` response header on every API call
identifies the active API version (currently `2026-04-01`).

```bash
# Quick live check.
curl -s https://cloudcdn.pro/api/health | jq .

# Deep check — what you'd page on.
curl -s https://cloudcdn.pro/api/health?deep=1 | jq '{
  status,
  bindings: .bindings,
  per_binding_latency_ms: .latency
}'
```

A convenience script is wired in `package.json`:

```bash
npm run health    # curl … /api/health?deep=1 | jq .
```

## Service levels

CloudCDN runs entirely on Cloudflare Workers + Pages + KV + Vectorize + Workers
AI. The applicable SLAs are Cloudflare's, with the additional internal targets
below.

| Surface | Target | Measured by |
|---|---|---|
| Edge TTFB for cached assets | < 100 ms at p95 globally | Cloudflare Analytics + load-test (`npm run test:load`) |
| `GET /api/health` | < 50 ms at p95 | Synthetic from `npm run health` (operator-driven) |
| Control-plane API (`/api/core/*`, `/api/storage/*`) | < 500 ms at p95 | Per-endpoint vitest histograms (gated in CI) |
| AI endpoints (`/api/search`, `/api/chat`) | Best-effort; **never error** | Three-layer fallback (cache → curated → fuzzy). See [AI quota fallback](../README.md#resilience--ai-quota-fallback). |
| Deploy → edge propagation | < 90 s on signed commit to `main` | GitHub Actions `Deploy` workflow |

The numbers above are *targets*, not guarantees — CloudCDN is open source and
inherits Cloudflare's underlying SLAs. For platform incidents, see
[Cloudflare's status page](https://www.cloudflarestatus.com/).

## Resilience built into the runtime

The two AI endpoints carry the bulk of the user-visible fallback logic
(documented in [`README.md`](../README.md#resilience--ai-quota-fallback)):

1. **Workers Cache API** — day-bucketed responses, search TTL 1 h, chat TTL 24 h
2. **Neuron budget + circuit breaker** — `ai:neurons:YYYY-MM-DD` counter against
   `AI_DAILY_BUDGET`; trips `ai:cb:open` for `AI_CB_TTL_SEC` on quota errors
3. **Curated 30-entry FAQ** for chat (`functions/api/chat-fallback.json`),
   replayed through the same SSE event sequence so clients need no special
   branching — the response carries `metadata.source: ai | cached | curated`
   and `metadata.degraded`

`/api/search` annotates `mode: vector | fuzzy | cached` on every response.
Failures of the AI layer never surface as 5xx — they degrade.

## How to read an incident

When a binding is unhealthy, `/api/health?deep=1` returns the relevant entry
with `state: "unhealthy"` and an `error` field describing what failed.
Operators can then:

1. Check the [Cloudflare dashboard](https://dash.cloudflare.com/) for binding-level
   outages (Workers AI quota, Vectorize index, KV namespace).
2. Pull the **last 24 h** of operational logs via the MCP `logs_query` tool or
   `GET /api/logs?days=1&level=error` (AccountKey-gated).
3. Inspect the **audit trail** — every control-plane mutation in the last 90
   days is at `GET /api/core/audit-logs` (AccountKey-gated) or via the
   `audit_logs` MCP tool.

## Incident communication

This repository's CHANGELOG (see [`CHANGELOG.md`](../CHANGELOG.md)) is the
authoritative record of behaviour changes per sprint. Material incidents will
also be summarised under a `### Incident` heading in the affected sprint entry.

For ad-hoc questions or alerts:

- File a [GitHub Issue](https://github.com/sebastienrousseau/cloudcdn.pro/issues/new)
  with the `/api/health?deep=1` output attached.
- For coordinated security disclosure, see [`SECURITY.md`](../SECURITY.md) —
  90-day window, no bounty programme but credit on request.

---

This document is intentionally pinned to the live endpoint rather than a
dashboard URL — anyone with a terminal can verify the system's state without
asking a vendor for a public status page link.
