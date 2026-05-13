import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/insights/asset.js');

function makeKV(store = {}) {
  return {
    get: vi.fn(async (k) => store[k] ?? null),
    put: vi.fn(async () => undefined),
  };
}

function makeCtx({ query = '', accountKey, ip = '203.0.113.1', kv } = {}) {
  const h = new Headers();
  if (accountKey) h.set('AccountKey', accountKey);
  h.set('cf-connecting-ip', ip);
  return {
    request: new Request(`https://cloudcdn.pro/api/insights/asset${query}`, { headers: h }),
    env: {
      ACCOUNT_KEY: 'acct-secret',
      STORAGE_KEY: 'storage-secret', // forces fail-closed auth when no key sent
      RATE_KV: kv ?? makeKV(),
    },
  };
}

function dateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('GET /api/insights/asset', () => {
  describe('auth and validation', () => {
    it('returns 401 without an auth key', async () => {
      const res = await onRequestGet(makeCtx({ query: '?path=/x' }));
      expect(res.status).toBe(401);
    });

    it('returns 400 when path is missing', async () => {
      const res = await onRequestGet(makeCtx({ query: '', accountKey: 'acct-secret' }));
      expect(res.status).toBe(400);
      expect((await res.json()).Message).toContain('path');
    });

    it('returns 400 for an empty path parameter', async () => {
      const res = await onRequestGet(makeCtx({ query: '?path=', accountKey: 'acct-secret' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for a path > 2048 chars', async () => {
      const big = 'a'.repeat(2100);
      const res = await onRequestGet(makeCtx({ query: `?path=${big}`, accountKey: 'acct-secret' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for a path containing ..', async () => {
      const res = await onRequestGet(makeCtx({ query: '?path=/etc/..', accountKey: 'acct-secret' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for a path containing a null byte', async () => {
      const res = await onRequestGet(makeCtx({ query: '?path=/foo' + encodeURIComponent('\0') + 'bar', accountKey: 'acct-secret' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for a path containing //', async () => {
      const res = await onRequestGet(makeCtx({ query: '?path=//etc', accountKey: 'acct-secret' }));
      expect(res.status).toBe(400);
    });

    it('returns 503 when RATE_KV is missing', async () => {
      const ctx = makeCtx({ query: '?path=/x', accountKey: 'acct-secret' });
      ctx.env.RATE_KV = null;
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(503);
    });

    it('returns 429 when rate limit exhausted', async () => {
      const kv = makeKV({ [`rl:insights:203.0.113.1`]: '9999' });
      const res = await onRequestGet(makeCtx({ query: '?path=/x', accountKey: 'acct-secret', kv }));
      expect(res.status).toBe(429);
    });
  });

  describe('happy path', () => {
    it('returns daily totals for a known path', async () => {
      const path = 'clients/akande/v1/logos/logo.svg';
      const today = dateNDaysAgo(0);
      const yest = dateNDaysAgo(1);
      const kv = makeKV({
        [`analytics:top:${today}`]: JSON.stringify({ [path]: 12 }),
        [`analytics:top:${yest}`]:  JSON.stringify({ [path]: 30 }),
      });
      const res = await onRequestGet(makeCtx({ query: `?path=${path}&days=2`, accountKey: 'acct-secret', kv }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.Path).toBe(path);
      expect(json.TotalRequests).toBe(42);
      expect(json.Daily).toHaveLength(2);
      // Day index 0 is today.
      expect(json.Daily[0]).toMatchObject({ Date: today, Requests: 12 });
      expect(json.Daily[1]).toMatchObject({ Date: yest, Requests: 30 });
    });

    it('matches paths with or without a leading slash', async () => {
      const today = dateNDaysAgo(0);
      // Stored under a leading slash; query asks without.
      const kv = makeKV({
        [`analytics:top:${today}`]: JSON.stringify({ '/stocks/photo.webp': 8 }),
      });
      const res = await onRequestGet(makeCtx({
        query: '?path=stocks/photo.webp&days=1', accountKey: 'acct-secret', kv,
      }));
      const json = await res.json();
      expect(json.TotalRequests).toBe(8);
    });

    it('rolls up error counts per status code', async () => {
      const today = dateNDaysAgo(0);
      const kv = makeKV({
        [`analytics:errors:${today}`]: JSON.stringify({
          '404': { count: 5, paths: { 'clients/x.svg': 3, '/y': 7 } },
          '500': { count: 1, paths: { 'clients/x.svg': 1 } },
        }),
      });
      const res = await onRequestGet(makeCtx({
        query: '?path=clients/x.svg&days=1', accountKey: 'acct-secret', kv,
      }));
      const json = await res.json();
      expect(json.Errors).toEqual({ '404': 3, '500': 1 });
      expect(json.Daily[0].Errors).toEqual({ '404': 3, '500': 1 });
    });

    it('returns zeros for a path with no traffic', async () => {
      const today = dateNDaysAgo(0);
      const kv = makeKV({
        [`analytics:top:${today}`]: JSON.stringify({ 'other/asset.svg': 9 }),
      });
      const res = await onRequestGet(makeCtx({
        query: '?path=missing/asset.svg&days=1', accountKey: 'acct-secret', kv,
      }));
      const json = await res.json();
      expect(json.TotalRequests).toBe(0);
      expect(json.Daily[0].Requests).toBe(0);
      expect(json.Errors).toEqual({});
    });

    it('clamps days to [1, 90]', async () => {
      const kv = makeKV();
      const high = await onRequestGet(makeCtx({ query: '?path=/x&days=1000', accountKey: 'acct-secret', kv }));
      expect((await high.json()).Period.Days).toBe(90);

      const low = await onRequestGet(makeCtx({ query: '?path=/x&days=0', accountKey: 'acct-secret', kv }));
      expect((await low.json()).Period.Days).toBe(1);
    });

    it('survives malformed JSON in a KV bucket', async () => {
      const today = dateNDaysAgo(0);
      const kv = makeKV({
        [`analytics:top:${today}`]: '{not json',
        [`analytics:errors:${today}`]: '{also broken',
      });
      const res = await onRequestGet(makeCtx({
        query: '?path=/x&days=1', accountKey: 'acct-secret', kv,
      }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.TotalRequests).toBe(0);
    });

    it('returns DateFetched timestamp', async () => {
      const res = await onRequestGet(makeCtx({ query: '?path=/x&days=1', accountKey: 'acct-secret' }));
      const json = await res.json();
      expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("falls back to 'unknown' rate-limit bucket when cf-connecting-ip is absent", async () => {
      const h = new Headers();
      h.set('AccountKey', 'acct-secret');
      // No cf-connecting-ip — forces the `|| 'unknown'` fallback.
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/insights/asset?path=/x&days=1', { headers: h }),
        env: { ACCOUNT_KEY: 'acct-secret', STORAGE_KEY: 'storage-secret', RATE_KV: makeKV() },
      };
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(ctx.env.RATE_KV.put).toHaveBeenCalledWith('rl:insights:unknown', expect.any(String), expect.any(Object));
    });

    it('handles error entries with no paths field (defensive fallback)', async () => {
      const today = dateNDaysAgo(0);
      const kv = makeKV({
        // 404 entry with NO paths field — exercises `info?.paths || {}`
        [`analytics:errors:${today}`]: JSON.stringify({ '404': { count: 3 } }),
      });
      const res = await onRequestGet(makeCtx({ query: '?path=/x&days=1', accountKey: 'acct-secret', kv }));
      expect(res.status).toBe(200);
      const json = await res.json();
      // The asset has no per-path matches, so Errors is empty.
      expect(json.Errors).toEqual({});
    });
  });

  describe('OPTIONS', () => {
    it('returns 204 with CORS preflight headers', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('AccountKey');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });
});
