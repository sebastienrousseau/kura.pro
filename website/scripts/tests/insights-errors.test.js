import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../../functions/api/insights/errors.js');

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
    request: { url: `https://cloudcdn.pro/api/insights/errors${query}`, headers: h },
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'acct-123',
      STORAGE_KEY: options.storageKey,
      RATE_KV: options.kv ?? makeKV({
        errors: { '404': { count: 12, paths: { '/missing.png': 8, '/gone.svg': 4 } }, '500': { count: 3, paths: { '/broken.js': 3 } } },
      }),
    },
  };
}

describe('Insights — Errors', () => {
  it('returns 401 without any auth key', async () => {
    const ctx = makeCtx('', { accountKey: 'real', storageKey: 'stor-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('returns error breakdown by status code', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Errors.length).toBe(2);
    const notFound = json.Errors.find(e => e.StatusCode === 404);
    expect(notFound.Count).toBe(12);
    expect(notFound.TopPaths.length).toBeGreaterThan(0);
  });

  it('returns top paths sorted by count', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    const notFound = json.Errors.find(e => e.StatusCode === 404);
    expect(notFound.TopPaths[0].Count).toBeGreaterThanOrEqual(notFound.TopPaths[1].Count);
  });

  it('returns empty errors with note when no data', async () => {
    const kv = makeKV({});
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Errors).toHaveLength(0);
    expect(json.Note).toBeDefined();
  });

  it('clamps days=0 to at least 1', async () => {
    const ctx = makeCtx('?days=0', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBeGreaterThanOrEqual(1);
  });

  it('clamps days=200 to at most 90', async () => {
    const ctx = makeCtx('?days=200', { key: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Days).toBeLessThanOrEqual(90);
  });

  it('accepts AccessKey for auth', async () => {
    const ctx = makeCtx('?days=1', { accessKey: 'stor-key', storageKey: 'stor-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('returns 503 when KV is unavailable', async () => {
    const ctx = makeCtx('?days=1', { key: 'acct-123' });
    ctx.env.RATE_KV = null;
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
  });

  it('merges error data across multiple days', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('errors')) {
          return Promise.resolve(JSON.stringify({ '404': { count: 5, paths: { '/a.png': 5 } } }));
        }
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=3', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    const notFound = json.Errors.find(e => e.StatusCode === 404);
    expect(notFound.Count).toBe(15); // 5 * 3 days
  });

  it('includes DateFetched in response', async () => {
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

  it('Errors sorted by Count desc', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('errors')) {
          return Promise.resolve(JSON.stringify({
            '404': { count: 50, paths: {} },
            '500': { count: 10, paths: {} },
            '403': { count: 30, paths: {} },
          }));
        }
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    for (let i = 1; i < json.Errors.length; i++) {
      expect(json.Errors[i - 1].Count).toBeGreaterThanOrEqual(json.Errors[i].Count);
    }
  });

  it('Error entries have StatusCode and Count', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('errors')) return Promise.resolve(JSON.stringify({ '404': { count: 5, paths: {} } }));
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    for (const err of json.Errors) {
      expect(err).toHaveProperty('StatusCode');
      expect(err).toHaveProperty('Count');
      expect(typeof err.StatusCode).toBe('number');
    }
  });

  it('401 has CORS', async () => {
    const ctx = makeCtx('?days=1', { accountKey: 'needed', storageKey: 'also' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('empty errors data returns empty Errors array', async () => {
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Errors).toEqual([]);
  });

  it('TopPaths present in error entries', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('errors')) return Promise.resolve(JSON.stringify({ '404': { count: 5, paths: { '/a.png': 3, '/b.png': 2 } } }));
        return Promise.resolve(null);
      }),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = makeCtx('?days=1', { key: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    const notFound = json.Errors.find(e => e.StatusCode === 404);
    expect(notFound.TopPaths).toBeInstanceOf(Array);
    expect(notFound.TopPaths.length).toBeGreaterThan(0);
  });
});
