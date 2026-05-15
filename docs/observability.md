# Observability

CloudCDN emits one Workers Analytics Engine data point per instrumented request via `recordMetric()` in `functions/api/_shared.js`. The dataset is `cloudcdn_analytics`, bound on production as `env.METRICS`.

This doc covers (1) the schema you're querying, (2) ready-to-run SQL patterns, and (3) where it slots into the rest of the observability surface (deep health checks, audit log, rate-limit headers).

## Schema

Every call to `recordMetric(env, { endpoint, status, source, durationMs, traceId })` produces:

| Column | Source | Meaning |
| :--- | :--- | :--- |
| `blob1` | `endpoint` | Route hit, e.g. `/api/search`, `/cdn/<asset>` |
| `blob2` | `status` | HTTP response code (string-encoded) |
| `blob3` | `source` | Sub-pipeline tag — `ai`, `search`, `cache`, `static`, `error` |
| `blob4` | `traceId` | Per-request UUID — links rows to other systems via `X-Request-ID` |
| `double1` | `durationMs` | Edge handler duration; useful for percentiles |
| `index1` | `endpoint` | High-cardinality index — filter/group by endpoint at scan time |
| `timestamp` | auto | UTC write time |
| `_sample_interval` | auto | WAE sampling factor; multiply aggregations by it for accurate totals |

Two rules to remember when querying:

1. **Always weight aggregations** by `_sample_interval`. Use `sumWeighted`, `countWeighted`, `quantileWeighted` — raw `count()`/`sum()` will under-report once WAE starts sampling above ~1000 rows/sec.
2. **Filter by `index1`** (or by `timestamp`) before grouping. Indexed columns are read-cheap; everything else is a table scan.

## Ready-to-run queries

All queries target the `cloudcdn_analytics` dataset. Run them via `wrangler analytics-engine sql "<query>"` or the Cloudflare dashboard's WAE explorer.

### Request volume by endpoint (last hour)

```sql
SELECT
  index1 AS endpoint,
  sum(_sample_interval) AS requests
FROM cloudcdn_analytics
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY endpoint
ORDER BY requests DESC
LIMIT 50
```

### Latency percentiles per endpoint (last hour)

```sql
SELECT
  index1 AS endpoint,
  quantileWeighted(0.50)(double1, _sample_interval) AS p50_ms,
  quantileWeighted(0.95)(double1, _sample_interval) AS p95_ms,
  quantileWeighted(0.99)(double1, _sample_interval) AS p99_ms,
  sum(_sample_interval) AS requests
FROM cloudcdn_analytics
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY endpoint
HAVING requests > 100
ORDER BY p95_ms DESC
LIMIT 20
```

`HAVING requests > 100` filters out cold endpoints where one outlier dominates the percentile.

### Error rate by endpoint (last hour)

```sql
SELECT
  index1 AS endpoint,
  sumIf(_sample_interval, toInt32(blob2) >= 400) AS errors,
  sum(_sample_interval) AS total,
  sumIf(_sample_interval, toInt32(blob2) >= 400) / sum(_sample_interval) * 100 AS error_pct
FROM cloudcdn_analytics
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY endpoint
HAVING total > 50
ORDER BY error_pct DESC
LIMIT 20
```

### Status-code distribution (last 24h)

```sql
SELECT
  blob2 AS status,
  sum(_sample_interval) AS requests
FROM cloudcdn_analytics
WHERE timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY status
ORDER BY requests DESC
```

### Cache vs AI vs static traffic mix (last hour)

```sql
SELECT
  blob3 AS source,
  sum(_sample_interval) AS requests,
  quantileWeighted(0.95)(double1, _sample_interval) AS p95_ms
FROM cloudcdn_analytics
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY source
ORDER BY requests DESC
```

### Drill into one request by trace ID

```sql
SELECT
  timestamp,
  index1 AS endpoint,
  blob2 AS status,
  double1 AS duration_ms
FROM cloudcdn_analytics
WHERE blob4 = 'paste-trace-id-here'
ORDER BY timestamp
LIMIT 100
```

The trace ID is the same string returned in the `X-Request-ID` response header on every API call, so the path from "user reports slow request" → "WAE row for that exact request" is one paste away.

### Bursty endpoints (5-minute windows over the last hour)

```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '5' MINUTE) AS bucket,
  index1 AS endpoint,
  sum(_sample_interval) AS requests
FROM cloudcdn_analytics
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY bucket, endpoint
HAVING requests > 200
ORDER BY bucket DESC, requests DESC
```

Useful for spotting traffic spikes that might be tripping rate limits.

## Where this fits in the rest of the platform

WAE is the *sampled high-volume* layer. Two complementary signals:

| Source | Cardinality | Latency to query | Use when… |
| :--- | :--- | :--- | :--- |
| **`/api/health?deep=1`** | One snapshot | Real-time | Operator paging — "is anything broken right now" |
| **WAE (`cloudcdn_analytics`)** | Every request, sampled | ~30 s lag | Trends, percentiles, per-endpoint slicing |
| **Audit log (KV, `audit:<date>`)** | Mutations only (token/webhook/zone) | Real-time | "Who did what" forensic trail |
| **Worker exception logs (`wrangler tail`)** | Failures only | Real-time | Live debugging — 1101 / uncaught exceptions |

Rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`) are returned per response on every gated endpoint, so clients can shape their request pacing without ever needing to query WAE.

## Adding new metric dimensions

`recordMetric()` accepts a fixed shape today (`endpoint`, `status`, `source`, `durationMs`, `traceId`). To add another column:

1. Extend the destructured signature in `functions/api/_shared.js#recordMetric`.
2. Add the new value to the right slot — `blobs[N]` for strings (capacity: 20 blobs), `doubles[N]` for numbers (capacity: 20 doubles), `indexes[0]` for *one* high-cardinality filter.
3. Update this doc's schema table.
4. The WAE write path is forward-compatible: older rows just have null for the new slot, so deploying the change is zero-downtime.

Avoid putting user-identifying values in `blobs`/`indexes` — WAE retains data for 92 days and is queryable by anyone with the account API token. Trace IDs are safe (server-generated UUIDs); IPs and bearer-token prefixes are not.
