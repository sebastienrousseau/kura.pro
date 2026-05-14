import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/health.js');

function makeAssets(ok = true) {
  return {
    fetch: vi.fn().mockResolvedValue(
      ok ? new Response('{}', { status: 200 }) : new Response('not found', { status: 404 })
    ),
  };
}

function makeKv(throwing = false) {
  return throwing
    ? { get: vi.fn().mockRejectedValue(new Error('kv offline')) }
    : { get: vi.fn().mockResolvedValue(null) };
}

function makeCtx({
  url = 'https://cloudcdn.pro/api/health',
  assets = makeAssets(true),
  kv = makeKv(),
  ai = { run: () => {} },
  vectorize = { query: () => {} },
  rateLimiter,
  metrics,
  webhookQueue,
  auditLogKv,
} = {}) {
  return {
    request: { url },
    env: {
      ASSETS: assets,
      RATE_KV: kv,
      AI: ai,
      VECTOR_INDEX: vectorize,
      ...(rateLimiter !== undefined ? { RATE_LIMITER: rateLimiter } : {}),
      ...(metrics !== undefined ? { METRICS: metrics } : {}),
      ...(webhookQueue !== undefined ? { WEBHOOK_QUEUE: webhookQueue } : {}),
      ...(auditLogKv !== undefined ? { AUDIT_LOG_KV: auditLogKv } : {}),
    },
  };
}

describe('GET /api/health (cheap mode)', () => {
  it('returns 200 with status ok when all required bindings are present', async () => {
    const res = await onRequestGet(makeCtx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
  });

  it('includes timestamp', async () => {
    const res = await onRequestGet(makeCtx());
    const json = await res.json();
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes apiVersion', async () => {
    const res = await onRequestGet(makeCtx());
    const json = await res.json();
    expect(json.apiVersion).toBeTruthy();
  });

  it('reports all bindings as available', async () => {
    const res = await onRequestGet(makeCtx());
    const json = await res.json();
    expect(json.bindings.assets).toBe(true);
    expect(json.bindings.kv).toBe(true);
    expect(json.bindings.ai).toBe(true);
    expect(json.bindings.vectorize).toBe(true);
  });

  it('reports missing optional bindings as false (still status=ok)', async () => {
    const res = await onRequestGet(makeCtx());
    const json = await res.json();
    expect(json.bindings.rateLimiter).toBe(false);
    expect(json.bindings.metrics).toBe(false);
    expect(json.bindings.webhookQueue).toBe(false);
    expect(json.status).toBe('ok');
  });

  it('keeps status=ok when optional bindings (ai, vectorize) are absent', async () => {
    const ctx = makeCtx({ ai: null, vectorize: null });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bindings.ai).toBe(false);
    expect(json.bindings.vectorize).toBe(false);
    expect(json.status).toBe('ok');
  });

  it('flips status to degraded (503) when ASSETS is absent (required)', async () => {
    const ctx = makeCtx({ assets: null });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.bindings.assets).toBe(false);
    expect(json.status).toBe('degraded');
  });

  it('flips status to degraded (503) when KV is absent (required)', async () => {
    const ctx = makeCtx({ kv: null });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.bindings.kv).toBe(false);
    expect(json.status).toBe('degraded');
  });

  it('does NOT probe ASSETS or KV in cheap mode (no I/O)', async () => {
    const ctx = makeCtx();
    await onRequestGet(ctx);
    expect(ctx.env.ASSETS.fetch).not.toHaveBeenCalled();
    expect(ctx.env.RATE_KV.get).not.toHaveBeenCalled();
  });

  it('has CORS header', async () => {
    const res = await onRequestGet(makeCtx());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('has no-cache header', async () => {
    const res = await onRequestGet(makeCtx());
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store');
  });

  it('returns JSON content type', async () => {
    const res = await onRequestGet(makeCtx());
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('GET /api/health?deep=1', () => {
  it('exercises ASSETS by fetching /manifest.json', async () => {
    const ctx = makeCtx({ url: 'https://cloudcdn.pro/api/health?deep=1' });
    await onRequestGet(ctx);
    expect(ctx.env.ASSETS.fetch).toHaveBeenCalled();
    const fetchUrl = ctx.env.ASSETS.fetch.mock.calls[0][0];
    expect(fetchUrl.toString()).toContain('/manifest.json');
  });

  it('exercises KV by calling .get() on the probe key', async () => {
    const ctx = makeCtx({ url: 'https://cloudcdn.pro/api/health?deep=1' });
    await onRequestGet(ctx);
    expect(ctx.env.RATE_KV.get).toHaveBeenCalledWith('health:probe');
  });

  it('reports KV probe failure as unhealthy and flips overall status to degraded (503)', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      kv: makeKv(true),
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    const kvCheck = json.checks.find((c) => c.name === 'kv');
    expect(kvCheck.healthy).toBe(false);
    expect(kvCheck.error).toContain('kv offline');
  });

  it('reports manifest fetch failure as unhealthy', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      assets: makeAssets(false),
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    const assetsCheck = json.checks.find((c) => c.name === 'assets');
    expect(assetsCheck.healthy).toBe(false);
    expect(assetsCheck.error).toContain('404');
  });

  it('flags AI binding with wrong shape as unhealthy', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      ai: { /* no run() */ },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    const aiCheck = json.checks.find((c) => c.name === 'ai');
    expect(aiCheck.healthy).toBe(false);
    expect(aiCheck.error).toContain('lacks .run');
  });

  it('reports configured optional bindings as healthy when shape is correct', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      rateLimiter: { idFromName: () => {} },
      metrics: { writeDataPoint: () => {} },
      webhookQueue: { send: () => {} },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bindings.rateLimiter).toBe(true);
    expect(json.bindings.metrics).toBe(true);
    expect(json.bindings.webhookQueue).toBe(true);
    expect(json.checks.find((c) => c.name === 'rateLimiter').healthy).toBe(true);
    expect(json.checks.find((c) => c.name === 'metrics').healthy).toBe(true);
    expect(json.checks.find((c) => c.name === 'webhookQueue').healthy).toBe(true);
  });

  it('flags an optional binding with wrong shape as unhealthy (still status=degraded)', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      rateLimiter: { /* no idFromName() */ },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    const rl = json.checks.find((c) => c.name === 'rateLimiter');
    expect(rl.healthy).toBe(false);
    expect(rl.error).toContain('idFromName');
  });

  it('flags VECTOR_INDEX with wrong shape as unhealthy', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      vectorize: { /* no query() */ },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    const v = json.checks.find((c) => c.name === 'vectorize');
    expect(v.healthy).toBe(false);
    expect(v.error).toContain('.query()');
  });

  it('flags METRICS with wrong shape as unhealthy', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      metrics: { /* no writeDataPoint() */ },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    const m = json.checks.find((c) => c.name === 'metrics');
    expect(m.healthy).toBe(false);
    expect(m.error).toContain('writeDataPoint');
  });

  it('flags WEBHOOK_QUEUE with wrong shape as unhealthy', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      webhookQueue: { /* no send() */ },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    const w = json.checks.find((c) => c.name === 'webhookQueue');
    expect(w.healthy).toBe(false);
    expect(w.error).toContain('send');
  });

  it('falls back to String(err) when a thrown value has no .message', async () => {
    // Tests the `err?.message || String(err)` branch in the timed() helper —
    // the KV-rejection test elsewhere covers err.message; this covers the
    // fallback for non-Error throws.
    const kv = {
      get: vi.fn().mockImplementation(() => { throw 'kv string error'; }),
    };
    const ctx = makeCtx({ url: 'https://cloudcdn.pro/api/health?deep=1', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    const kvCheck = json.checks.find((c) => c.name === 'kv');
    expect(kvCheck.healthy).toBe(false);
    expect(kvCheck.error).toBe('kv string error');
  });

  it('reports latencyMs for probes that hit I/O', async () => {
    const ctx = makeCtx({ url: 'https://cloudcdn.pro/api/health?deep=1' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    const assetsCheck = json.checks.find((c) => c.name === 'assets');
    expect(typeof assetsCheck.latencyMs).toBe('number');
    expect(assetsCheck.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('treats AUDIT_LOG_KV as an alias for RATE_KV', async () => {
    // When AUDIT_LOG_KV isn't set, auditLogKv presence falls back to RATE_KV.
    const ctx = makeCtx({ url: 'https://cloudcdn.pro/api/health?deep=1' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.bindings.auditLogKv).toBe(true);
  });

  it('flags assets-missing as degraded with a clear error', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      assets: null,
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.bindings.assets).toBe(false);
    const ac = json.checks.find((c) => c.name === 'assets');
    expect(ac.healthy).toBe(false);
    expect(ac.error).toContain('binding missing');
  });

  it('flags kv-missing as degraded', async () => {
    const ctx = makeCtx({
      url: 'https://cloudcdn.pro/api/health?deep=1',
      kv: null,
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.bindings.kv).toBe(false);
    expect(json.bindings.auditLogKv).toBe(false);
  });
});

describe('OPTIONS /api/health', () => {
  it('returns 204', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });
});
