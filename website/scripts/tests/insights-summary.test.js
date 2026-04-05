import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../../functions/api/insights/summary.js');

function makeKV(data = {}) {
  return {
    get: vi.fn().mockImplementation(key => {
      for (const [pattern, val] of Object.entries(data)) {
        if (key.includes(pattern)) return Promise.resolve(typeof val === 'string' ? val : JSON.stringify(val));
      }
      return Promise.resolve(null);
    }),
  };
}

function makeCtx(query = '', options = {}) {
  const h = new Headers();
  if (options.key) h.set('AccountKey', options.key);
  if (options.accessKey) h.set('AccessKey', options.accessKey);
  return {
    request: { url: `https://cloudcdn.pro/api/insights/summary${query}`, headers: h },
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'acct-123',
      STORAGE_KEY: options.storageKey,
      RATE_KV: options.kv ?? makeKV({
        hits: '200',
        bandwidth: '5242880',
        geo: { US: 100, GB: 50 },
        cache: { hit: 160, miss: 40 },
        top: { '/akande/logo.svg': 80, '/stocks/photo.webp': 120 },
      }),
    },
  };
}

describe('Insights — Summary', () => {
  it('returns 401 without auth when configured', async () => {
    const ctx = makeCtx('', { accountKey: 'real', storageKey: 'stor-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('returns summary stats with all fields', async () => {
    const ctx = makeCtx('?days=3', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Period.Days).toBe(3);
    expect(json.TotalRequests).toBeGreaterThanOrEqual(0);
    expect(json.TotalBandwidth).toBeDefined();
    expect(json.TotalBandwidthBytes).toBeGreaterThanOrEqual(0);
    expect(json.UniqueCountries).toBeGreaterThanOrEqual(0);
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('filters by zone when specified', async () => {
    const ctx = makeCtx('?days=1&zone=akande', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Zone).toBe('akande');
  });

  it('returns "all" zone when no filter', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Zone).toBe('all');
  });

  it('formats bandwidth as human-readable string', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(typeof json.TotalBandwidth).toBe('string');
  });

  it('calculates cache ratio correctly', async () => {
    const kv = makeKV({
      hits: '100',
      bandwidth: '1024',
      cache: { hit: 80, miss: 20 },
      geo: {},
      top: {},
    });
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.CacheHitRate).toBe('80.0%');
  });

  it('returns N/A cache ratio when no cache data', async () => {
    const kv = makeKV({});
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.CacheHitRate).toBe('N/A');
  });

  it('clamps days=0 to at least 1', async () => {
    const ctx = makeCtx('?days=0', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBeGreaterThanOrEqual(1);
  });

  it('clamps days=100 to at most 90', async () => {
    const ctx = makeCtx('?days=100', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBeLessThanOrEqual(90);
  });

  it('returns 503 when KV unavailable', async () => {
    const ctx = makeCtx('', { key: 'acct-123' });
    ctx.env.RATE_KV = null;
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
  });

  it('accepts AccessKey for auth', async () => {
    const ctx = makeCtx('?days=1', { accessKey: 'stor-key', storageKey: 'stor-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('OPTIONS returns 204', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('OPTIONS has CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('GET has Content-Type JSON', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('GET has CORS header', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('includes DateFetched in response', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes TotalBandwidth field', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json).toHaveProperty('TotalBandwidth');
  });

  it('includes CacheHitRate field', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json).toHaveProperty('CacheHitRate');
  });

  it('401 response has CORS', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'needed', storageKey: 'also' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('defaults to 7 days when no param', async () => {
    const ctx = makeCtx('', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBe(7);
  });
});
