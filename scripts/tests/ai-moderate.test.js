import { describe, it, expect, vi, afterEach } from 'vitest';

const handlers = await import('../../functions/api/ai/moderate.js');
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
  method = 'POST', url, query = '',
  ip = '203.0.113.1', accountKey = 'acct-key',
  ai, kv, fetchMock,
} = {}) {
  const h = new Headers();
  if (accountKey) h.set('AccountKey', accountKey);
  h.set('cf-connecting-ip', ip);
  const init = { method, headers: h };
  if (method === 'POST' && url !== undefined) init.body = JSON.stringify({ url });
  if (fetchMock) globalThis.fetch = fetchMock;
  return {
    request: new Request(`https://cloudcdn.pro/api/ai/moderate${query}`, init),
    env: {
      ACCOUNT_KEY: 'acct-key',
      STORAGE_KEY: 'storage-key',
      AI: ai,
      RATE_KV: kv ?? makeKV(),
    },
  };
}

const TINY_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const SAFE_JSON = JSON.stringify({
  verdict: 'safe',
  categories: { nudity: 0, violence: 0, drugs: 0, hateSymbols: 0, gore: 0 },
  reasoning: 'A red square on a white background.',
});

describe('POST /api/ai/moderate', () => {
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

    it('returns 400 for malformed JSON body', async () => {
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/moderate', {
          method: 'POST', headers: h, body: '{not json',
        }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: {}, RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 when POST body parses but lacks url field', async () => {
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/moderate', {
          method: 'POST', headers: h, body: JSON.stringify({ notUrl: 'x' }),
        }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: { run: vi.fn() }, RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 for URL > 2048 chars', async () => {
      const ctx = makeCtx({ url: '/' + 'a'.repeat(2100) });
      expect((await onRequestPost(ctx)).status).toBe(400);
    });

    it('returns 400 for absolute and traversal URLs', async () => {
      for (const u of ['http://evil/x', 'https://evil/x', '/a/../b', '/a\0b', '//etc']) {
        const ctx = makeCtx({ url: u });
        expect((await onRequestPost(ctx)).status).toBe(400);
      }
    });

    it('returns 429 when rate-limited', async () => {
      const kv = makeKV({ 'rl:moderate:203.0.113.1': '9999' });
      const ctx = makeCtx({ url: '/x.png', kv });
      expect((await onRequestPost(ctx)).status).toBe(429);
    });

    it("falls back to 'unknown' bucket when cf-connecting-ip is missing", async () => {
      const kv = makeKV();
      const h = new Headers();
      h.set('AccountKey', 'acct-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/ai/moderate?url=/x.png', { method: 'GET', headers: h }),
        env: { ACCOUNT_KEY: 'acct-key', STORAGE_KEY: 'storage-key', AI: undefined, RATE_KV: kv },
      };
      await onRequestGet(ctx);
      expect(kv.put).toHaveBeenCalledWith('rl:moderate:unknown', expect.any(String), expect.any(Object));
    });
  });

  describe('happy path', () => {
    it('returns a clean safe verdict with structured categories', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: SAFE_JSON });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/clean.png', ai: { run: aiRun }, fetchMock });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.safe).toBe(true);
      expect(json.verdict).toBe('safe');
      expect(json.categories).toEqual({ nudity: 0, violence: 0, drugs: 0, hateSymbols: 0, gore: 0 });
      expect(json.reasoning).toContain('red square');
      expect(json.source).toBe('ai');
    });

    it('handles unsafe verdict with high category scores', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: JSON.stringify({
        verdict: 'unsafe',
        categories: { nudity: 0.95, violence: 0.1, drugs: 0, hateSymbols: 0, gore: 0 },
        reasoning: 'Explicit nudity present.',
      }) });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.safe).toBe(false);
      expect(json.verdict).toBe('unsafe');
      expect(json.categories.nudity).toBeGreaterThan(0.9);
    });

    it('borderline verdict returned for ambiguous content', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: JSON.stringify({
        verdict: 'borderline',
        categories: { nudity: 0.4, violence: 0, drugs: 0.3, hateSymbols: 0, gore: 0 },
        reasoning: 'Suggestive but not explicit.',
      }) });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('borderline');
      expect(json.safe).toBe(false);
    });

    it('extracts JSON from a response wrapped in markdown/prose', async () => {
      const wrapped = 'Here is the analysis:\n```json\n' + SAFE_JSON + '\n```\nThanks!';
      const aiRun = vi.fn().mockResolvedValue({ description: wrapped });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('safe');
    });

    it('clamps out-of-range category scores to [0, 1]', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: JSON.stringify({
        verdict: 'safe',
        categories: { nudity: -1, violence: 2, drugs: 'NaN', hateSymbols: 0.5, gore: null },
        reasoning: 'ok',
      }) });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.categories.nudity).toBe(0);
      expect(json.categories.violence).toBe(1);
      expect(json.categories.drugs).toBe(0);
      expect(json.categories.hateSymbols).toBe(0.5);
      expect(json.categories.gore).toBe(0);
    });

    it('truncates overlong reasoning to 240 chars', async () => {
      const long = 'A '.repeat(300);
      const aiRun = vi.fn().mockResolvedValue({ description: JSON.stringify({
        verdict: 'safe',
        categories: { nudity: 0, violence: 0, drugs: 0, hateSymbols: 0, gore: 0 },
        reasoning: long,
      }) });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.reasoning.length).toBeLessThanOrEqual(240);
    });

    it('handles plain-string AI response', async () => {
      const aiRun = vi.fn().mockResolvedValue(SAFE_JSON);
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('safe');
    });

    it('handles AI response with response field (not description)', async () => {
      // Exercises the second branch of `raw.description || raw.response || ...`
      const aiRun = vi.fn().mockResolvedValue({ response: SAFE_JSON });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('safe');
    });

    it('handles AI response with arbitrary object shape (JSON.stringify fallback)', async () => {
      // Object has neither description nor response; JSON.stringify({...}) still
      // produces a parseable JSON object the parser picks up.
      const aiRun = vi.fn().mockResolvedValue({
        verdict: 'safe',
        categories: { nudity: 0, violence: 0, drugs: 0, hateSymbols: 0, gore: 0 },
        reasoning: 'wrapped',
      });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('safe');
      expect(json.reasoning).toBe('wrapped');
    });

    it('falls back to borderline when AI returns null', async () => {
      const aiRun = vi.fn().mockResolvedValue(null);
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('borderline');
    });

    it('empties non-string reasoning fields', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: JSON.stringify({
        verdict: 'safe',
        categories: { nudity: 0, violence: 0, drugs: 0, hateSymbols: 0, gore: 0 },
        reasoning: { not: 'a string' },
      }) });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('safe');
      expect(json.reasoning).toBe('');
    });

    it('falls back to borderline on unparseable model output', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: 'totally unstructured response with no json' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('borderline');
      expect(json.safe).toBe(false);
      expect(json.reasoning).toContain('could not be parsed');
    });

    it('rejects responses with an unknown verdict label', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: JSON.stringify({
        verdict: 'sus', categories: {}, reasoning: 'x',
      }) });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      // Unknown verdict → parseModeration returns null → borderline fallback
      expect(json.verdict).toBe('borderline');
    });

    it('rejects malformed JSON inside the AI response', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: '{verdict: not-json}' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock });
      const json = await (await onRequestPost(ctx)).json();
      expect(json.verdict).toBe('borderline');
    });

    it('charges neurons after a successful call', async () => {
      const aiRun = vi.fn().mockResolvedValue({ description: SAFE_JSON });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      await onRequestPost(ctx);
      expect(kv.put.mock.calls.some((c) => c[0].startsWith('ai:neurons:'))).toBe(true);
    });
  });

  describe('budget + errors', () => {
    it('returns 503 when AI binding is missing', async () => {
      const ctx = makeCtx({ url: '/x.png' });
      expect((await onRequestPost(ctx)).status).toBe(503);
    });

    it('returns 503 when daily budget exhausted', async () => {
      const kv = makeKV({ [`ai:neurons:${new Date().toISOString().slice(0, 10)}`]: '99999' });
      const ctx = makeCtx({ url: '/x.png', ai: { run: vi.fn() }, kv });
      expect((await onRequestPost(ctx)).status).toBe(503);
    });

    it('trips circuit breaker on quota error', async () => {
      const quotaErr = Object.assign(new Error('429'), { status: 429 });
      const aiRun = vi.fn().mockRejectedValue(quotaErr);
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      expect((await onRequestPost(ctx)).status).toBe(503);
      expect(kv.put.mock.calls.some((c) => c[0] === 'ai:cb:open')).toBe(true);
    });

    it('returns 503 on transient AI failure without tripping breaker', async () => {
      const aiRun = vi.fn().mockRejectedValue(new Error('transient'));
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctx = makeCtx({ url: '/x.png', ai: { run: aiRun }, fetchMock, kv });
      expect((await onRequestPost(ctx)).status).toBe(503);
      expect(kv.put.mock.calls.some((c) => c[0] === 'ai:cb:open')).toBe(false);
    });

    it('returns 404 when origin returns 4xx', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
      const ctx = makeCtx({ url: '/missing.png', ai: { run: vi.fn() }, fetchMock });
      expect((await onRequestPost(ctx)).status).toBe(404);
    });

    it('returns 404 when origin asset exceeds size cap', async () => {
      const tooBig = new Uint8Array(9 * 1024 * 1024);
      const fetchMock = vi.fn().mockResolvedValue(new Response(tooBig, {
        status: 200, headers: { 'content-length': String(tooBig.byteLength) },
      }));
      const ctx = makeCtx({ url: '/huge.png', ai: { run: vi.fn() }, fetchMock });
      expect((await onRequestPost(ctx)).status).toBe(404);
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

    it('replays from cache without calling AI', async () => {
      globalThis.caches = fakeCacheBinding();
      const aiRun = vi.fn().mockResolvedValue({ description: SAFE_JSON });
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
      const kv = makeKV();
      const ctxA = makeCtx({ url: '/cached.png', ai: { run: aiRun }, fetchMock, kv });
      await onRequestPost(ctxA);
      expect(aiRun).toHaveBeenCalledTimes(1);

      const ctxB = makeCtx({ url: '/cached.png', ai: { run: vi.fn() }, fetchMock: vi.fn(), kv });
      const json = await (await onRequestPost(ctxB)).json();
      expect(json.source).toBe('cached');
      expect(json.degraded).toBe(true);
      expect(json.verdict).toBe('safe');
    });
  });
});

describe('GET /api/ai/moderate', () => {
  it('accepts url via query string', async () => {
    const aiRun = vi.fn().mockResolvedValue({ description: SAFE_JSON });
    const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_PNG, { status: 200 }));
    const ctx = makeCtx({ method: 'GET', query: '?url=/x.png', ai: { run: aiRun }, fetchMock });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });
});

describe('OPTIONS /api/ai/moderate', () => {
  it('returns 204 with CORS preflight', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});
