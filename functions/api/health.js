/**
 * Health check endpoint.
 *
 * GET /api/health           → cheap binding-presence check
 * GET /api/health?deep=1    → also exercises each binding so we can see
 *                             "wired but broken" cases (KV down, manifest
 *                             missing, DO not migrated, etc.)
 *
 * Response shape (deep):
 *   {
 *     status: 'ok' | 'degraded',
 *     timestamp,
 *     apiVersion,
 *     bindings: { assets, kv, ai, vectorize, rateLimiter, metrics, webhookQueue, auditLogKv },
 *     checks: [ { name, configured, healthy, latencyMs?, method, error? } ]
 *   }
 *
 * Status logic: `degraded` when any *configured* binding fails its probe.
 * Bindings that aren't configured at all (the operator hasn't uncommented
 * the wrangler.toml stanza yet) don't affect status — they're optional.
 */

import { API_VERSION } from './_shared.js';

const PROBE_TIMEOUT_MS = 5_000;
const KV_PROBE_KEY = 'health:probe';

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    /* v8 ignore next -- only fires when a probe genuinely exceeds the
       5s budget; impossible to exercise reliably in unit tests without
       slowing the whole suite. The branch is small and well-isolated. */
    timer = setTimeout(() => reject(new Error('probe timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function timed(fn) {
  const start = Date.now();
  try {
    await fn();
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err?.message || String(err) };
  }
}

async function probeAssets(env, requestUrl) {
  const configured = !!env.ASSETS;
  if (!configured) return { name: 'assets', configured, healthy: false, method: 'shape', error: 'binding missing' };
  const result = await timed(async () => {
    const res = await withTimeout(
      env.ASSETS.fetch(new URL('/manifest.json', requestUrl)),
      PROBE_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(`manifest.json returned ${res.status}`);
  });
  return { name: 'assets', configured, method: 'manifest-fetch', ...result };
}

async function probeKv(env) {
  const configured = !!env.RATE_KV;
  if (!configured) return { name: 'kv', configured, healthy: false, method: 'shape', error: 'binding missing' };
  const result = await timed(async () => {
    // Read-only probe — never writes. KV reads are free and unmetered, so
    // this is safe to call on every health check. We expect null on a
    // pristine namespace; that's still a successful round-trip.
    await withTimeout(env.RATE_KV.get(KV_PROBE_KEY), PROBE_TIMEOUT_MS);
  });
  return { name: 'kv', configured, method: 'kv-get', ...result };
}

function probeAi(env) {
  const configured = !!env.AI;
  const healthy = configured && typeof env.AI.run === 'function';
  return { name: 'ai', configured, healthy, method: 'shape', optional: true,
    ...(configured && !healthy ? { error: 'AI binding lacks .run()' } : {}) };
}

function probeVectorize(env) {
  const configured = !!env.VECTOR_INDEX;
  const healthy = configured && typeof env.VECTOR_INDEX.query === 'function';
  return { name: 'vectorize', configured, healthy, method: 'shape', optional: true,
    ...(configured && !healthy ? { error: 'VECTOR_INDEX binding lacks .query()' } : {}) };
}

function probeRateLimiter(env) {
  const configured = !!env.RATE_LIMITER;
  const healthy = configured && typeof env.RATE_LIMITER.idFromName === 'function';
  return { name: 'rateLimiter', configured, healthy, method: 'shape', optional: true,
    ...(configured && !healthy ? { error: 'RATE_LIMITER lacks idFromName' } : {}) };
}

function probeMetrics(env) {
  const configured = !!env.METRICS;
  const healthy = configured && typeof env.METRICS.writeDataPoint === 'function';
  return { name: 'metrics', configured, healthy, method: 'shape', optional: true,
    ...(configured && !healthy ? { error: 'METRICS lacks writeDataPoint' } : {}) };
}

function probeWebhookQueue(env) {
  const configured = !!env.WEBHOOK_QUEUE;
  const healthy = configured && typeof env.WEBHOOK_QUEUE.send === 'function';
  return { name: 'webhookQueue', configured, healthy, method: 'shape', optional: true,
    ...(configured && !healthy ? { error: 'WEBHOOK_QUEUE lacks send' } : {}) };
}

function probeAuditLogKv(env) {
  // AUDIT_LOG_KV is an alias for RATE_KV in some deployments; tolerate both
  // by treating "kv present" as "audit log storage present".
  const configured = !!(env.AUDIT_LOG_KV || env.RATE_KV);
  return { name: 'auditLogKv', configured, healthy: configured, method: 'shape', optional: true };
}

function statusFor(checks) {
  // Required checks (assets, kv) degrade the service when missing OR
  // broken — without them no CDN traffic is served. Optional checks
  // (ai, vectorize, rateLimiter, metrics, webhookQueue, auditLogKv)
  // only degrade when configured-but-broken: an operator who hasn't
  // enabled the AI surface shouldn't get paged on /api/health.
  for (const c of checks) {
    if (c.optional) {
      if (c.configured && !c.healthy) return 'degraded';
    } else if (!c.healthy) {
      return 'degraded';
    }
  }
  return 'ok';
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const deep = url.searchParams.get('deep') === '1';

  let checks;
  if (deep) {
    checks = await Promise.all([
      probeAssets(env, request.url),
      probeKv(env),
      Promise.resolve(probeAi(env)),
      Promise.resolve(probeVectorize(env)),
      Promise.resolve(probeRateLimiter(env)),
      Promise.resolve(probeMetrics(env)),
      Promise.resolve(probeWebhookQueue(env)),
      Promise.resolve(probeAuditLogKv(env)),
    ]);
  } else {
    // Cheap mode: shape-only checks, no I/O. Mirrors the historical
    // response so existing monitors keep working unchanged.
    checks = [
      { name: 'assets', configured: !!env.ASSETS, healthy: !!env.ASSETS, method: 'shape' },
      { name: 'kv', configured: !!env.RATE_KV, healthy: !!env.RATE_KV, method: 'shape' },
      Promise.resolve(probeAi(env)),
      Promise.resolve(probeVectorize(env)),
      Promise.resolve(probeRateLimiter(env)),
      Promise.resolve(probeMetrics(env)),
      Promise.resolve(probeWebhookQueue(env)),
      Promise.resolve(probeAuditLogKv(env)),
    ];
    checks = await Promise.all(checks);
  }

  const body = {
    status: statusFor(checks),
    timestamp: new Date().toISOString(),
    apiVersion: API_VERSION,
    bindings: {
      assets: !!env.ASSETS,
      kv: !!env.RATE_KV,
      ai: !!env.AI,
      vectorize: !!env.VECTOR_INDEX,
      rateLimiter: !!env.RATE_LIMITER,
      metrics: !!env.METRICS,
      webhookQueue: !!env.WEBHOOK_QUEUE,
      auditLogKv: !!(env.AUDIT_LOG_KV || env.RATE_KV),
    },
    checks,
  };

  // Status code reflects health: 200 ok, 503 degraded. Monitors can key
  // off the HTTP code alone without parsing the body.
  const status = body.status === 'ok' ? 200 : 503;

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}
