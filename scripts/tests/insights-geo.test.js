import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/insights/geography.js');

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
    request: { url: `https://cloudcdn.pro/api/insights/geography${query}`, headers: h },
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'acct-123',
      STORAGE_KEY: options.storageKey,
      RATE_KV: options.kv ?? makeKV({
        geo: { US: 100, GB: 50, DE: 30, JP: 10 },
      }),
    },
  };
}

describe('Insights — Geography', () => {
  it('returns 401 without auth', async () => {
    const ctx = makeCtx('', { accountKey: 'real', storageKey: 'stor-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('returns country distribution sorted by request count', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Countries.length).toBe(4);
    expect(json.Countries[0].CountryCode).toBe('US');
    expect(json.Countries[0].Requests).toBe(100);
    expect(json.Countries[1].Requests).toBeGreaterThanOrEqual(json.Countries[2].Requests);
  });

  it('returns empty countries when no geo data', async () => {
    const kv = makeKV({});
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Countries).toHaveLength(0);
  });

  it('clamps days=0 to at least 1', async () => {
    const ctx = makeCtx('?days=0', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBeGreaterThanOrEqual(1);
  });

  it('clamps days=999 to at most 90', async () => {
    const ctx = makeCtx('?days=999', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBeLessThanOrEqual(90);
  });

  it('merges geo data across multiple days', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('geo')) {
          return Promise.resolve(JSON.stringify({ US: 20, GB: 10 }));
        }
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=3', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    const us = json.Countries.find(c => c.CountryCode === 'US');
    expect(us.Requests).toBe(60); // 20 * 3 days
  });

  it('accepts AccessKey for auth', async () => {
    const ctx = makeCtx('?days=1', { accessKey: 'stor-key', storageKey: 'stor-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('returns 503 when KV unavailable', async () => {
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

  it('Countries have CountryCode and Requests', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('geo')) return Promise.resolve(JSON.stringify({ US: 10, DE: 5 }));
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    for (const country of json.Countries) {
      expect(country).toHaveProperty('CountryCode');
      expect(country).toHaveProperty('Requests');
      expect(typeof country.Requests).toBe('number');
    }
  });

  it('Countries sorted by Requests desc', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('geo')) return Promise.resolve(JSON.stringify({ DE: 5, US: 50, GB: 20 }));
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    for (let i = 1; i < json.Countries.length; i++) {
      expect(json.Countries[i - 1].Requests).toBeGreaterThanOrEqual(json.Countries[i].Requests);
    }
  });

  it('401 has CORS', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'needed', storageKey: 'also' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('empty KV returns empty Countries array', async () => {
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Countries).toEqual([]);
  });
});
