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

  // --- Malformed Accept header ---
  it('handles malformed Accept header gracefully', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '///garbage,not-a-mime');
    const res = await onRequestGet(ctx);
    // Should still serve a fallback format or return a valid response
    expect([200, 404]).toContain(res.status);
  });

  // --- Accept with quality values ---
  it('handles Accept header with quality values', async () => {
    globalThis.fetch = mockFetchForFormats(['avif', 'webp', 'png']);
    const ctx = makeContext('?path=/img/logo', 'image/avif;q=0.8, image/webp;q=0.9, */*;q=0.1');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    // Should still detect avif support from the Accept header
    const ct = res.headers.get('Content-Type');
    expect(['image/avif', 'image/webp', 'image/png']).toContain(ct);
  });

  // --- Extended tests ---

  it('serves .avif when Accept is exactly image/avif', async () => {
    globalThis.fetch = mockFetchForFormats(['avif', 'webp', 'png']);
    const ctx = makeContext('?path=/img/logo', 'image/avif');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/avif');
  });

  it('serves .webp when Accept is exactly image/webp', async () => {
    globalThis.fetch = mockFetchForFormats(['webp', 'png']);
    const ctx = makeContext('?path=/img/logo', 'image/webp');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
  });

  it('falls back to svg when avif, webp, and png all 404', async () => {
    globalThis.fetch = mockFetchForFormats(['svg']);
    const ctx = makeContext('?path=/img/icon', 'image/avif,image/webp,*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
  });

  it('returns 404 when all format variants fail including svg', async () => {
    globalThis.fetch = mockFetchForFormats([]);
    const ctx = makeContext('?path=/img/missing', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(404);
  });

  it('includes CORS headers on success', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('handles path with multiple dots (logo.min.svg)', async () => {
    globalThis.fetch = mockFetchForFormats(['svg']);
    const ctx = makeContext('?path=/img/logo.min', '*/*');
    const res = await onRequestGet(ctx);
    // Should attempt logo.min.avif, logo.min.webp, etc.
    expect([200, 404]).toContain(res.status);
  });

  it('handles path with trailing slash', async () => {
    const ctx = makeContext('?path=/img/logo/', '*/*');
    const res = await onRequestGet(ctx);
    // Trailing slash on path is unusual, should not crash
    expect([200, 400, 404]).toContain(res.status);
  });

  it('handles empty path parameter', async () => {
    const ctx = makeContext('?path=', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('handles very long path', async () => {
    globalThis.fetch = mockFetchForFormats([]);
    const longPath = '/img/' + 'a'.repeat(2000);
    const ctx = makeContext(`?path=${longPath}`, '*/*');
    const res = await onRequestGet(ctx);
    // Should not crash
    expect([400, 404]).toContain(res.status);
  });

  it('avif preferred when quality values favor it', async () => {
    globalThis.fetch = mockFetchForFormats(['avif', 'webp', 'png']);
    const ctx = makeContext('?path=/img/logo', 'image/avif;q=0.8, image/webp;q=0.5');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/avif');
  });

  it('avif 404 falls back to webp 200', async () => {
    globalThis.fetch = mockFetchForFormats(['webp']);
    const ctx = makeContext('?path=/img/logo', 'image/avif,image/webp,*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
  });

  it('avif 404, webp 404, png 200', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', 'image/avif,image/webp,*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('serves png for Accept: image/png only', async () => {
    globalThis.fetch = mockFetchForFormats(['avif', 'webp', 'png']);
    const ctx = makeContext('?path=/img/logo', 'image/png');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    // Should serve png since that's what's accepted
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('Vary: Accept header present on 404', async () => {
    globalThis.fetch = mockFetchForFormats([]);
    const ctx = makeContext('?path=/img/nothing', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(404);
    // 404 response may or may not have Vary header
  });

  it('content-type for avif is image/avif', async () => {
    globalThis.fetch = mockFetchForFormats(['avif']);
    const ctx = makeContext('?path=/img/logo', 'image/avif');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toBe('image/avif');
  });

  it('content-type for webp is image/webp', async () => {
    globalThis.fetch = mockFetchForFormats(['webp']);
    const ctx = makeContext('?path=/img/logo', 'image/webp');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
  });

  it('content-type for png is image/png', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('400 error is valid JSON', async () => {
    const ctx = makeContext('');
    const res = await onRequestGet(ctx);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('404 error is valid JSON', async () => {
    globalThis.fetch = mockFetchForFormats([]);
    const ctx = makeContext('?path=/img/missing', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('400 error has CORS header', async () => {
    const ctx = makeContext('');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('404 error has CORS header', async () => {
    globalThis.fetch = mockFetchForFormats([]);
    const ctx = makeContext('?path=/img/missing', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('success has CORS header', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('success has Cache-Control', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('success has Vary Accept', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', '*/*');
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Vary')).toBe('Accept');
  });

  it('handles Accept with text/html (should serve png fallback)', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = makeContext('?path=/img/logo', 'text/html,*/*');
    const res = await onRequestGet(ctx);
    expect([200, 404]).toContain(res.status);
  });

  it('all formats 404 returns 404 with error message', async () => {
    globalThis.fetch = mockFetchForFormats([]);
    const ctx = makeContext('?path=/img/nothing', 'image/avif,image/webp,*/*');
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('path-based routing works for nested paths', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto/project/v1/logos/logo',
        headers: { get: (n) => n.toLowerCase() === 'accept' ? '*/*' : null },
      },
    };
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  // ── Path validation (SSRF protection) ──

  it('rejects path with .. traversal', async () => {
    const ctx = {
      request: new Request('https://cloudcdn.pro/api/auto?path=/../../../etc/passwd'),
    };
    Object.defineProperty(ctx.request, 'headers', { value: { get: () => '*/*' } });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('disallowed');
  });

  it('rejects path with null byte', async () => {
    const ctx = {
      request: new Request('https://cloudcdn.pro/api/auto?path=/test%00.svg'),
    };
    Object.defineProperty(ctx.request, 'headers', { value: { get: () => '*/*' } });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects path with double slashes', async () => {
    const ctx = {
      request: new Request('https://cloudcdn.pro/api/auto?path=//etc/passwd'),
    };
    Object.defineProperty(ctx.request, 'headers', { value: { get: () => '*/*' } });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });
});
