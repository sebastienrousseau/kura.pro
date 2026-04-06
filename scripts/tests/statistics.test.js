import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/core/statistics.js');

function makeKV(data = {}) {
  return {
    get: vi.fn().mockImplementation(key => {
      for (const [pattern, val] of Object.entries(data)) {
        if (key.includes(pattern)) return Promise.resolve(typeof val === 'string' ? val : JSON.stringify(val));
      }
      return Promise.resolve(null);
    }),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCtx(query = '', options = {}) {
  const h = new Headers();
  if (options.accountKey) h.set('AccountKey', options.accountKey);
  if (options.ip) h.set('cf-connecting-ip', options.ip);
  return {
    request: {
      url: `https://cloudcdn.pro/api/core/statistics${query}`,
      headers: h,
    },
    env: {
      ACCOUNT_KEY: options.envAccountKey ?? 'acct-123',
      RATE_KV: options.kv ?? makeKV({
        hits: '150',
        bandwidth: '2097152',
        top: { '/akande/logo.svg': 40, '/stocks/photo.webp': 60 },
        geo: { US: 80, DE: 30, JP: 20 },
        cache: { hit: 100, miss: 20 },
      }),
    },
  };
}

describe('Core Statistics API', () => {
  it('returns 401 without AccountKey', async () => {
    const ctx = makeCtx('', { envAccountKey: 'real' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('returns daily breakdown with summary', async () => {
    const ctx = makeCtx('?days=3', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Period.Days).toBe(3);
    expect(json.Daily).toBeInstanceOf(Array);
    expect(json.Daily.length).toBe(3);
    expect(json.Summary.TotalRequests).toBeGreaterThanOrEqual(0);
    expect(json.Summary.TotalBandwidthHuman).toBeDefined();
    expect(json.Summary.CacheHitRate).toBeDefined();
    expect(json.GeoDistribution).toBeInstanceOf(Array);
    expect(json.TopAssets).toBeInstanceOf(Array);
  });

  it('filters by zone when specified', async () => {
    const ctx = makeCtx('?days=1&zone=akande', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Zone).toBe('akande');
  });

  it('clamps days=0 to at least 1', async () => {
    const ctx = makeCtx('?days=0', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBeGreaterThanOrEqual(1);
  });

  it('clamps days=200 to at most 90', async () => {
    const ctx = makeCtx('?days=200', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBeLessThanOrEqual(90);
  });

  it('returns 503 when KV unavailable', async () => {
    const ctx = makeCtx('', { accountKey: 'acct-123' });
    ctx.env.RATE_KV = null;
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    const kv = makeKV({});
    kv.get = vi.fn().mockResolvedValue('60');
    const ctx = makeCtx('', { accountKey: 'acct-123', kv, ip: '1.2.3.4' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(429);
  });

  it('handles empty KV data gracefully', async () => {
    const kv = makeKV({});
    // Override get to return null for rate limit key (pass) then null for everything else
    let calls = 0;
    kv.get = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) return Promise.resolve('0'); // rate limit counter
      return Promise.resolve(null);
    });
    const ctx = makeCtx('?days=1', { accountKey: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Summary.TotalRequests).toBe(0);
  });

  it('allows access in dev mode (no ACCOUNT_KEY)', async () => {
    const ctx = makeCtx('');
    ctx.env.ACCOUNT_KEY = undefined;
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('OPTIONS returns 204', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('daily entries have BandwidthHuman field', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Daily[0]).toHaveProperty('BandwidthHuman');
    expect(json.Daily[0]).toHaveProperty('Date');
    expect(json.Daily[0]).toHaveProperty('CacheHit');
  });

  // --- Extended statistics tests ---

  it('OPTIONS has CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('GET response has CORS header', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('GET response has JSON Content-Type', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('Summary has all required fields', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Summary).toHaveProperty('TotalRequests');
    expect(json.Summary).toHaveProperty('TotalBandwidth');
    expect(json.Summary).toHaveProperty('CacheHitRate');
  });

  it('Period includes Days', async () => {
    const ctx = makeCtx('?days=3', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period).toHaveProperty('Days');
    expect(json.Period.Days).toBe(3);
  });

  it('Daily array matches requested days count', async () => {
    const ctx = makeCtx('?days=5', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Daily).toHaveLength(5);
  });

  it('Daily dates are in YYYY-MM-DD format', async () => {
    const ctx = makeCtx('?days=3', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    for (const day of json.Daily) {
      expect(day.Date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('clamps days below 1 to 1', async () => {
    const ctx = makeCtx('?days=0', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Daily.length).toBeGreaterThanOrEqual(1);
  });

  it('clamps days above 90 to 90', async () => {
    const ctx = makeCtx('?days=200', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Daily.length).toBeLessThanOrEqual(90);
  });

  it('defaults to 7 days when no param', async () => {
    const ctx = makeCtx('', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBe(7);
    expect(json.Daily).toHaveLength(7);
  });

  it('TopAssets is an array', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.TopAssets).toBeInstanceOf(Array);
  });

  it('GeoDistribution is an array', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.GeoDistribution).toBeInstanceOf(Array);
  });

  it('401 response has CORS', async () => {
    const ctx = makeCtx('?days=1');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
