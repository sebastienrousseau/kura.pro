import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/lqip.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function makeCtx(query, { ip = '203.0.113.1', kv } = {}) {
  const h = new Headers();
  h.set('cf-connecting-ip', ip);
  return {
    request: new Request(`https://cloudcdn.pro/api/lqip${query}`, { headers: h }),
    env: {
      RATE_KV: kv ?? {
        get: vi.fn().mockResolvedValue('0'),
        put: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

describe('GET /api/lqip', () => {
  describe('validation', () => {
    it('returns 400 when url param is missing', async () => {
      const res = await onRequestGet(makeCtx(''));
      expect(res.status).toBe(400);
    });

    it('returns 400 for absolute http URLs (SSRF)', async () => {
      const res = await onRequestGet(makeCtx('?url=http://evil.example.com/x.png'));
      expect(res.status).toBe(400);
    });

    it('returns 400 for absolute https URLs (SSRF)', async () => {
      const res = await onRequestGet(makeCtx('?url=https://evil.example.com/x.png'));
      expect(res.status).toBe(400);
    });

    it('returns 400 for paths containing ..', async () => {
      const res = await onRequestGet(makeCtx('?url=/a/../etc/passwd'));
      expect(res.status).toBe(400);
    });

    it('returns 400 for paths containing //', async () => {
      const res = await onRequestGet(makeCtx('?url=//etc'));
      expect(res.status).toBe(400);
    });

    it('returns 429 when rate limited', async () => {
      const kv = { get: vi.fn().mockResolvedValue('9999'), put: vi.fn() };
      const res = await onRequestGet(makeCtx('?url=/x.png', { kv }));
      expect(res.status).toBe(429);
    });
  });

  describe('happy path', () => {
    function pngBytes() {
      // Eight bytes of a minimal-ish payload. The endpoint just base64s
      // whatever the origin returned, so content doesn't have to be real.
      return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    }

    it('returns a data URI for a successful origin fetch', async () => {
      const bytes = pngBytes();
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
      const res = await onRequestGet(makeCtx('?url=/clients/a/v1/logos/logo.svg'));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.lqip).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
      expect(json.bytes).toBe(8);
      expect(json.width).toBe(32);
      expect(json.dateGenerated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('passes width and blur through to the cf.image options', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(4), { status: 200 }));
      await onRequestGet(makeCtx('?url=/x.png&size=24&blur=20'));
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.width).toBe(24);
      expect(opts.blur).toBe(20);
      expect(opts.format).toBe('webp');
      expect(opts.quality).toBe(30);
    });

    it('clamps size to [8, 64]', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(4), { status: 200 }));
      await onRequestGet(makeCtx('?url=/x.png&size=200'));
      expect(globalThis.fetch.mock.calls[0][1].cf.image.width).toBe(64);
      globalThis.fetch.mockClear();
      await onRequestGet(makeCtx('?url=/x.png&size=2'));
      expect(globalThis.fetch.mock.calls[0][1].cf.image.width).toBe(8);
    });

    it('defaults size when missing or unparseable', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(4), { status: 200 }));
      await onRequestGet(makeCtx('?url=/x.png&size=nonsense'));
      expect(globalThis.fetch.mock.calls[0][1].cf.image.width).toBe(32);
    });

    it('sets a 1-day Cache-Control header', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(4), { status: 200 }));
      const res = await onRequestGet(makeCtx('?url=/x.png'));
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    });
  });

  describe('error paths', () => {
    it('returns 404 when origin returns 4xx', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
      const res = await onRequestGet(makeCtx('?url=/missing.png'));
      expect(res.status).toBe(404);
    });

    it('returns 502 when origin returns 5xx', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      const res = await onRequestGet(makeCtx('?url=/broken.png'));
      expect(res.status).toBe(502);
    });

    it('returns 502 when fetch throws', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
      const res = await onRequestGet(makeCtx('?url=/x.png'));
      expect(res.status).toBe(502);
    });

    it('returns 502 when reading the body throws', async () => {
      const fakeBody = {
        async arrayBuffer() { throw new Error('read fail'); },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: fakeBody.arrayBuffer,
      });
      const res = await onRequestGet(makeCtx('?url=/x.png'));
      expect(res.status).toBe(502);
    });
  });

  describe('OPTIONS', () => {
    it('returns 204 with CORS preflight headers', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });

  it("falls back to 'unknown' rate-limit bucket when cf-connecting-ip is missing", async () => {
    const kv = { get: vi.fn().mockResolvedValue('0'), put: vi.fn() };
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(4), { status: 200 }));
    const ctx = {
      request: new Request('https://cloudcdn.pro/api/lqip?url=/x.png', { headers: new Headers() }),
      env: { RATE_KV: kv },
    };
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(kv.put).toHaveBeenCalledWith('rl:lqip:unknown', expect.any(String), expect.any(Object));
  });
});
