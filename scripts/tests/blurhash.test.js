import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/blurhash.js');

const originalFetch = globalThis.fetch;
const priorCaches = globalThis.caches;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.caches = priorCaches;
});

function makeCtx(query, { ip = '203.0.113.1', kv, fetchMock } = {}) {
  const h = new Headers();
  h.set('cf-connecting-ip', ip);
  if (fetchMock) globalThis.fetch = fetchMock;
  return {
    request: new Request(`https://cloudcdn.pro/api/blurhash${query}`, { headers: h }),
    env: {
      RATE_KV: kv ?? {
        get: vi.fn().mockResolvedValue('0'),
        put: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

const TINY_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe('GET /api/blurhash', () => {
  describe('validation', () => {
    it('returns 400 when url is missing', async () => {
      const res = await onRequestGet(makeCtx(''));
      expect(res.status).toBe(400);
    });

    it('returns 400 for absolute URLs', async () => {
      for (const u of ['http://evil/x', 'https://evil/x']) {
        const res = await onRequestGet(makeCtx(`?url=${encodeURIComponent(u)}`));
        expect(res.status).toBe(400);
      }
    });

    it('returns 400 for traversal sequences', async () => {
      for (const u of ['/a/../b', '/a' + '\0' + 'b', '//etc']) {
        const res = await onRequestGet(makeCtx(`?url=${encodeURIComponent(u)}`));
        expect(res.status).toBe(400);
      }
    });

    it('returns 429 when rate-limited', async () => {
      const kv = { get: vi.fn().mockResolvedValue('9999'), put: vi.fn() };
      const res = await onRequestGet(makeCtx('?url=/x.png', { kv }));
      expect(res.status).toBe(429);
    });
  });

  describe('happy path', () => {
    it('returns hash + dataUri for a successful origin fetch', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_BYTES, { status: 200 }));
      const res = await onRequestGet(makeCtx('?url=/x.png', { fetchMock }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(json.dataUri).toMatch(/^data:image\/webp;base64,/);
      expect(json.width).toBe(32);
      expect(json.bytes).toBe(8);
      expect(json.source).toBe('fresh');
      expect(json.dateGenerated).toMatch(/^\d{4}-/);
    });

    it('clamps size to [8, 64]', async () => {
      // Use an implementation that returns a fresh Response per call so the
      // second invocation doesn't hit "body already read".
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(TINY_BYTES, { status: 200 }))
      );
      const big = await (await onRequestGet(makeCtx('?url=/x.png&size=200', { fetchMock }))).json();
      expect(big.width).toBe(64);
      const small = await (await onRequestGet(makeCtx('?url=/x.png&size=2', { fetchMock }))).json();
      expect(small.width).toBe(8);
    });

    it('defaults size to 32 when missing or unparseable', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_BYTES, { status: 200 }));
      const json = await (await onRequestGet(makeCtx('?url=/x.png&size=nonsense', { fetchMock }))).json();
      expect(json.width).toBe(32);
    });

    it('passes the right cf.image options to Cloudflare Image Resizing', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_BYTES, { status: 200 }));
      await onRequestGet(makeCtx('?url=/x.png&size=24', { fetchMock }));
      const opts = fetchMock.mock.calls[0][1].cf.image;
      expect(opts).toMatchObject({ width: 24, quality: 35, format: 'webp', blur: 50 });
    });

    it('sets 1-day Cache-Control', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_BYTES, { status: 200 }));
      const res = await onRequestGet(makeCtx('?url=/x.png', { fetchMock }));
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
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
      };
    }

    it('replays from cache without re-fetching the origin', async () => {
      globalThis.caches = fakeCacheBinding();
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_BYTES, { status: 200 }));
      const ctxA = makeCtx('?url=/cached.png', { fetchMock });
      await onRequestGet(ctxA);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call should hit the cache and skip the fetch entirely.
      const fetchMock2 = vi.fn();
      const ctxB = makeCtx('?url=/cached.png', { fetchMock: fetchMock2 });
      const json = await (await onRequestGet(ctxB)).json();
      expect(json.source).toBe('cached');
      expect(json.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(fetchMock2).not.toHaveBeenCalled();
    });

    it('caches per-(url, size) tuple — different sizes are separate entries', async () => {
      globalThis.caches = fakeCacheBinding();
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_BYTES, { status: 200 }));
      await onRequestGet(makeCtx('?url=/same.png&size=32', { fetchMock }));
      await onRequestGet(makeCtx('?url=/same.png&size=64', { fetchMock }));
      // Two distinct cache keys → two distinct origin fetches.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('error paths', () => {
    it('returns 404 when origin returns 4xx', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
      const res = await onRequestGet(makeCtx('?url=/missing.png', { fetchMock }));
      expect(res.status).toBe(404);
    });

    it('returns 502 when origin returns 5xx', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      const res = await onRequestGet(makeCtx('?url=/x.png', { fetchMock }));
      expect(res.status).toBe(502);
    });

    it('returns 502 when fetch throws', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
      const res = await onRequestGet(makeCtx('?url=/x.png', { fetchMock }));
      expect(res.status).toBe(502);
    });

    it('returns 502 when arrayBuffer throws', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true, status: 200,
        headers: new Headers(),
        arrayBuffer: () => { throw new Error('read fail'); },
      });
      const res = await onRequestGet(makeCtx('?url=/x.png', { fetchMock }));
      expect(res.status).toBe(502);
    });
  });

  describe('cf-connecting-ip fallback', () => {
    it("uses 'unknown' bucket when cf-connecting-ip is absent", async () => {
      const kv = { get: vi.fn().mockResolvedValue('0'), put: vi.fn() };
      const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_BYTES, { status: 200 }));
      globalThis.fetch = fetchMock;
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/blurhash?url=/x.png', { headers: new Headers() }),
        env: { RATE_KV: kv },
      };
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(kv.put).toHaveBeenCalledWith('rl:blurhash:unknown', expect.any(String), expect.any(Object));
    });
  });

  describe('OPTIONS', () => {
    it('returns 204 with CORS preflight', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });
});
