import { describe, it, expect, vi, afterEach } from 'vitest';

const handlers = await import('../../functions/api/ai/smart-crop.js');
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
  if (method === 'POST' && url !== undefined) init.body = JSON.stringify({ url });
  if (fetchMock) globalThis.fetch = fetchMock;
  return {
    request: new Request(`https://cloudcdn.pro/api/ai/smart-crop${query}`, init),
    env: {
      ACCOUNT_KEY: 'acct-key',
      STORAGE_KEY: 'storage-key',
      AI: ai,
      RATE_KV: kv ?? makeKV(),
    },
  };
}

const TINY_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe('POST /api/ai/smart-crop', () => {
  describe('auth and validation', () => {
    it('returns 401 with wrong AccountKey', async () => {
      const ctx = makeCtx({ url: '/x.png', accountKey: 'wrong' });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('returns 400 when url is missing', async () => {
      const ctx = makeCtx({ method: 'POST' });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 when POST body parses but lacks the url field', async () => {
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/smart-crop', {
          method: 'POST', headers: h, body: JSON.stringify({ notUrl: 'x' }),
        }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: { run: vi.fn() }, RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).Message.toLowerCase()).toContain('url');
    });

    it('returns 400 for malformed JSON body', async () => {
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/smart-crop', {
          method: 'POST', headers: h, body: '{not json',
        }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: {}, RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 for URL > 2048 chars', async () => {
      const ctx = makeCtx({ url: '/' + 'a'.repeat(2100) });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 for absolute and traversal URLs', async () => {
      for (const u of ['http://evil/x', 'https://evil/x', '/a/../b', '/a\0b', '//etc']) {
        const ctx = makeCtx({ url: u });
        const res = await onRequestPost(ctx);
        expect(res.status).toBe(400);
      }
    });

    it('returns 429 when the per-IP rate limit is exhausted', async () => {
      const kv = makeKV({ 'rl:smart-crop:203.0.113.1': '9999' });
      const ctx = makeCtx({ url: '/x.png', kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(429);
    });

    it("falls back to 'unknown' bucket when cf-connecting-ip is missing", async () => {
      const kv = makeKV();
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/smart-crop?url=/x.png', { method: 'GET', headers: h }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: undefined, RATE_KV: kv },
      };
      await onRequestGet(ctx);
      expect(kv.put).toHaveBeenCalledWith('rl:smart-crop:unknown', expect.any(String), expect.any(Object));
    });
  });

  describe('happy path', () => {
    it('returns an exact-token gravity with confidence=high', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: 'north' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.gravity).toBe('north');
      expect(json.confidence).toBe('high');
      expect(json.source).toBe('ai');
    });

    it('extracts gravity from a verbose sentence with confidence=medium', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: 'The subject is in the southeast corner.' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.gravity).toBe('southeast');
      expect(json.confidence).toBe('medium');
    });

    it('handles plain-string AI response', async () => {
      const aiRun = vi.fn().mockResolvedValue('face');
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/portrait.jpg', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.gravity).toBe('face');
    });

    it('falls back to center with confidence=low on unparseable output', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: 'gibberish blah 12345' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.gravity).toBe('center');
      expect(json.confidence).toBe('low');
      expect(json.source).toBe('ai');
    });

    it('falls back to center when model returns a non-string non-object payload', async () => {
      const aiRun = vi.fn().mockResolvedValue(42);
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.gravity).toBe('center');
      expect(json.confidence).toBe('low');
    });

    it('charges neurons after a successful call', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: 'east' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      await onRequestPost(ctx);
      const neuronCalls = kv.put.mock.calls.filter((c) => c[0].startsWith('ai:neurons:'));
      expect(neuronCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('caching', () => {
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

    it('replays from cache without calling AI again', async () => {
      const cache = fakeCacheBinding();
      globalThis.caches = cache;
      const aiRun = vi.fn().mockResolvedValue({ description: 'west' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctxA = makeCtx({ url: '/cached.png', ai: { run: aiRun }, fetchMock, kv });
      await onRequestPost(ctxA);
      expect(aiRun).toHaveBeenCalledTimes(1);

      const ctxB = makeCtx({ url: '/cached.png', ai: { run: vi.fn() }, fetchMock: vi.fn(), kv });
      const res = await onRequestPost(ctxB);
      const json = await res.json();
      expect(json.source).toBe('cached');
      expect(json.degraded).toBe(true);
      expect(json.gravity).toBe('west');
    });
  });

  describe('budget + error handling', () => {
    it('returns 503 when AI binding is missing', async () => {
      const ctx = makeCtx({ url: '/x.png' /* no ai */ });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(503);
    });

    it('returns 503 when the daily neuron budget is exhausted', async () => {
      const kv = makeKV({ [`ai:neurons:${new Date().toISOString().slice(0, 10)}`]: '99999' });
      const ctx = makeCtx({ url: '/x.png', ai: { run: vi.fn() }, kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(503);
    });

    it('trips the circuit breaker on AI quota errors', async () => {
      const quotaErr = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
      const aiRun = vi.fn().mockRejectedValue(quotaErr);
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(503);
      expect(kv.put.mock.calls.some((c) => c[0] === 'ai:cb:open')).toBe(true);
    });

    it('returns 503 on transient AI errors without tripping the breaker', async () => {
      const aiRun = vi.fn().mockRejectedValue(new Error('transient network'));
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(503);
      expect(kv.put.mock.calls.some((c) => c[0] === 'ai:cb:open')).toBe(false);
    });

    it('returns 404 when origin returns 4xx', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));
      const ctx = makeCtx({ url: '/missing.png', ai: { run: vi.fn() }, fetchMock });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(404);
    });

    it('returns 404 when origin asset exceeds the size cap', async () => {
      const tooBig = new Uint8Array(9 * 1024 * 1024);
      const fetchMock = vi.fn().mockResolvedValue(new Response(tooBig, {
        status: 200, headers: { 'content-length': String(tooBig.byteLength) },
      }));
      const ctx = makeCtx({ url: '/huge.png', ai: { run: vi.fn() }, fetchMock });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(404);
    });
  });
});

describe('GET /api/ai/smart-crop', () => {
  it('accepts url via query string', async () => {
    const aiRun = vi.fn().mockResolvedValue({ description: 'south' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
    const ctx = makeCtx({ method: 'GET', query: '?url=/x.png', ai: { run: aiRun }, fetchMock });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).gravity).toBe('south');
  });
});

describe('OPTIONS /api/ai/smart-crop', () => {
  it('returns 204 with CORS preflight', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});
