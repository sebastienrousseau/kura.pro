/**
 * Edge Services regression — transform, auto, signed, stream, purge, search, chat.
 *
 * Tests that public edge endpoints work without auth and return expected formats.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../../../functions/api/_shared.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getManifest: vi.fn().mockResolvedValue([
      { name: 'dark-blue-hero', path: '/stock/images/dark-blue-hero.webp', project: 'bankingonai', category: 'hero', format: 'webp', size: 45000 },
      { name: 'nature-green', path: '/stock/images/nature-green.webp', project: 'ecotravel', category: 'background', format: 'webp', size: 82000 },
    ]),
  };
});

const { clearManifestCache } = await import('../../../functions/api/_shared.js');

const transformModule = await import('../../../functions/api/transform.js');
const autoModule = await import('../../../functions/api/auto.js');
const signedModule = await import('../../../functions/api/signed.js');
const streamModule = await import('../../../functions/api/stream.js');
const purgeModule = await import('../../../functions/api/purge.js');
const searchModule = await import('../../../functions/api/search.js');

const originalFetch = globalThis.fetch;

beforeEach(() => clearManifestCache());
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Edge Services — Transform returns image params', () => {
  it('passes width and format to cf.image', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200, headers: { 'Content-Type': 'image/webp' } }));
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png&w=200&format=webp' },
      env: { RATE_KV: null },
    };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const opts = globalThis.fetch.mock.calls[0][1].cf.image;
    expect(opts.width).toBe(200);
    expect(opts.format).toBe('webp');
  });

  it('returns 400 for missing url parameter', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('includes Cache-Control and Vary on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('Vary')).toBe('Accept');
  });
});

describe('Edge Services — Auto negotiates format from Accept header', () => {
  it('serves avif when Accept contains image/avif', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('.avif')) return new Response('img', { status: 200, headers: { 'Content-Type': 'image/avif' } });
      return new Response('', { status: 404 });
    });
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto?path=/img/logo',
        headers: { get: (n) => n.toLowerCase() === 'accept' ? 'image/avif,image/webp,*/*' : null },
      },
    };
    const res = await autoModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/avif');
  });

  it('falls back to webp when avif is 404', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('.webp')) return new Response('img', { status: 200, headers: { 'Content-Type': 'image/webp' } });
      return new Response('', { status: 404 });
    });
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto?path=/img/logo',
        headers: { get: (n) => n.toLowerCase() === 'accept' ? 'image/avif,image/webp,*/*' : null },
      },
    };
    const res = await autoModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
  });

  it('returns Vary: Accept', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto?path=/img/logo',
        headers: { get: (n) => n.toLowerCase() === 'accept' ? '*/*' : null },
      },
    };
    const res = await autoModule.onRequestGet(ctx);
    expect(res.headers.get('Vary')).toBe('Accept');
  });
});

describe('Edge Services — Signed URL validates HMAC', () => {
  const SECRET = 'test-secret-key-for-hmac-256';

  function makeSig(path, expires) {
    return createHmac('sha256', SECRET).update(`${path}:${expires}`).digest('hex');
  }

  it('returns 200 for valid signature', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('pdf', { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    const path = '/protected/report.pdf';
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    const sig = makeSig(path, expires);
    const ctx = {
      request: { url: `https://cloudcdn.pro/api/signed?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}` },
      env: { SIGNED_URL_SECRET: SECRET },
    };
    const res = await signedModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Signed-URL')).toBe('verified');
  });

  it('returns 403 for invalid signature', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/signed?path=/file.pdf&expires=9999999999&sig=invalidsig' },
      env: { SIGNED_URL_SECRET: SECRET },
    };
    const res = await signedModule.onRequestGet(ctx);
    expect(res.status).toBe(403);
  });

  it('returns 403 for expired URL', async () => {
    const path = '/protected/old.pdf';
    const expires = String(Math.floor(Date.now() / 1000) - 10);
    const sig = makeSig(path, expires);
    const ctx = {
      request: { url: `https://cloudcdn.pro/api/signed?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}` },
      env: { SIGNED_URL_SECRET: SECRET },
    };
    const res = await signedModule.onRequestGet(ctx);
    expect(res.status).toBe(403);
  });
});

describe('Edge Services — Stream returns m3u8', () => {
  it('returns master playlist for valid video', async () => {
    const ctx = { request: { url: 'https://kura.pro/api/stream?video=black' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
    const body = await res.text();
    expect(body).toContain('#EXTM3U');
    expect(body).toContain('#EXT-X-STREAM-INF');
  });

  it('returns 400 for invalid video name', async () => {
    const ctx = { request: { url: 'https://kura.pro/api/stream?video=hacked' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });
});

describe('Edge Services — Purge accepts tags/urls/everything', () => {
  function purgeCtx(body) {
    return {
      request: { headers: { get: (n) => n.toLowerCase() === 'x-api-key' ? 'test-key' : null }, json: async () => body },
      env: {
        PURGE_KEY: 'test-key',
        CLOUDFLARE_ZONE_ID: 'zone123',
        CLOUDFLARE_API_TOKEN: 'token',
        RATE_KV: { get: vi.fn().mockResolvedValue('0'), put: vi.fn() },
      },
    };
  }

  it('purges by URLs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const res = await purgeModule.onRequestPost(purgeCtx({ urls: ['https://cloudcdn.pro/a.webp'] }));
    expect(res.status).toBe(200);
  });

  it('purges by tags', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const res = await purgeModule.onRequestPost(purgeCtx({ tags: ['project-akande'] }));
    expect(res.status).toBe(200);
  });

  it('purges everything', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const res = await purgeModule.onRequestPost(purgeCtx({ purge_everything: true }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.purged).toBe('everything');
  });
});

describe('Edge Services — Search returns scored results', () => {
  it('returns results with score for matching query', async () => {
    const ctx = {
      request: {
        url: 'https://kura.pro/api/search?q=blue+banking',
        headers: new Headers({ 'cf-connecting-ip': '127.0.0.1' }),
      },
      env: {
        AI: undefined,
        VECTOR_INDEX: undefined,
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('[]')) },
      },
    };
    const res = await searchModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
    expect(json.results[0].score).toBeGreaterThan(0);
  });
});

describe('Edge Services — Public endpoints do not require auth', () => {
  it('transform works without any auth header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('auto works without any auth header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto?path=/img/logo',
        headers: { get: (n) => n.toLowerCase() === 'accept' ? '*/*' : null },
      },
    };
    const res = await autoModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('stream works without any auth header', async () => {
    const ctx = { request: { url: 'https://kura.pro/api/stream?video=black' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('search works without any auth header', async () => {
    const ctx = {
      request: {
        url: 'https://kura.pro/api/search?q=test',
        headers: new Headers({ 'cf-connecting-ip': '127.0.0.1' }),
      },
      env: {
        AI: undefined,
        VECTOR_INDEX: undefined,
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('[]')) },
      },
    };
    const res = await searchModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });
});

describe('Edge Services — Response headers', () => {
  it('transform response has Cache-Control immutable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' }, env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('transform response has Vary Accept', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' }, env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.headers.get('Vary')).toBe('Accept');
  });

  it('transform response has CORS header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' }, env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('auto response has Vary Accept', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto?path=/img/logo',
        headers: { get: (n) => n.toLowerCase() === 'accept' ? '*/*' : null },
      },
    };
    const res = await autoModule.onRequestGet(ctx);
    expect(res.headers.get('Vary')).toBe('Accept');
  });

  it('stream master playlist has correct Content-Type', async () => {
    const ctx = { request: { url: 'https://kura.pro/api/stream?video=black' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
  });

  it('search response has Cache-Control', async () => {
    const ctx = {
      request: {
        url: 'https://kura.pro/api/search?q=test',
        headers: new Headers({ 'cf-connecting-ip': '127.0.0.1' }),
      },
      env: {
        AI: undefined,
        VECTOR_INDEX: undefined,
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('[]')) },
      },
    };
    const res = await searchModule.onRequestGet(ctx);
    expect(res.headers.get('Cache-Control')).toContain('max-age');
  });
});

describe('Edge Services — Error responses', () => {
  it('transform 400 has JSON content type', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform' }, env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('auto 400 has JSON content type', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto',
        headers: { get: () => null },
      },
    };
    const res = await autoModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('stream 400 has JSON content type', async () => {
    const ctx = { request: { url: 'https://kura.pro/api/stream' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('search 400 has JSON content type', async () => {
    const ctx = {
      request: {
        url: 'https://kura.pro/api/search',
        headers: new Headers({ 'cf-connecting-ip': '127.0.0.1' }),
      },
      env: { RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() }, ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('[]')) } },
    };
    const res = await searchModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('transform 502 for upstream server error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' }, env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(502);
  });

  it('transform 500 when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' }, env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(500);
  });
});
