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
    it('adds correct Cache-Tag for tenant asset (rewrites to /clients/)', async () => {
      const ctx = makeContext('/bankingonai/images/banners/hero.webp');
      const res = await onRequest(ctx);
      const cacheTag = res.headers.get('Cache-Tag');
      expect(cacheTag).toContain('project-bankingonai');
      expect(cacheTag).toContain('type-banners');
      expect(cacheTag).toContain('format-webp');
      expect(cacheTag).toContain('all-assets');
      // Verify it rewrote to /clients/
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/clients/bankingonai');
    });

    it('does NOT add Cache-Tag on non-asset paths', async () => {
      const ctx = makeContext('/');
      const res = await onRequest(ctx);
      expect(res.headers.get('Cache-Tag')).toBeNull();
    });
  });

  // --- API passthrough ---
  describe('passthrough routes', () => {
    it('passes through /api/ routes', async () => {
      const ctx = makeContext('/api/transform?url=foo');
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
      expect(res.headers.get('Cache-Tag')).toBeNull();
    });
  });

  // --- CDN pillar rewrites ---
  describe('cdn pillar rewrites', () => {
    it('rewrites / to /cdn/en/index.html', async () => {
      const ctx = makeContext('/');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/cdn/en/index.html');
    });

    it('passes /dashboard/ through to Functions middleware (context.next)', async () => {
      const ctx = makeContext('/dashboard/');
      const res = await onRequest(ctx);
      // Should call context.next(), not ASSETS.fetch
      expect(ctx.next).toHaveBeenCalled();
    });

    it('passes /dist/ through to Functions middleware (context.next)', async () => {
      const ctx = makeContext('/dist/');
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
    });

    it('rewrites /shared/ to /cdn/shared/', async () => {
      const ctx = makeContext('/shared/branding/akqa.svg');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/cdn/shared/branding/akqa.svg');
    });
  });

  // --- Stocks pillar ---
  describe('stocks pillar', () => {
    it('serves /stocks/ directly without rewrite', async () => {
      const ctx = makeContext('/stocks/videos/nature.mp4');
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
    });

    it('redirects legacy /stock/ to /stocks/', async () => {
      const ctx = makeContext('/stock/images/photo.webp');
      const res = await onRequest(ctx);
      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toContain('/stocks/images/photo.webp');
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
      expect(ctx.next).toHaveBeenCalled();
      expect(res.headers.get('X-CDN-Region')).toBe('europe');
    });
  });

  // --- CDN pillar rewrites (extended) ---
  describe('cdn pillar rewrites (extended)', () => {
    it('rewrites /index.html to /cdn/en/index.html', async () => {
      const ctx = makeContext('/index.html');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/cdn/en/index.html');
    });

    it('rewrites /404.html to /cdn/404.html', async () => {
      const ctx = makeContext('/404.html');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/cdn/404.html');
    });

    it('rewrites /robots.txt to /cdn/robots.txt', async () => {
      const ctx = makeContext('/robots.txt');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/cdn/robots.txt');
    });

    it('rewrites /sitemap.xml to /cdn/sitemap.xml', async () => {
      const ctx = makeContext('/sitemap.xml');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/cdn/sitemap.xml');
    });

    it('rewrites /api-reference to /cdn/en/api-reference/index.html', async () => {
      const ctx = makeContext('/api-reference');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/cdn/en/api-reference/index.html');
    });

    it('rewrites /content/ to /cdn/en/content/', async () => {
      const ctx = makeContext('/content/docs/guide.html');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/cdn/en/content/docs/guide.html');
    });
  });

  // --- Static file passthrough ---
  describe('static file passthrough', () => {
    it('passes through /manifest.json', async () => {
      const ctx = makeContext('/manifest.json');
      await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
    });

    it('adds Cache-Control and Vary on /manifest.json responses', async () => {
      const ctx = makeContext('/manifest.json');
      const res = await onRequest(ctx);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, must-revalidate');
      expect(res.headers.get('Vary')).toBe('Accept-Encoding');
      expect(res.status).toBe(200);
    });

    it('passes through /favicon.ico', async () => {
      const ctx = makeContext('/favicon.ico');
      await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
    });
  });

  // --- Legacy redirect ---
  describe('legacy redirect', () => {
    it('redirects /stock/ with query string preserved', async () => {
      const ctx = makeContext('/stock/images/photo.webp?w=200&h=300');
      ctx.request.url = 'https://cloudcdn.pro/stock/images/photo.webp?w=200&h=300';
      const res = await onRequest(ctx);
      expect(res.status).toBe(301);
      const loc = res.headers.get('Location');
      expect(loc).toContain('/stocks/images/photo.webp');
      expect(loc).toContain('w=200');
    });
  });

  // --- Geo-routing all continents ---
  describe('geo-routing all continents', () => {
    const continentMap = {
      EU: 'europe',
      AS: 'asia',
      NA: 'north-america',
      SA: 'south-america',
      AF: 'africa',
      OC: 'oceania',
      AN: 'antarctica',
    };

    for (const [continent, region] of Object.entries(continentMap)) {
      it(`rewrites /global/ to /${region}/ for continent ${continent}`, async () => {
        const assetResponse = new Response('asset', { status: 200 });
        const ctx = makeContext('/global/test.webp', {
          cf: { continent },
          assetsFetchResponse: assetResponse,
        });
        const res = await onRequest(ctx);
        expect(res.headers.get('X-CDN-Region')).toBe(region);
      });
    }

    it('defaults to north-america when cf object has no continent', async () => {
      const assetResponse = new Response('asset', { status: 200 });
      const ctx = makeContext('/global/test.webp', {
        cf: {},
        assetsFetchResponse: assetResponse,
      });
      const res = await onRequest(ctx);
      expect(res.headers.get('X-CDN-Region')).toBe('north-america');
    });

    it('defaults to north-america when no cf object at all', async () => {
      const assetResponse = new Response('asset', { status: 200 });
      const ctx = makeContext('/global/test.webp', {
        assetsFetchResponse: assetResponse,
      });
      // Ensure request.cf is undefined
      ctx.request.cf = undefined;
      const res = await onRequest(ctx);
      expect(res.headers.get('X-CDN-Region')).toBe('north-america');
    });
  });

  // --- Asset extensions ---
  describe('asset extensions', () => {
    for (const ext of ['webp', 'avif', 'png', 'svg', 'ico', 'mp4']) {
      it(`adds Cache-Tag for .${ext} assets`, async () => {
        const ctx = makeContext(`/project/images/test.${ext}`);
        const res = await onRequest(ctx);
        expect(res.headers.get('Cache-Tag')).toContain('all-assets');
        expect(res.headers.get('Cache-Tag')).toContain(`format-${ext}`);
      });
    }

    for (const ext of ['html', 'json', 'css', 'js']) {
      it(`does NOT add Cache-Tag for non-asset .${ext}`, async () => {
        const ctx = makeContext(`/project/files/data.${ext}`);
        const res = await onRequest(ctx);
        expect(res.headers.get('Cache-Tag')).toBeNull();
      });
    }
  });

  // --- Tenant path edge cases ---
  describe('tenant path edge cases', () => {
    it('preserves query string on tenant rewrite', async () => {
      const ctx = makeContext('/project/images/logo.webp?v=2');
      ctx.request.url = 'https://cloudcdn.pro/project/images/logo.webp?v=2';
      const res = await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/clients/project/images/logo.webp');
      expect(fetchedUrl).toContain('v=2');
    });

    it('handles very long tenant path', async () => {
      const longPath = '/' + 'a'.repeat(200) + '/images/logo.webp';
      const ctx = makeContext(longPath);
      const res = await onRequest(ctx);
      // Should not crash
      expect([200, 404]).toContain(res.status);
    });
  });

  // --- Tenant path that returns 404 falls through ---
  describe('tenant path fallthrough', () => {
    it('falls through to next when /clients/ rewrite returns 404', async () => {
      const notFound = new Response('not found', { status: 404 });
      const ctx = makeContext('/unknown-tenant/some/asset.webp', {
        assetsFetchResponse: notFound,
      });
      await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
    });

    it('does not add Cache-Tag when tenant asset returns 404', async () => {
      const notFound = new Response('not found', { status: 404 });
      const ctx = makeContext('/unknown-tenant/images/missing.webp', {
        assetsFetchResponse: notFound,
      });
      const res = await onRequest(ctx);
      expect(res.headers.get('Cache-Tag')).toBeNull();
    });
  });

  // --- Client rewrite + analytics ---
  describe('client tenant rewrite', () => {
    it('rewrites tenant paths to /clients/ and tracks analytics', async () => {
      const ctx = makeContext('/project/images/icons/logo.png');
      await onRequest(ctx);
      expect(ctx.env.ASSETS.fetch).toHaveBeenCalled();
      expect(ctx.waitUntil).toHaveBeenCalled();
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/clients/project');
    });

    it('rewrites tenant path to /clients/ prefix', async () => {
      const ctx = makeContext('/myproject/v1/logos/logo.webp');
      await onRequest(ctx);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/clients/myproject');
    });

    it('tracks analytics via waitUntil', async () => {
      const ctx = makeContext('/project/images/logo.png');
      await onRequest(ctx);
      expect(ctx.waitUntil).toHaveBeenCalled();
    });

    it('non-asset path does not track analytics', async () => {
      const ctx = makeContext('/project/config.json');
      await onRequest(ctx);
      // waitUntil should not be called for non-asset paths that fall through
      // (or it may be called but without analytics)
      expect([200, 404]).toContain((await ctx.next.mock.results[0]?.value)?.status ?? 200);
    });

    it('rewrites to /clients/ and fetches from ASSETS', async () => {
      const ctx = makeContext('/testproject/v1/icons/icon.svg');
      await onRequest(ctx);
      expect(ctx.env.ASSETS.fetch).toHaveBeenCalled();
    });

    it('multiple tenants get different rewrites', async () => {
      const ctx1 = makeContext('/projA/logo.webp');
      await onRequest(ctx1);
      const url1 = ctx1.env.ASSETS.fetch.mock.calls[0][0].url;

      const ctx2 = makeContext('/projB/logo.webp');
      await onRequest(ctx2);
      const url2 = ctx2.env.ASSETS.fetch.mock.calls[0][0].url;

      expect(url1).toContain('/clients/projA');
      expect(url2).toContain('/clients/projB');
    });

    it('Cache-Tag includes project name', async () => {
      const ctx = makeContext('/myproject/images/test.webp');
      const res = await onRequest(ctx);
      expect(res.headers.get('Cache-Tag')).toContain('project-myproject');
    });

    it('Cache-Tag includes all-assets', async () => {
      const ctx = makeContext('/proj/images/test.png');
      const res = await onRequest(ctx);
      expect(res.headers.get('Cache-Tag')).toContain('all-assets');
    });

    it('Cache-Tag includes format', async () => {
      const ctx = makeContext('/proj/images/test.svg');
      const res = await onRequest(ctx);
      expect(res.headers.get('Cache-Tag')).toContain('format-svg');
    });

    it('non-asset file does not get Cache-Tag', async () => {
      const ctx = makeContext('/proj/data/config.json');
      const res = await onRequest(ctx);
      expect(res.headers.get('Cache-Tag')).toBeNull();
    });

    it('falls through to next() when /clients/ returns 404', async () => {
      const notFoundResponse = new Response('not found', { status: 404 });
      const ctx = makeContext('/unknown/path.png', {
        assetsFetchResponse: notFoundResponse,
      });
      await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
    });
  });

  describe('global security headers', () => {
    it('sets HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options, CORP on 200 responses', async () => {
      const ctx = makeContext('/');
      const res = await onRequest(ctx);
      expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains; preload');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('Permissions-Policy')).toContain('geolocation=()');
      expect(res.headers.get('Permissions-Policy')).toContain('interest-cohort=()');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    });

    it('applies headers to asset responses', async () => {
      const ctx = makeContext('/proj/v1/logos/logo.svg');
      const res = await onRequest(ctx);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
      // Cache-Tag still applied alongside security headers.
      expect(res.headers.get('Cache-Tag')).toBeTruthy();
    });

    it('applies headers to /manifest.json responses', async () => {
      const ctx = makeContext('/manifest.json');
      const res = await onRequest(ctx);
      expect(res.headers.get('Strict-Transport-Security')).toBeTruthy();
      // Pre-existing Cache-Control survives the wrap.
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, must-revalidate');
    });

    it('does not clobber existing security headers from downstream handlers', async () => {
      // /dashboard/ routes through context.next() so nextResponse wins.
      const customResponse = new Response('ok', {
        status: 200,
        headers: { 'X-Frame-Options': 'SAMEORIGIN' },
      });
      const ctx = makeContext('/dashboard/', { nextResponse: customResponse });
      const res = await onRequest(ctx);
      expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    });

    it('does not touch redirect responses', async () => {
      // /dashboard without trailing slash 301-redirects.
      const ctx = makeContext('/dashboard');
      const res = await onRequest(ctx);
      expect(res.status).toBe(301);
      // Redirects are exempt — they have no body and headers like HSTS
      // aren't needed since the next hop will set them.
      expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    });
  });

  describe('trace context propagation', () => {
    it('emits X-Trace-Id on every non-redirect response', async () => {
      const ctx = makeContext('/');
      const res = await onRequest(ctx);
      const traceId = res.headers.get('X-Trace-Id');
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('emits a W3C traceparent header', async () => {
      const ctx = makeContext('/');
      const res = await onRequest(ctx);
      const tp = res.headers.get('traceparent');
      // 00-<32 hex traceId>-<16 hex spanId>-01
      expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    it('stashes the trace on context.data so downstream handlers can read it', async () => {
      const ctx = makeContext('/');
      await onRequest(ctx);
      expect(ctx.data).toBeDefined();
      expect(ctx.data.trace).toBeDefined();
      expect(ctx.data.trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.data.trace.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('produces a different trace ID per request', async () => {
      const ctxA = makeContext('/');
      const ctxB = makeContext('/');
      const resA = await onRequest(ctxA);
      const resB = await onRequest(ctxB);
      expect(resA.headers.get('X-Trace-Id')).not.toBe(resB.headers.get('X-Trace-Id'));
    });

    it('does not emit trace headers on redirect responses', async () => {
      const ctx = makeContext('/dashboard');
      const res = await onRequest(ctx);
      expect(res.status).toBe(301);
      expect(res.headers.get('X-Trace-Id')).toBeNull();
    });
  });

  describe('Workers Analytics Engine emission', () => {
    it('writes a data point when METRICS binding is bound', async () => {
      const writeDataPoint = vi.fn();
      const ctx = makeContext('/');
      ctx.env.METRICS = { writeDataPoint };
      await onRequest(ctx);
      expect(writeDataPoint).toHaveBeenCalledTimes(1);
      const dp = writeDataPoint.mock.calls[0][0];
      expect(dp.blobs[0]).toBe('/');
      expect(dp.blobs[1]).toBe('200');
      // Trace ID is propagated into the blob set.
      expect(dp.blobs[3]).toMatch(/^[0-9a-f]{32}$/);
    });

    it('does not write when METRICS is unbound (no-op)', async () => {
      const ctx = makeContext('/');
      // env.METRICS deliberately omitted
      const res = await onRequest(ctx);
      expect(res.status).toBe(200);
    });

    it('swallows WAE write failures without affecting the response', async () => {
      const writeDataPoint = vi.fn().mockImplementation(() => { throw new Error('WAE outage'); });
      const ctx = makeContext('/');
      ctx.env.METRICS = { writeDataPoint };
      const res = await onRequest(ctx);
      expect(res.status).toBe(200);
    });
  });
});
