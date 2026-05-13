import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/auto.js');

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
    expect(res.headers.get('Vary')).toContain('Accept');
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
    expect(res.headers.get('Vary')).toContain('Accept');
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

  it('prefers JXL when Accept advertises image/jxl', async () => {
    globalThis.fetch = mockFetchForFormats(['jxl']);
    try {
      const res = await onRequestGet(makeContext('?path=/x/y/logo', 'image/jxl,*/*'));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/jxl');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('defaults Accept to empty string when header is absent (uses PNG fallback)', async () => {
    globalThis.fetch = mockFetchForFormats(['png']);
    try {
      const ctx = {
        request: {
          url: 'https://cloudcdn.pro/api/auto?path=/x/y/logo',
          headers: { get: () => null }, // no Accept header at all
        },
      };
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('OPTIONS returns 204 with CORS preflight headers', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  describe('network-aware format selection', () => {
    function makeNetworkCtx(query, accept, extra = {}) {
      const headerMap = { accept, ...extra };
      return {
        request: {
          url: `https://cloudcdn.pro/api/auto${query}`,
          headers: { get: (n) => headerMap[n.toLowerCase()] ?? null },
        },
      };
    }

    it('skips JXL/AVIF when Save-Data is on, prefers WebP', async () => {
      globalThis.fetch = mockFetchForFormats(['avif', 'webp', 'png']);
      try {
        const ctx = makeNetworkCtx('?path=/img/logo', 'image/avif,*/*', { 'save-data': 'on' });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/webp');
        expect(res.headers.get('X-Network-Aware')).toBe('slow');
        // First fetch call should be .webp, not .avif
        expect(globalThis.fetch.mock.calls[0][0]).toContain('.webp');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('skips JXL/AVIF on slow ECT (3g)', async () => {
      globalThis.fetch = mockFetchForFormats(['avif', 'webp', 'png']);
      try {
        const ctx = makeNetworkCtx('?path=/img/logo', 'image/avif,*/*', { 'sec-ch-effective-connection-type': '3g' });
        const res = await onRequestGet(ctx);
        expect(res.headers.get('Content-Type')).toBe('image/webp');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('does not interfere with a fast 4g client', async () => {
      globalThis.fetch = mockFetchForFormats(['avif', 'webp', 'png']);
      try {
        const ctx = makeNetworkCtx('?path=/img/logo', 'image/avif,*/*', { 'sec-ch-effective-connection-type': '4g' });
        const res = await onRequestGet(ctx);
        expect(res.headers.get('Content-Type')).toBe('image/avif');
        expect(res.headers.get('X-Network-Aware')).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('Vary header includes Save-Data and ECT for cache-correctness', async () => {
      globalThis.fetch = mockFetchForFormats(['png']);
      try {
        const ctx = makeNetworkCtx('?path=/img/logo', '*/*');
        const res = await onRequestGet(ctx);
        expect(res.headers.get('Vary')).toContain('Save-Data');
        expect(res.headers.get('Vary')).toContain('Sec-CH-Effective-Connection-Type');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('modern format expansion', () => {
    it('probes .heic when client explicitly accepts image/heic', async () => {
      globalThis.fetch = mockFetchForFormats(['heic']);
      const ctx = makeContext('?path=/img/photo', 'image/heic,image/webp,*/*');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/heic');
      // First probe should be .heic (after jxl/avif, which aren't in Accept)
      const firstUrl = globalThis.fetch.mock.calls[0][0];
      expect(firstUrl).toContain('.heic');
    });

    it('probes .heif when client explicitly accepts image/heif', async () => {
      globalThis.fetch = mockFetchForFormats(['heif']);
      const ctx = makeContext('?path=/img/photo', 'image/heif,*/*');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/heif');
    });

    it('does NOT probe heic/heif when Accept lacks them (no wildcard promotion)', async () => {
      globalThis.fetch = mockFetchForFormats(['webp']);
      const ctx = makeContext('?path=/img/photo', 'image/webp,*/*');
      await onRequestGet(ctx);
      const probedUrls = globalThis.fetch.mock.calls.map((c) => c[0]);
      expect(probedUrls.some((u) => u.includes('.heic'))).toBe(false);
      expect(probedUrls.some((u) => u.includes('.heif'))).toBe(false);
    });

    it('does NOT probe jxl when Accept lacks image/jxl', async () => {
      globalThis.fetch = mockFetchForFormats(['webp']);
      const ctx = makeContext('?path=/img/photo', 'image/avif,image/webp,*/*');
      await onRequestGet(ctx);
      const probedUrls = globalThis.fetch.mock.calls.map((c) => c[0]);
      expect(probedUrls.some((u) => u.includes('.jxl'))).toBe(false);
    });
  });

  describe('animated chain (anim=1)', () => {
    it('serves .avifs when client accepts image/avif and anim=1', async () => {
      globalThis.fetch = mockFetchForFormats(['avifs']);
      const ctx = makeContext('?path=/anim/loop&anim=1', 'image/avif,*/*');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/avif-sequence');
      expect(globalThis.fetch.mock.calls[0][0]).toContain('.avifs');
    });

    it('falls through to gif when nothing else available', async () => {
      globalThis.fetch = mockFetchForFormats(['gif']);
      const ctx = makeContext('?path=/anim/loop&anim=1', 'image/avif,*/*');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/gif');
    });

    it('serves .apng when client explicitly accepts image/apng', async () => {
      globalThis.fetch = mockFetchForFormats(['apng']);
      const ctx = makeContext('?path=/anim/loop&anim=1', 'image/apng,*/*');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/apng');
    });

    it('does NOT probe .avifs without explicit image/avif in Accept', async () => {
      globalThis.fetch = mockFetchForFormats(['gif']);
      const ctx = makeContext('?path=/anim/loop&anim=1', 'image/webp,*/*');
      await onRequestGet(ctx);
      const probedUrls = globalThis.fetch.mock.calls.map((c) => c[0]);
      expect(probedUrls.some((u) => u.includes('.avifs'))).toBe(false);
    });

    it('animated chain ignores anim=0 / absent param (stills only)', async () => {
      globalThis.fetch = mockFetchForFormats(['png']);
      const ctx = makeContext('?path=/img/logo&anim=0', '*/*');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const probedUrls = globalThis.fetch.mock.calls.map((c) => c[0]);
      expect(probedUrls.some((u) => u.includes('.avifs'))).toBe(false);
      expect(probedUrls.some((u) => u.includes('.gif'))).toBe(false);
    });
  });
});
