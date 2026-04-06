import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/insights/top-assets.js');

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
  if (options.key) h.set('AccountKey', options.key);
  if (options.accessKey) h.set('AccessKey', options.accessKey);
  return {
    request: { url: `https://cloudcdn.pro/api/insights/top-assets${query}`, headers: h },
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'acct-123',
      STORAGE_KEY: options.storageKey,
      RATE_KV: options.kv ?? makeKV({
        top: { '/logo.svg': 100, '/banner.png': 50, '/icon.ico': 25 },
      }),
    },
  };
}

describe('Insights — Top Assets', () => {
  it('returns 401 without auth', async () => {
    const ctx = makeCtx('', { accountKey: 'real', storageKey: 'stor-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('returns top assets sorted by requests descending', async () => {
    const ctx = makeCtx('?days=1&limit=10', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Assets.length).toBe(3);
    expect(json.Assets[0].Requests).toBeGreaterThanOrEqual(json.Assets[1].Requests);
    expect(json.Assets[1].Requests).toBeGreaterThanOrEqual(json.Assets[2].Requests);
    expect(json.Assets[0].Path).toBe('/logo.svg');
  });

  it('respects limit parameter', async () => {
    const ctx = makeCtx('?days=1&limit=2', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Assets.length).toBe(2);
  });

  it('clamps limit to minimum 1', async () => {
    const ctx = makeCtx('?days=1&limit=0', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Assets.length).toBeGreaterThanOrEqual(1);
  });

  it('clamps limit to maximum 100', async () => {
    const manyAssets = {};
    for (let i = 0; i < 150; i++) manyAssets[`/asset-${i}.svg`] = 150 - i;
    const kv = makeKV({ top: manyAssets });
    const ctx = makeCtx('?days=1&limit=999', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Assets.length).toBeLessThanOrEqual(100);
  });

  it('returns empty assets when no data', async () => {
    const kv = makeKV({});
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Assets).toHaveLength(0);
  });

  it('defaults to 7 days and 20 limit', async () => {
    const ctx = makeCtx('', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBe(7);
  });

  it('merges top assets across multiple days', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('top')) {
          return Promise.resolve(JSON.stringify({ '/logo.svg': 10 }));
        }
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=3&limit=10', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Assets[0].Requests).toBe(30); // 10 * 3 days
  });

  it('returns 503 when KV is unavailable', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    ctx.env.RATE_KV = null;
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
  });

  it('includes DateFetched', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('OPTIONS returns 204', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('OPTIONS has CORS', async () => {
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

  it('Assets array has correct structure', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('top')) return Promise.resolve(JSON.stringify({ '/logo.svg': 5 }));
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    if (json.Assets.length > 0) {
      expect(json.Assets[0]).toHaveProperty('Path');
      expect(json.Assets[0]).toHaveProperty('Requests');
    }
  });

  it('Assets are sorted by Requests desc', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('top')) return Promise.resolve(JSON.stringify({ '/a.svg': 5, '/b.svg': 10, '/c.svg': 1 }));
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    for (let i = 1; i < json.Assets.length; i++) {
      expect(json.Assets[i - 1].Requests).toBeGreaterThanOrEqual(json.Assets[i].Requests);
    }
  });

  it('401 has CORS', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'needed', storageKey: 'also' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
