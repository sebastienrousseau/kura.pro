import { describe, it, expect, vi } from 'vitest';

// Mock the analytics module before importing middleware
vi.mock('../../functions/api/analytics.js', () => ({
  trackRequest: vi.fn().mockResolvedValue(undefined),
}));

const { onRequest } = await import('../../functions/_middleware.js');

function makeContext(path, options = {}) {
  const {
    cf = {},
    nextResponse = new Response('ok', { status: 200 }),
    assetsFetchResponse = new Response('asset', { status: 200 }),
  } = options;

  return {
    request: {
      url: `https://cloudcdn.pro${path}`,
      headers: new Headers(),
      cf,
    },
    env: {
      RATE_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      },
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(assetsFetchResponse),
      },
    },
    next: vi.fn().mockResolvedValue(nextResponse),
    waitUntil: vi.fn(),
  };
}

describe('Middleware: onRequest', () => {
  // --- Cache-Tag headers on asset responses ---
  describe('Cache-Tag headers', () => {
    it('adds correct Cache-Tag for project asset with banners type', async () => {
      const ctx = makeContext('/bankingonai/images/banners/hero.webp');
      const res = await onRequest(ctx);
      const cacheTag = res.headers.get('Cache-Tag');
      expect(cacheTag).toContain('project-bankingonai');
      expect(cacheTag).toContain('type-banners');
      expect(cacheTag).toContain('format-webp');
      expect(cacheTag).toContain('all-assets');
    });

    it('adds correct Cache-Tag for shared logos SVG', async () => {
      const ctx = makeContext('/shared/images/logos/cmn.svg');
      const res = await onRequest(ctx);
      const cacheTag = res.headers.get('Cache-Tag');
      expect(cacheTag).toContain('project-shared');
      expect(cacheTag).toContain('type-logos');
      expect(cacheTag).toContain('format-svg');
      expect(cacheTag).toContain('all-assets');
    });

    it('does NOT add Cache-Tag on non-asset paths', async () => {
      const ctx = makeContext('/index.html');
      const res = await onRequest(ctx);
      expect(res.headers.get('Cache-Tag')).toBeNull();
    });
  });

  // --- Passthrough routes ---
  describe('passthrough routes', () => {
    it('passes through /api/ routes', async () => {
      const ctx = makeContext('/api/transform?url=foo');
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
      expect(res.headers.get('Cache-Tag')).toBeNull();
    });

    it('passes through /dashboard/ routes', async () => {
      const ctx = makeContext('/dashboard/');
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
      expect(res.headers.get('Cache-Tag')).toBeNull();
    });

    it('passes through /dist/ routes', async () => {
      const ctx = makeContext('/dist/');
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
      expect(res.headers.get('Cache-Tag')).toBeNull();
    });
  });

  // --- Geo-routing ---
  describe('geo-routing for /global/ paths', () => {
    it('rewrites /global/ to /europe/ for EU continent', async () => {
      const assetResponse = new Response('eu-asset', { status: 200 });
      const ctx = makeContext('/global/banner.webp', {
        cf: { continent: 'EU' },
        assetsFetchResponse: assetResponse,
      });
      const res = await onRequest(ctx);
      expect(res.headers.get('X-CDN-Region')).toBe('europe');
      // ASSETS.fetch should have been called with the rewritten URL
      expect(ctx.env.ASSETS.fetch).toHaveBeenCalled();
      const fetchedRequest = ctx.env.ASSETS.fetch.mock.calls[0][0];
      expect(fetchedRequest.url).toContain('/europe/banner.webp');
    });

    it('falls back to original /global/ path on 404', async () => {
      const notFoundResponse = new Response('not found', { status: 404 });
      const fallbackResponse = new Response('global-asset', { status: 200 });
      const ctx = makeContext('/global/banner.webp', {
        cf: { continent: 'EU' },
        assetsFetchResponse: notFoundResponse,
        nextResponse: fallbackResponse,
      });
      const res = await onRequest(ctx);
      // Should have called next() as fallback
      expect(ctx.next).toHaveBeenCalled();
      expect(res.headers.get('X-CDN-Region')).toBe('europe');
    });

    it('defaults to north-america when no continent info', async () => {
      const assetResponse = new Response('na-asset', { status: 200 });
      const ctx = makeContext('/global/banner.webp', {
        cf: {},
        assetsFetchResponse: assetResponse,
      });
      const res = await onRequest(ctx);
      expect(res.headers.get('X-CDN-Region')).toBe('north-america');
      const fetchedRequest = ctx.env.ASSETS.fetch.mock.calls[0][0];
      expect(fetchedRequest.url).toContain('/north-america/banner.webp');
    });
  });

  // --- Analytics tracking ---
  describe('analytics tracking', () => {
    it('calls waitUntil for asset requests', async () => {
      const ctx = makeContext('/project/images/icons/logo.png');
      await onRequest(ctx);
      expect(ctx.waitUntil).toHaveBeenCalled();
    });
  });
});
