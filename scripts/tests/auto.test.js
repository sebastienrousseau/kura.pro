import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet } = await import('../../functions/api/auto.js');

const originalFetch = globalThis.fetch;

function makeContext(queryString, accept = '*/*') {
  return {
    request: {
      url: `https://cloudcdn.pro/api/auto${queryString}`,
      headers: {
        get: (name) => {
          if (name.toLowerCase() === 'accept') return accept;
          return null;
        },
      },
    },
  };
}

/**
 * Helper: create a mock fetch that returns 200 for URLs matching any of the
 * given extensions, and 404 for everything else.
 */
function mockFetchForFormats(okExtensions) {
  return vi.fn(async (url) => {
    const matchedExt = okExtensions.find((ext) => url.endsWith(`.${ext}`));
    if (matchedExt) {
      return new Response('imgdata', {
        status: 200,
        headers: { 'Content-Type': `image/${matchedExt}` },
      });
    }
    return new Response('Not Found', { status: 404 });
  });
}

describe('GET /api/auto', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- Missing path ---
  it('returns 400 when path param is missing', async () => {
    const ctx = makeContext('');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('path');
  });

  // --- AVIF preferred ---
  it('serves .avif when Accept header contains image/avif', async () => {
    globalThis.fetch = mockFetchForFormats(['avif', 'webp', 'png']);
    const ctx = makeContext('?path=/img/logo', 'image/avif,image/webp,*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/avif');
    expect(globalThis.fetch.mock.calls[0][0]).toContain('.avif');
  });

  // --- WebP preferred ---
  it('serves .webp when Accept contains image/webp but not image/avif', async () => {
    globalThis.fetch = mockFetchForFormats(['webp', 'png']);
    const ctx = makeContext('?path=/img/logo', 'image/webp,*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(globalThis.fetch.mock.calls[0][0]).toContain('.webp');
  });

  // --- PNG fallback ---
  it('serves .png when Accept is */*', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('serves .png when Accept is image/png', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', 'image/png');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  // --- Format fallback chain ---
  it('falls back to webp when avif returns 404', async () => {
    globalThis.fetch = mockFetchForFormats(['webp', 'png']);
    const ctx = makeContext('?path=/img/logo', 'image/avif,image/webp,*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    // First call was .avif (404), second was .webp (200)
    expect(globalThis.fetch.mock.calls).toHaveLength(2);
    expect(globalThis.fetch.mock.calls[0][0]).toContain('.avif');
    expect(globalThis.fetch.mock.calls[1][0]).toContain('.webp');
  });

  it('falls back to png when avif and webp both 404', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', 'image/avif,image/webp,*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(globalThis.fetch.mock.calls).toHaveLength(3);
  });

  // --- All formats 404 ---
  it('returns 404 when no format is available', async () => {
    globalThis.fetch = mockFetchForFormats([]);
    const ctx = makeContext('?path=/img/logo', 'image/avif,image/webp,*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('No suitable format');
  });

  // --- Correct Content-Type ---
  it('sets correct Content-Type for each format', async () => {
    // SVG fallback when png also 404s
    globalThis.fetch = mockFetchForFormats(['svg']);
    const ctx = makeContext('?path=/img/icon', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
  });

  // --- Vary header ---
  it('includes Vary: Accept in response', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Vary')).toBe('Accept');
  });

  // --- Cache headers ---
  it('includes immutable cache headers', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  // --- Path-based routing ---
  it('supports path-based routing (/api/auto/some/path)', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto/img/logo',
        headers: {
          get: (name) => (name.toLowerCase() === 'accept' ? '*/*' : null),
        },
      },
    };
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });
});
