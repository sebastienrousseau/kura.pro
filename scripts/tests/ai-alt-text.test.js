import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const handlers = await import('../../functions/api/ai/alt-text.js');
const { onRequestGet, onRequestPost, onRequestOptions } = handlers;

const originalFetch = globalThis.fetch;
const priorCaches = globalThis.caches;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.caches = priorCaches;
});

function makeKV(initial = {}) {
  const store = { ...initial };
  return {
    _store: store,
    get: vi.fn(async (k) => store[k] ?? null),
    put: vi.fn(async (k, v) => { store[k] = v; }),
  };
}

function fakeCacheBinding(store = new Map()) {
  return {
    default: {
      match: vi.fn(async (req) => {
        const u = typeof req === 'string' ? req : req.url;
        return store.has(u)
          ? new Response(store.get(u), { headers: { 'Content-Type': 'application/json' } })
          : undefined;
      }),
      put: vi.fn(async (req, res) => {
        const u = typeof req === 'string' ? req : req.url;
        store.set(u, await res.text());
      }),
    },
    _store: store,
  };
}

function makeCtx({
  method = 'POST',
  url,
  query = '',
  ip = '203.0.113.1',
  accountKey = 'acct-key',
  ai,
  kv,
  fetchMock,
} = {}) {
  const h = new Headers();
  if (accountKey) h.set('AccountKey', accountKey);
  h.set('cf-connecting-ip', ip);

  const init = { method, headers: h };
  if (method === 'POST' && url !== undefined) {
    init.body = JSON.stringify({ url });
  }

  if (fetchMock) globalThis.fetch = fetchMock;

  return {
    request: new Request(`https://cloudcdn.pro/api/ai/alt-text${query}`, init),
    env: {
      ACCOUNT_KEY: 'acct-key',
      STORAGE_KEY: 'storage-key',
      AI: ai,
      RATE_KV: kv ?? makeKV(),
    },
  };
}

const TINY_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe('POST /api/ai/alt-text', () => {
  describe('auth and validation', () => {
    it('returns 401 without auth', async () => {
      // Pass a *wrong* AccountKey so the fallback default doesn't kick in.
      const ctx = makeCtx({ url: '/x.png', accountKey: 'wrong-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('returns 400 when url is missing (POST)', async () => {
      const ctx = makeCtx({ method: 'POST' });
      // Empty body — JSON.parse succeeds but url is undefined.
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 for malformed JSON body', async () => {
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/alt-text', {
          method: 'POST', headers: h, body: '{not json',
        }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: {}, RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 for URL > 2048 chars', async () => {
      const big = 'a'.repeat(2100);
      const ctx = makeCtx({ url: '/' + big });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 for absolute URLs (SSRF)', async () => {
      for (const u of ['http://evil.com/x.png', 'https://evil.com/x.png']) {
        const ctx = makeCtx({ url: u });
        const res = await onRequestPost(ctx);
        expect(res.status).toBe(400);
      }
    });

    it('returns 400 for paths with .. / \\0 / //', async () => {
      for (const u of ['/a/../etc', '/a\0b', '//etc']) {
        const ctx = makeCtx({ url: u });
        const res = await onRequestPost(ctx);
        expect(res.status).toBe(400);
      }
    });

    it('returns 400 when POST body has no url field', async () => {
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/alt-text', {
          method: 'POST', headers: h, body: JSON.stringify({ notUrl: 'x' }),
        }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: { run: vi.fn() }, RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).Message.toLowerCase()).toContain('url');
    });

    it("falls back to 'unknown' rate-limit bucket when cf-connecting-ip is missing", async () => {
      const kv = makeKV();
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/alt-text?url=/x.png', { method: 'GET', headers: h }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: undefined, RATE_KV: kv },
      };
      // Will 503 due to no AI binding, but that's fine — we're checking
      // the rate-limit key landed before that.
      await onRequestGet(ctx);
      expect(kv.put).toHaveBeenCalledWith('rl:alt-text:unknown', expect.any(String), expect.any(Object));
    });

    it('returns 429 when the per-IP rate limit is exhausted', async () => {
      const kv = makeKV({ 'rl:alt-text:203.0.113.1': '9999' });
      const ctx = makeCtx({ url: '/x.png', kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(429);
    });
  });

  describe('happy path', () => {
    it('returns AI-generated alt text on a successful run', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: 'A red square on a white background.' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200, headers: { 'content-length': '8' } }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toBe('/x.png');
      expect(json.alt).toBe('A red square on a white background.');
      expect(json.source).toBe('ai');
      expect(json.degraded).toBe(false);
      expect(json.model).toContain('llava');
    });

    it('strips surrounding quotes from the AI response', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: '"A blue circle."' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.alt).toBe('A blue circle.');
    });

    it('truncates overlong descriptions to 160 chars', async () => {
      const long = 'A '.repeat(200);
      const aiRun = vi.fn().mockResolvedValue({ description: long });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.alt.length).toBeLessThanOrEqual(160);
      expect(json.alt.endsWith('...')).toBe(true);
    });

    it('falls back to response or string when description is missing', async () => {
      const aiRun = vi.fn().mockResolvedValue({ response: 'Fallback string field.' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.alt).toBe('Fallback string field.');
    });

    it('accepts a plain string AI response (legacy shape)', async () => {
      const aiRun = vi.fn().mockResolvedValue('A green hexagon.');
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.alt).toBe('A green hexagon.');
    });

    it('returns 502 when the model produces empty text', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: '   ' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(502);
    });

    it('returns 502 when the model returns a non-string non-object payload', async () => {
      // Forces trimAlt to hit the `typeof text !== 'string'` early-return.
      // aiResult is the number 42; ?.description and ?.response are both
      // undefined; the third || branch is 42 itself.
      const aiRun = vi.fn().mockResolvedValue(42);
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(502);
    });

    it('charges neurons after a successful run', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: 'ok' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      await onRequestPost(ctx);
      const neuronCalls = kv.put.mock.calls.filter((c) => c[0].startsWith('ai:neurons:'));
      expect(neuronCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('caching', () => {
    it('replays from cache without calling AI', async () => {
      const cache = fakeCacheBinding();
      globalThis.caches = cache;
      // Pre-warm the cache with the exact key shape the endpoint computes.
      // Simpler: do a first AI call and then a second request with no AI.
      const aiRun = vi.fn().mockResolvedValue({ description: 'cached candidate' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctxA = makeCtx({ url: '/cached.png', ai: { run: aiRun }, fetchMock, kv });
      await onRequestPost(ctxA);
      expect(aiRun).toHaveBeenCalledTimes(1);

      // Second request — fetch mock returns empty so AI cannot read bytes,
      // but the cache should short-circuit before that.
      const aiRun2 = vi.fn();
      const ctxB = makeCtx({ url: '/cached.png', ai: { run: aiRun2 }, fetchMock: vi.fn(), kv });
      const res = await onRequestPost(ctxB);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.source).toBe('cached');
      expect(json.degraded).toBe(true);
      expect(json.alt).toBe('cached candidate');
      expect(aiRun2).not.toHaveBeenCalled();
    });
  });

  describe('budget + error handling', () => {
    it('returns 503 when AI binding is missing', async () => {
      const ctx = makeCtx({ url: '/x.png' /* no ai */ });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(503);
    });

    it('returns 503 when the neuron budget is exhausted', async () => {
      const kv = makeKV({ [`ai:neurons:${new Date().toISOString().slice(0, 10)}`]: '99999' });
      const aiRun = vi.fn();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(503);
      expect(aiRun).not.toHaveBeenCalled();
    });

    it('returns 503 and trips the circuit breaker on AI quota errors', async () => {
      const quotaErr = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
      const aiRun = vi.fn().mockRejectedValue(quotaErr);
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(503);
      expect(kv.put.mock.calls.some((c) => c[0] === 'ai:cb:open')).toBe(true);
    });

    it('returns 503 on transient AI failures without tripping the breaker', async () => {
      const aiRun = vi.fn().mockRejectedValue(new Error('transient network'));
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(503);
      expect(kv.put.mock.calls.some((c) => c[0] === 'ai:cb:open')).toBe(false);
    });

    it('returns 404 when the origin fetch fails', async () => {
      const aiRun = vi.fn();
      const fetchMock = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));
      const ctx = makeCtx({ url: '/missing.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(404);
      expect(aiRun).not.toHaveBeenCalled();
    });

    it('returns 404 when the origin asset is too large for the model', async () => {
      const tooBig = new Uint8Array(9 * 1024 * 1024);
      const aiRun = vi.fn();
      const fetchMock = vi.fn().mockResolvedValue(new Response(tooBig, {
        status: 200, headers: { 'content-length': String(tooBig.byteLength) },
      }));
      const ctx = makeCtx({ url: '/huge.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(404);
      expect(aiRun).not.toHaveBeenCalled();
    });
  });
});

describe('GET /api/ai/alt-text', () => {
  it('accepts url via query string', async () => {
    const aiRun = vi.fn().mockResolvedValue({ description: 'ok' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
    const ctx = makeCtx({ method: 'GET', query: '?url=/x.png', ai: { run: aiRun }, fetchMock });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });
});

describe('OPTIONS /api/ai/alt-text', () => {
  it('returns 204 with the expected CORS preflight', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});
