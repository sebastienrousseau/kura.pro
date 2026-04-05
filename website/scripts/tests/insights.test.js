import { describe, it, expect, vi } from 'vitest';

const summaryMod = await import('../../../functions/api/insights/summary.js');
const topAssetsMod = await import('../../../functions/api/insights/top-assets.js');
const geoMod = await import('../../../functions/api/insights/geography.js');
const errorsMod = await import('../../../functions/api/insights/errors.js');

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

function makeCtx(url, options = {}) {
  const h = new Headers();
  if (options.key) h.set('AccountKey', options.key);
  if (options.accessKey) h.set('AccessKey', options.accessKey);
  return {
    request: { url: `https://cloudcdn.pro${url}`, headers: h },
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'acct-123',
      STORAGE_KEY: options.storageKey,
      RATE_KV: options.kv || makeKV({ hits: '50', bandwidth: '1048576', top: { '/a.svg': 10 }, geo: { US: 30, GB: 20 }, cache: { hit: 40, miss: 10 } }),
    },
  };
}

describe('Insights — Summary', () => {
  it('returns summary with ISO dates', async () => {
    const ctx = makeCtx('/api/insights/summary?days=3', { key: 'acct-123' });
    const res = await summaryMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.TotalRequests).toBeGreaterThanOrEqual(0);
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(json.Period.Days).toBe(3);
  });

  it('clamps days=0 to at least 1', async () => {
    const ctx = makeCtx('/api/insights/summary?days=0', { key: 'acct-123' });
    const res = await summaryMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Period.Days).toBeGreaterThanOrEqual(1);
  });

  it('clamps days=100 to at most 90', async () => {
    const ctx = makeCtx('/api/insights/summary?days=100', { key: 'acct-123' });
    const res = await summaryMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Period.Days).toBeLessThanOrEqual(90);
  });

  it('accepts AccessKey for auth', async () => {
    const ctx = makeCtx('/api/insights/summary', { accessKey: 'stor-key', storageKey: 'stor-key', accountKey: 'acct-123' });
    const res = await summaryMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('returns 401 without any key when auth is configured', async () => {
    const ctx = makeCtx('/api/insights/summary', { accountKey: 'real-key', storageKey: 'stor-key' });
    ctx.request.headers = new Headers(); // no key provided
    const res = await summaryMod.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

describe('Insights — Top Assets', () => {
  it('returns top assets sorted by requests', async () => {
    const kv = makeKV({ top: { '/logo.svg': 42, '/banner.png': 18 } });
    const ctx = makeCtx('/api/insights/top-assets?days=1&limit=10', { key: 'acct-123', kv });
    const res = await topAssetsMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Assets.length).toBeGreaterThan(0);
    expect(json.Assets[0].Requests).toBeGreaterThanOrEqual(json.Assets[json.Assets.length - 1]?.Requests || 0);
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('Insights — Geography', () => {
  it('returns country distribution', async () => {
    const kv = makeKV({ geo: { US: 100, GB: 50, DE: 30 } });
    const ctx = makeCtx('/api/insights/geography?days=1', { key: 'acct-123', kv });
    const res = await geoMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Countries.length).toBe(3);
    expect(json.Countries[0].CountryCode).toBe('US');
    expect(json.Countries[0].Requests).toBe(100);
  });
});

describe('Insights — Errors', () => {
  it('returns error breakdown when data exists', async () => {
    const kv = makeKV({ errors: { '404': { count: 5, paths: { '/missing.png': 3, '/gone.svg': 2 } }, '403': { count: 1, paths: { '/secret.pdf': 1 } } } });
    const ctx = makeCtx('/api/insights/errors?days=1', { key: 'acct-123', kv });
    const res = await errorsMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Errors.length).toBe(2);
    const notFound = json.Errors.find(e => e.StatusCode === 404);
    expect(notFound.Count).toBe(5);
    expect(notFound.TopPaths.length).toBeGreaterThan(0);
  });

  it('returns empty with note when no error data', async () => {
    const kv = makeKV({});
    const ctx = makeCtx('/api/insights/errors?days=1', { key: 'acct-123', kv });
    const res = await errorsMod.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Errors).toHaveLength(0);
  });
});

// --- Extended insights tests ---

describe('Insights — Summary extended', () => {
  it('returns summary with empty KV', async () => {
    const kv = makeKV({});
    const ctx = makeCtx('/api/insights/summary?days=1', { key: 'acct-123', kv });
    const res = await summaryMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.TotalRequests).toBe(0);
    expect(json.TotalBandwidth).toBe('0 B');
  });

  it('returns summary with max days (90)', async () => {
    const ctx = makeCtx('/api/insights/summary?days=90', { key: 'acct-123' });
    const res = await summaryMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Period.Days).toBeLessThanOrEqual(90);
  });
});

describe('Insights — Top Assets extended', () => {
  it('returns empty assets with empty KV', async () => {
    const kv = makeKV({});
    const ctx = makeCtx('/api/insights/top-assets?days=1', { key: 'acct-123', kv });
    const res = await topAssetsMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Assets).toHaveLength(0);
  });

  it('respects limit parameter', async () => {
    const kv = makeKV({ top: { '/a.svg': 10, '/b.png': 5, '/c.webp': 1 } });
    const ctx = makeCtx('/api/insights/top-assets?days=1&limit=2', { key: 'acct-123', kv });
    const res = await topAssetsMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Assets.length).toBeLessThanOrEqual(2);
  });

  it('returns 401 without auth', async () => {
    const ctx = makeCtx('/api/insights/top-assets?days=1', { accountKey: 'needed', storageKey: 'also' });
    const res = await topAssetsMod.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

describe('Insights — Geography extended', () => {
  it('returns empty with no geo data', async () => {
    const kv = makeKV({});
    const ctx = makeCtx('/api/insights/geography?days=1', { key: 'acct-123', kv });
    const res = await geoMod.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Countries).toHaveLength(0);
  });

  it('sorts countries by request count desc', async () => {
    const kv = makeKV({ geo: { DE: 10, US: 100, GB: 50 } });
    const ctx = makeCtx('/api/insights/geography?days=1', { key: 'acct-123', kv });
    const res = await geoMod.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Countries[0].CountryCode).toBe('US');
    expect(json.Countries[1].CountryCode).toBe('GB');
    expect(json.Countries[2].CountryCode).toBe('DE');
  });

  it('returns 401 without auth', async () => {
    const ctx = makeCtx('/api/insights/geography', { accountKey: 'needed', storageKey: 'also' });
    const res = await geoMod.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

describe('Insights — Errors extended', () => {
  it('returns 401 without auth', async () => {
    const ctx = makeCtx('/api/insights/errors', { accountKey: 'needed', storageKey: 'also' });
    const res = await errorsMod.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('returns errors with DateFetched', async () => {
    const kv = makeKV({ errors: { '404': { count: 1, paths: {} } } });
    const ctx = makeCtx('/api/insights/errors?days=1', { key: 'acct-123', kv });
    const res = await errorsMod.onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('errors response has CORS', async () => {
    const ctx = makeCtx('/api/insights/errors?days=1', { key: 'acct-123' });
    const res = await errorsMod.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns errors sorted by count desc', async () => {
    const kv = makeKV({ errors: { '500': { count: 20, paths: {} }, '404': { count: 50, paths: {} } } });
    const ctx = makeCtx('/api/insights/errors?days=1', { key: 'acct-123', kv });
    const res = await errorsMod.onRequestGet(ctx);
    const json = await res.json();
    if (json.Errors.length >= 2) {
      expect(json.Errors[0].Count).toBeGreaterThanOrEqual(json.Errors[1].Count);
    }
  });
});
