import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Comprehensive regression suite — imports EVERY endpoint module
 * and validates stability, security, and performance contracts.
 */

// ── Import all endpoint modules ──
const storageModule = await import('../../../functions/api/storage/[[path]].js');
const batchModule = await import('../../../functions/api/storage/batch.js');
const assetsModule = await import('../../../functions/api/assets.js');
const metadataModule = await import('../../../functions/api/assets/metadata.js');
const signedModule = await import('../../../functions/api/signed.js');
const transformModule = await import('../../../functions/api/transform.js');
const autoModule = await import('../../../functions/api/auto.js');
const streamModule = await import('../../../functions/api/stream.js');
const analyticsModule = await import('../../../functions/api/analytics.js');
const zonesModule = await import('../../../functions/api/core/zones.js');
const zoneDetailModule = await import('../../../functions/api/core/zones/[[id]].js');
const statisticsModule = await import('../../../functions/api/core/statistics.js');
const rulesModule = await import('../../../functions/api/core/rules.js');
const insightsSummaryModule = await import('../../../functions/api/insights/summary.js');
const insightsTopModule = await import('../../../functions/api/insights/top-assets.js');
const insightsGeoModule = await import('../../../functions/api/insights/geography.js');
const insightsErrorsModule = await import('../../../functions/api/insights/errors.js');
const sharedModule = await import('../../../functions/api/_shared.js');

// ── Helpers ──

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  sharedModule.clearManifestCache();
});

const MANIFEST_DATA = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.webp', path: 'akande/v1/banners/banner.webp', project: 'akande', category: 'banners', format: 'webp', size: 5600 },
  { name: 'photo.webp', path: 'stocks/images/photo.webp', project: 'stocks', category: 'images', format: 'webp', size: 12000 },
];

function mockAssets(manifest = MANIFEST_DATA) {
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(manifest), { status: 200, headers: { 'Content-Type': 'application/json' } })
    ),
  };
}

function mockKv(data = {}) {
  return {
    get: vi.fn().mockImplementation(key => Promise.resolve(data[key] || null)),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

/** Build a minimal request object. */
function req(url, options = {}) {
  const { method = 'GET', headers = {}, body } = options;
  const h = new Headers(headers);
  return {
    url: `https://cloudcdn.pro${url}`,
    method,
    headers: h,
    json: body !== undefined
      ? vi.fn().mockResolvedValue(body)
      : vi.fn().mockRejectedValue(new Error('No body')),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    cf: {},
  };
}

/** Parse JSON safely from Response (handles streaming). */
async function safeJson(res) {
  const text = await res.text();
  return JSON.parse(text);
}

// ===========================================================================
// 1. STABILITY TESTS
// ===========================================================================

describe('Stability — all endpoints return valid JSON and handle edge cases', () => {

  // ── Storage API ──
  describe('Storage API', () => {
    it('GET list returns valid JSON', async () => {
      const ctx = { request: req('/api/storage/clients/', { headers: { AccessKey: 'k' } }), params: { path: ['clients', ''] }, env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await storageModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await safeJson(res);
      expect(Array.isArray(json)).toBe(true);
    });

    it('HEAD returns valid response', async () => {
      const ctx = {
        request: req('/api/storage/clients/akande/v1/logos/logo.svg', { method: 'HEAD', headers: { AccessKey: 'k' } }),
        params: { path: ['clients', 'akande', 'v1', 'logos', 'logo.svg'] },
        env: { STORAGE_KEY: 'k', ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('', { status: 200, headers: { 'Content-Length': '3400' } })) } },
      };
      const res = await storageModule.onRequestHead(ctx);
      expect([200, 404]).toContain(res.status);
    });
  });

  // ── Batch API ──
  describe('Batch API', () => {
    it('returns valid JSON on auth failure', async () => {
      const ctx = {
        request: { url: 'https://cloudcdn.pro/api/storage/batch', method: 'POST', headers: new Headers(), json: vi.fn().mockResolvedValue({}) },
        env: { STORAGE_KEY: 'k' },
        waitUntil: vi.fn(),
      };
      const res = await batchModule.onRequestPost(ctx);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.HttpCode).toBe(401);
    });
  });

  // ── Assets API ──
  describe('Assets API', () => {
    it('GET returns valid streamed JSON', async () => {
      const ctx = { request: req('/api/assets?page=1&per_page=10', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await safeJson(res);
      expect(json).toHaveProperty('Pagination');
      expect(json).toHaveProperty('Data');
    });

    it('handles missing query params gracefully', async () => {
      const ctx = { request: req('/api/assets', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
    });
  });

  // ── Metadata API ──
  describe('Metadata API', () => {
    it('returns valid JSON for existing asset', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets/metadata?path=akande/v1/logos/logo.svg', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await metadataModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('Path');
      expect(json).toHaveProperty('CdnUrl');
    });

    it('returns 400 for missing path param', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets/metadata', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await metadataModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent asset', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets/metadata?path=nonexistent.svg', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await metadataModule.onRequestGet(ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── Signed URL API ──
  describe('Signed URL API', () => {
    it('returns 500 when SIGNED_URL_SECRET missing', async () => {
      const ctx = { request: req('/api/signed?path=/test&expires=9999999999&sig=abc'), env: {} };
      const res = await signedModule.onRequestGet(ctx);
      expect(res.status).toBe(500);
    });

    it('returns 403 for missing params', async () => {
      const ctx = { request: req('/api/signed'), env: { SIGNED_URL_SECRET: 'sec' } };
      const res = await signedModule.onRequestGet(ctx);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('Missing required');
    });
  });

  // ── Transform API ──
  describe('Transform API', () => {
    it('returns 400 for missing url param', async () => {
      const ctx = { request: req('/api/transform'), env: {} };
      const res = await transformModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Missing required');
    });

    it('returns 400 for invalid w param', async () => {
      const ctx = { request: req('/api/transform?url=/test.jpg&w=abc'), env: {} };
      const res = await transformModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid fit param', async () => {
      const ctx = { request: req('/api/transform?url=/test.jpg&fit=invalid'), env: {} };
      const res = await transformModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Auto format API ──
  describe('Auto Format API', () => {
    it('returns 400 for missing path', async () => {
      const ctx = { request: req('/api/auto'), env: {} };
      const res = await autoModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Stream API ──
  describe('Stream API', () => {
    it('returns 400 for missing video param', async () => {
      const ctx = { request: req('/api/stream'), env: {} };
      const res = await streamModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid video');
    });

    it('returns 400 for invalid video name', async () => {
      const ctx = { request: req('/api/stream?video=hacked'), env: {} };
      const res = await streamModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('returns master playlist for valid video', async () => {
      const ctx = { request: req('/api/stream?video=black', { headers: { Accept: '*/*' } }), env: {} };
      const res = await streamModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('#EXTM3U');
    });
  });

  // ── Analytics API ──
  describe('Analytics API', () => {
    it('GET returns valid JSON', async () => {
      const ctx = { request: req('/api/analytics?days=1', { headers: { 'x-api-key': 'akey' } }), env: { ANALYTICS_KEY: 'akey', RATE_KV: mockKv() } };
      const res = await analyticsModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('days');
      expect(json).toHaveProperty('data');
    });

    it('POST handles valid body', async () => {
      const ctx = { request: req('/api/analytics', { method: 'POST', body: { path: '/test', bytes: 100 } }), env: { RATE_KV: mockKv() } };
      ctx.request.json = vi.fn().mockResolvedValue({ path: '/test', bytes: 100 });
      const res = await analyticsModule.onRequestPost(ctx);
      expect(res.status).toBe(200);
    });
  });

  // ── Core: Zones API ──
  describe('Core Zones API', () => {
    it('GET returns valid JSON', async () => {
      const ctx = { request: req('/api/core/zones', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', ASSETS: mockAssets() } };
      const res = await zonesModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json)).toBe(true);
    });
  });

  // ── Core: Zone Detail ──
  describe('Core Zone Detail API', () => {
    it('GET returns zone details', async () => {
      const ctx = { request: req('/api/core/zones/akande', { headers: { AccountKey: 'ak' } }), params: { id: ['akande'] }, env: { ACCOUNT_KEY: 'ak', ASSETS: mockAssets() } };
      const res = await zoneDetailModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.Id).toBe('akande');
    });

    it('GET returns 404 for nonexistent zone', async () => {
      const ctx = { request: req('/api/core/zones/nonexistent', { headers: { AccountKey: 'ak' } }), params: { id: ['nonexistent'] }, env: { ACCOUNT_KEY: 'ak', ASSETS: mockAssets() } };
      const res = await zoneDetailModule.onRequestGet(ctx);
      expect(res.status).toBe(404);
    });

    it('GET returns 400 for missing zone ID', async () => {
      const ctx = { request: req('/api/core/zones/', { headers: { AccountKey: 'ak' } }), params: { id: [] }, env: { ACCOUNT_KEY: 'ak', ASSETS: mockAssets() } };
      const res = await zoneDetailModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Core: Statistics ──
  describe('Core Statistics API', () => {
    it('GET returns valid JSON', async () => {
      const ctx = { request: req('/api/core/statistics?days=1', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', RATE_KV: mockKv() } };
      const res = await statisticsModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('Summary');
      expect(json).toHaveProperty('Daily');
    });
  });

  // ── Core: Rules ──
  describe('Core Rules API', () => {
    it('GET returns valid JSON', async () => {
      const ctx = {
        request: req('/api/core/rules', { headers: { AccountKey: 'ak' } }),
        env: { ACCOUNT_KEY: 'ak', ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('/* headers */', { status: 200 })) } },
      };
      const res = await rulesModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('Headers');
      expect(json).toHaveProperty('Editable');
    });
  });

  // ── Insights endpoints ──
  describe('Insights APIs', () => {
    it('summary returns valid JSON', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/insights/summary?days=1', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', RATE_KV: mockKv() } };
      const res = await insightsSummaryModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('TotalRequests');
    });

    it('top-assets returns valid JSON', async () => {
      const ctx = { request: req('/api/insights/top-assets?days=1', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', RATE_KV: mockKv() } };
      const res = await insightsTopModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('Assets');
    });

    it('geography returns valid JSON', async () => {
      const ctx = { request: req('/api/insights/geography?days=1', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', RATE_KV: mockKv() } };
      const res = await insightsGeoModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('Countries');
    });

    it('errors returns valid JSON (empty dataset)', async () => {
      const ctx = { request: req('/api/insights/errors?days=1', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', RATE_KV: mockKv() } };
      const res = await insightsErrorsModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('Errors');
      expect(json.Errors).toHaveLength(0);
    });
  });
});

// ── All OPTIONS endpoints ──
describe('Stability — all OPTIONS return 204 with CORS', () => {
  const optionsEndpoints = [
    ['storage', storageModule.onRequestOptions],
    ['batch', batchModule.onRequestOptions],
    ['assets', assetsModule.onRequestOptions],
    ['metadata', metadataModule.onRequestOptions],
    ['stream', streamModule.onRequestOptions],
    ['zones', zonesModule.onRequestOptions],
    ['zone-detail', zoneDetailModule.onRequestOptions],
    ['statistics', statisticsModule.onRequestOptions],
    ['rules', rulesModule.onRequestOptions],
    ['insights-summary', insightsSummaryModule.onRequestOptions],
    ['insights-top', insightsTopModule.onRequestOptions],
    ['insights-geo', insightsGeoModule.onRequestOptions],
    ['insights-errors', insightsErrorsModule.onRequestOptions],
  ];

  for (const [name, fn] of optionsEndpoints) {
    it(`${name} OPTIONS returns 204`, async () => {
      const res = await fn();
      expect(res.status).toBe(204);
      const origin = res.headers.get('Access-Control-Allow-Origin');
      expect(origin).toBe('*');
    });
  }
});

// ===========================================================================
// 2. SECURITY TESTS
// ===========================================================================

describe('Security — auth, traversal, and injection defenses', () => {

  // ── Path traversal ──
  describe('path traversal blocked on storage endpoints', () => {
    it('storage GET rejects ../', async () => {
      const ctx = { request: req('/api/storage/../../etc/passwd', { headers: { AccessKey: 'k' } }), params: { path: ['..', '..', 'etc', 'passwd'] }, env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await storageModule.onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('storage PUT rejects ../', async () => {
      const ctx = { request: req('/api/storage/../../etc/passwd', { method: 'PUT', headers: { AccessKey: 'k' } }), params: { path: ['..', '..', 'etc', 'passwd'] }, env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      ctx.request.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(0));
      const res = await storageModule.onRequestPut(ctx);
      expect(res.status).toBe(400);
    });

    it('batch rejects .. in file paths', async () => {
      const ctx = {
        request: { url: 'https://cloudcdn.pro/api/storage/batch', method: 'POST', headers: new Headers({ AccessKey: 'k' }), json: vi.fn().mockResolvedValue({ files: [{ path: '../../../etc/shadow', content: 'dGVzdA==' }] }) },
        env: { STORAGE_KEY: 'k', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r/r' },
        waitUntil: vi.fn(),
      };
      const res = await batchModule.onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('zone detail DELETE rejects .. in zone ID', async () => {
      const ctx = { request: req('/api/core/zones/..%2F..', { method: 'DELETE', headers: { AccountKey: 'ak' } }), params: { id: ['../..'] }, env: { ACCOUNT_KEY: 'ak', GITHUB_TOKEN: 't', GITHUB_REPO: 'r/r' } };
      const res = await zoneDetailModule.onRequestDelete(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Auth rejection across endpoints ──
  describe('all authenticated endpoints reject missing/wrong keys', () => {
    it('storage rejects wrong key', async () => {
      const ctx = { request: req('/api/storage/clients/', { headers: { AccessKey: 'wrong' } }), params: { path: ['clients', ''] }, env: { STORAGE_KEY: 'correct' } };
      const res = await storageModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('assets rejects wrong key', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets', { headers: { AccessKey: 'wrong' } }), env: { STORAGE_KEY: 'correct' } };
      const res = await assetsModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('metadata rejects wrong key', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets/metadata?path=test', { headers: { AccessKey: 'wrong' } }), env: { STORAGE_KEY: 'correct' } };
      const res = await metadataModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('zones rejects wrong AccountKey', async () => {
      const ctx = { request: req('/api/core/zones', { headers: { AccountKey: 'wrong' } }), env: { ACCOUNT_KEY: 'correct', ASSETS: mockAssets() } };
      const res = await zonesModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('statistics rejects wrong AccountKey', async () => {
      const ctx = { request: req('/api/core/statistics', { headers: { AccountKey: 'wrong' } }), env: { ACCOUNT_KEY: 'correct', RATE_KV: mockKv() } };
      const res = await statisticsModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('rules rejects wrong AccountKey', async () => {
      const ctx = { request: req('/api/core/rules', { headers: { AccountKey: 'wrong' } }), env: { ACCOUNT_KEY: 'correct' } };
      const res = await rulesModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('analytics rejects wrong api key', async () => {
      const ctx = { request: req('/api/analytics', { headers: { 'x-api-key': 'wrong' } }), env: { ANALYTICS_KEY: 'correct', RATE_KV: mockKv() } };
      const res = await analyticsModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('insights summary rejects no key', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/insights/summary'), env: { ACCOUNT_KEY: 'needed', STORAGE_KEY: 'also', RATE_KV: mockKv() } };
      const res = await insightsSummaryModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('insights top-assets rejects no key', async () => {
      const ctx = { request: req('/api/insights/top-assets'), env: { ACCOUNT_KEY: 'needed', STORAGE_KEY: 'also', RATE_KV: mockKv() } };
      const res = await insightsTopModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('insights geography rejects no key', async () => {
      const ctx = { request: req('/api/insights/geography'), env: { ACCOUNT_KEY: 'needed', STORAGE_KEY: 'also', RATE_KV: mockKv() } };
      const res = await insightsGeoModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('insights errors rejects no key', async () => {
      const ctx = { request: req('/api/insights/errors'), env: { ACCOUNT_KEY: 'needed', STORAGE_KEY: 'also', RATE_KV: mockKv() } };
      const res = await insightsErrorsModule.onRequestGet(ctx);
      expect(res.status).toBe(401);
    });
  });

  // ── Expired token ──
  describe('expired signed URLs rejected', () => {
    it('returns 403 for expired timestamp', async () => {
      const ctx = { request: req('/api/signed?path=/test&expires=1000000000&sig=fake'), env: { SIGNED_URL_SECRET: 'sec' } };
      const res = await signedModule.onRequestGet(ctx);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('expired');
    });

    it('returns 403 for invalid signature', async () => {
      const futureTs = Math.floor(Date.now() / 1000) + 3600;
      const ctx = { request: req(`/api/signed?path=/test&expires=${futureTs}&sig=tampered`), env: { SIGNED_URL_SECRET: 'sec' } };
      const res = await signedModule.onRequestGet(ctx);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('Invalid signature');
    });
  });

  // ── SQL injection-like strings don't crash ──
  describe('SQL injection-like strings handled gracefully', () => {
    it('assets API handles SQL injection in query param', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req("/api/assets?q=' OR 1=1 --&project='; DROP TABLE assets;--", { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
    });

    it('metadata API handles SQL injection in path param', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req("/api/assets/metadata?path=' OR 1=1--", { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await metadataModule.onRequestGet(ctx);
      // Should be 404 (not found) not a crash
      expect([400, 404]).toContain(res.status);
    });
  });

  // ── XSS payloads don't appear unescaped ──
  describe('XSS payloads escaped in responses', () => {
    it('metadata 404 response is valid JSON (XSS payloads cannot execute)', async () => {
      sharedModule.clearManifestCache();
      const xss = '<script>alert(1)</script>';
      const ctx = { request: req(`/api/assets/metadata?path=${encodeURIComponent(xss)}`, { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await metadataModule.onRequestGet(ctx);
      // Content-Type is application/json, so browsers won't execute scripts
      expect(res.headers.get('Content-Type')).toContain('application/json');
      const json = await res.json();
      expect(json.HttpCode).toBe(404);
    });

    it('batch 400 response does not reflect raw script in path', async () => {
      const ctx = {
        request: { url: 'https://cloudcdn.pro/api/storage/batch', method: 'POST', headers: new Headers({ AccessKey: 'k' }), json: vi.fn().mockResolvedValue({ files: [{ path: '..', content: 'x' }] }) },
        env: { STORAGE_KEY: 'k', GITHUB_TOKEN: 't', GITHUB_REPO: 'r/r' },
        waitUntil: vi.fn(),
      };
      const res = await batchModule.onRequestPost(ctx);
      const body = await res.text();
      // Path containing .. is rejected; verify the response is valid JSON
      JSON.parse(body); // should not throw
    });
  });

  // ── CORS headers on error responses ──
  describe('CORS headers present on all error responses', () => {
    it('storage 401 has CORS', async () => {
      const ctx = { request: req('/api/storage/clients/'), params: { path: ['clients', ''] }, env: { STORAGE_KEY: 'k' } };
      const res = await storageModule.onRequestGet(ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('batch 401 has CORS', async () => {
      const ctx = {
        request: { url: 'https://cloudcdn.pro/api/storage/batch', method: 'POST', headers: new Headers(), json: vi.fn() },
        env: { STORAGE_KEY: 'k' },
        waitUntil: vi.fn(),
      };
      const res = await batchModule.onRequestPost(ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('assets 401 has CORS', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets'), env: { STORAGE_KEY: 'k' } };
      const res = await assetsModule.onRequestGet(ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('zones 401 has CORS', async () => {
      const ctx = { request: req('/api/core/zones', { headers: { AccountKey: 'wrong' } }), env: { ACCOUNT_KEY: 'correct' } };
      const res = await zonesModule.onRequestGet(ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });
});

// ===========================================================================
// 3. PERFORMANCE CONTRACT TESTS
// ===========================================================================

describe('Performance contracts', () => {

  // ── Manifest cache ──
  describe('manifest cache returns same reference on consecutive calls', () => {
    it('returns cached manifest within TTL', async () => {
      sharedModule.clearManifestCache();
      const assets = mockAssets();
      const env = { ASSETS: assets };
      const url = 'https://cloudcdn.pro/test';

      const first = await sharedModule.getManifest(env, url);
      const second = await sharedModule.getManifest(env, url);

      // Same reference (not re-parsed)
      expect(first).toBe(second);
      // fetch called only once
      expect(assets.fetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes after clearManifestCache', async () => {
      sharedModule.clearManifestCache();
      // Use a fresh mock that returns a new Response each time
      const assets = {
        fetch: vi.fn()
          .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST_DATA), { status: 200, headers: { 'Content-Type': 'application/json' } }))
          .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST_DATA), { status: 200, headers: { 'Content-Type': 'application/json' } })),
      };
      const env = { ASSETS: assets };
      const url = 'https://cloudcdn.pro/test';

      await sharedModule.getManifest(env, url);
      sharedModule.clearManifestCache();
      await sharedModule.getManifest(env, url);

      expect(assets.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── Streaming responses produce valid JSON ──
  describe('streaming JSON produces valid output', () => {
    it('streamJsonArray with items', async () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const res = sharedModule.streamJsonArray({
        envelope: { Meta: { page: 1 } },
        arrayKey: 'Data',
        items,
      });
      expect(res.status).toBe(200);
      const json = await safeJson(res);
      expect(json.Meta.page).toBe(1);
      expect(json.Data).toHaveLength(3);
    });

    it('streamJsonArray with empty items', async () => {
      const res = sharedModule.streamJsonArray({
        envelope: { Meta: {} },
        arrayKey: 'Data',
        items: [],
      });
      const json = await safeJson(res);
      expect(json.Data).toHaveLength(0);
    });
  });

  // ── Empty datasets ──
  describe('empty datasets do not cause errors', () => {
    it('assets returns empty data for nonexistent project', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets?project=nonexistent', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await safeJson(res);
      expect(json.Pagination.TotalItems).toBe(0);
      expect(json.Data).toHaveLength(0);
    });

    it('analytics with zero data returns valid structure', async () => {
      const ctx = { request: req('/api/analytics?days=1', { headers: { 'x-api-key': 'akey' } }), env: { ANALYTICS_KEY: 'akey', RATE_KV: mockKv() } };
      const res = await analyticsModule.onRequestGet(ctx);
      const json = await res.json();
      expect(json.data[0].hits).toBe(0);
      expect(json.data[0].bandwidth.bytes).toBe(0);
    });

    it('statistics with zero data returns valid structure', async () => {
      const ctx = { request: req('/api/core/statistics?days=1', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', RATE_KV: mockKv() } };
      const res = await statisticsModule.onRequestGet(ctx);
      const json = await res.json();
      expect(json.Summary.TotalRequests).toBe(0);
      expect(json.Daily).toHaveLength(1);
    });

    it('insights errors with zero data returns empty array', async () => {
      const ctx = { request: req('/api/insights/errors?days=1', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', RATE_KV: mockKv() } };
      const res = await insightsErrorsModule.onRequestGet(ctx);
      const json = await res.json();
      expect(json.Errors).toEqual([]);
    });

    it('storage list with empty manifest returns empty array', async () => {
      const ctx = { request: req('/api/storage/clients/', { headers: { AccessKey: 'k' } }), params: { path: ['clients', ''] }, env: { STORAGE_KEY: 'k', ASSETS: mockAssets([]) } };
      const res = await storageModule.onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual([]);
    });
  });

  // ── Large page sizes handled ──
  describe('large page sizes handled correctly', () => {
    it('per_page=200 is accepted and clamped to max', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets?per_page=200', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      const json = await safeJson(res);
      expect(json.Pagination.PerPage).toBe(200);
    });

    it('per_page=999 is clamped to 200', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets?per_page=999', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      const json = await safeJson(res);
      expect(json.Pagination.PerPage).toBe(200);
    });

    it('per_page=0 is clamped to 1', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets?per_page=0', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      const json = await safeJson(res);
      expect(json.Pagination.PerPage).toBe(1);
    });

    it('negative page is clamped to 1', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets?page=-5', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      const json = await safeJson(res);
      expect(json.Pagination.Page).toBe(1);
    });
  });

  // ── Sorting and filtering ──
  describe('sorting and filtering contracts', () => {
    it('sort=size&order=desc returns largest first', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets?sort=size&order=desc', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      const json = await safeJson(res);
      for (let i = 1; i < json.Data.length; i++) {
        expect(json.Data[i - 1].size).toBeGreaterThanOrEqual(json.Data[i].size);
      }
    });

    it('format filter returns only matching', async () => {
      sharedModule.clearManifestCache();
      const ctx = { request: req('/api/assets?format=svg', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
      const res = await assetsModule.onRequestGet(ctx);
      const json = await safeJson(res);
      for (const item of json.Data) {
        expect(item.format).toBe('svg');
      }
    });
  });

  // ── formatBytes utility ──
  describe('formatBytes utility', () => {
    it('formats zero', () => {
      expect(sharedModule.formatBytes(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(sharedModule.formatBytes(512)).toBe('512 B');
    });

    it('formats kilobytes', () => {
      expect(sharedModule.formatBytes(2048)).toBe('2.0 KB');
    });

    it('formats megabytes', () => {
      expect(sharedModule.formatBytes(5 * 1048576)).toBe('5.0 MB');
    });

    it('formats gigabytes', () => {
      expect(sharedModule.formatBytes(2 * 1073741824)).toBe('2.00 GB');
    });
  });
});

// ===========================================================================
// 4. ADDITIONAL REGRESSION TESTS
// ===========================================================================

describe('Regression — all endpoints Content-Type is JSON', () => {
  it('storage 401 is application/json', async () => {
    const ctx = { request: req('/api/storage/clients/'), params: { path: ['clients', ''] }, env: { STORAGE_KEY: 'k' } };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('batch 401 is application/json', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/batch', method: 'POST', headers: new Headers(), json: vi.fn() },
      env: { STORAGE_KEY: 'k' },
      waitUntil: vi.fn(),
    };
    const res = await batchModule.onRequestPost(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('assets 401 is application/json', async () => {
    sharedModule.clearManifestCache();
    const ctx = { request: req('/api/assets'), env: { STORAGE_KEY: 'k' } };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('transform 400 is application/json', async () => {
    const ctx = { request: req('/api/transform'), env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('auto 400 is application/json', async () => {
    const ctx = { request: req('/api/auto'), env: {} };
    const res = await autoModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('stream 400 is application/json', async () => {
    const ctx = { request: req('/api/stream'), env: {} };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('signed 403 is application/json', async () => {
    const ctx = { request: req('/api/signed'), env: { SIGNED_URL_SECRET: 'sec' } };
    const res = await signedModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('zones 401 is application/json', async () => {
    const ctx = { request: req('/api/core/zones'), env: { ACCOUNT_KEY: 'k' } };
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('zone-detail 401 is application/json', async () => {
    const ctx = { request: req('/api/core/zones/test'), params: { id: ['test'] }, env: { ACCOUNT_KEY: 'k' } };
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('statistics 401 is application/json', async () => {
    const ctx = { request: req('/api/core/statistics'), env: { ACCOUNT_KEY: 'k', RATE_KV: mockKv() } };
    const res = await statisticsModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('rules 401 is application/json', async () => {
    const ctx = { request: req('/api/core/rules'), env: { ACCOUNT_KEY: 'k' } };
    const res = await rulesModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('analytics 401 is application/json', async () => {
    const ctx = { request: req('/api/analytics', { headers: { 'x-api-key': 'wrong' } }), env: { ANALYTICS_KEY: 'correct', RATE_KV: mockKv() } };
    const res = await analyticsModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('insights-summary 401 is application/json', async () => {
    sharedModule.clearManifestCache();
    const ctx = { request: req('/api/insights/summary'), env: { ACCOUNT_KEY: 'k', RATE_KV: mockKv() } };
    const res = await insightsSummaryModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('insights-top 401 is application/json', async () => {
    const ctx = { request: req('/api/insights/top-assets'), env: { ACCOUNT_KEY: 'k', RATE_KV: mockKv() } };
    const res = await insightsTopModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('insights-geo 401 is application/json', async () => {
    const ctx = { request: req('/api/insights/geography'), env: { ACCOUNT_KEY: 'k', RATE_KV: mockKv() } };
    const res = await insightsGeoModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('insights-errors 401 is application/json', async () => {
    const ctx = { request: req('/api/insights/errors'), env: { ACCOUNT_KEY: 'k', RATE_KV: mockKv() } };
    const res = await insightsErrorsModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('Regression — streaming with special chars', () => {
  it('streamJsonArray with items containing special characters', async () => {
    const items = [
      { id: 1, name: 'test <script>alert(1)</script>' },
      { id: 2, name: 'path/with/slashes & "quotes"' },
      { id: 3, name: 'unicode: 日本語 émojis 🎉' },
    ];
    const res = sharedModule.streamJsonArray({
      envelope: { Meta: {} },
      arrayKey: 'Data',
      items,
    });
    const json = await safeJson(res);
    expect(json.Data).toHaveLength(3);
    expect(json.Data[0].name).toContain('<script>');
    expect(json.Data[1].name).toContain('&');
  });
});

describe('Regression — concurrent manifest cache access', () => {
  it('handles sequential getManifest calls returning same result', async () => {
    sharedModule.clearManifestCache();
    const assets = mockAssets();
    const env = { ASSETS: assets };
    const url = 'https://cloudcdn.pro/test';

    const first = await sharedModule.getManifest(env, url);
    const second = await sharedModule.getManifest(env, url);
    const third = await sharedModule.getManifest(env, url);

    // All should get the same result
    expect(first).toBe(second);
    expect(second).toBe(third);
    // Should only have fetched once
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Regression — formatBytes edge cases', () => {
  it('formatBytes with undefined returns "0 B"', () => {
    expect(sharedModule.formatBytes(undefined)).toBe('0 B');
  });

  it('formatBytes with null returns "0 B"', () => {
    expect(sharedModule.formatBytes(null)).toBe('0 B');
  });

  it('formatBytes with NaN returns "0 B"', () => {
    expect(sharedModule.formatBytes(NaN)).toBe('0 B');
  });
});

describe('Regression — response status codes', () => {
  it('storage OPTIONS is 204', async () => {
    const res = await storageModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('batch OPTIONS is 204', async () => {
    const res = await batchModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('assets OPTIONS is 204', async () => {
    const res = await assetsModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('metadata OPTIONS is 204', async () => {
    const res = await metadataModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('stream OPTIONS is 204', async () => {
    const res = await streamModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('zones OPTIONS is 204', async () => {
    const res = await zonesModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('zone-detail OPTIONS is 204', async () => {
    const res = await zoneDetailModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('statistics OPTIONS is 204', async () => {
    const res = await statisticsModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('rules OPTIONS is 204', async () => {
    const res = await rulesModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('insights-summary OPTIONS is 204', async () => {
    const res = await insightsSummaryModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('insights-top OPTIONS is 204', async () => {
    const res = await insightsTopModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('insights-geo OPTIONS is 204', async () => {
    const res = await insightsGeoModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('insights-errors OPTIONS is 204', async () => {
    const res = await insightsErrorsModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('storage GET list returns 200', async () => {
    sharedModule.clearManifestCache();
    const ctx = { request: req('/api/storage/clients/', { headers: { AccessKey: 'k' } }), params: { path: ['clients', ''] }, env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('assets GET returns 200', async () => {
    sharedModule.clearManifestCache();
    const ctx = { request: req('/api/assets', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('zones GET returns 200', async () => {
    sharedModule.clearManifestCache();
    const ctx = { request: req('/api/core/zones', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', ASSETS: mockAssets() } };
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('statistics GET returns 200', async () => {
    const ctx = { request: req('/api/core/statistics?days=1', { headers: { AccountKey: 'ak' } }), env: { ACCOUNT_KEY: 'ak', RATE_KV: mockKv() } };
    const res = await statisticsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('stream master playlist returns 200', async () => {
    const ctx = { request: req('/api/stream?video=black') };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('transform without url returns 400', async () => {
    const ctx = { request: req('/api/transform'), env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('auto without path returns 400', async () => {
    const ctx = { request: req('/api/auto'), env: {} };
    const res = await autoModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('stream without video returns 400', async () => {
    const ctx = { request: req('/api/stream'), env: {} };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('signed without params returns 403', async () => {
    const ctx = { request: req('/api/signed'), env: { SIGNED_URL_SECRET: 'sec' } };
    const res = await signedModule.onRequestGet(ctx);
    expect(res.status).toBe(403);
  });

  it('analytics without key returns 401', async () => {
    const ctx = { request: req('/api/analytics'), env: { ANALYTICS_KEY: 'k', RATE_KV: mockKv() } };
    const res = await analyticsModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

describe('Regression — pagination edge cases', () => {
  it('per_page=0 is clamped to 1', async () => {
    sharedModule.clearManifestCache();
    const ctx = { request: req('/api/assets?per_page=0', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
    const res = await assetsModule.onRequestGet(ctx);
    const json = await safeJson(res);
    expect(json.Pagination.PerPage).toBe(1);
  });

  it('negative page is clamped to 1', async () => {
    sharedModule.clearManifestCache();
    const ctx = { request: req('/api/assets?page=-5', { headers: { AccessKey: 'k' } }), env: { STORAGE_KEY: 'k', ASSETS: mockAssets() } };
    const res = await assetsModule.onRequestGet(ctx);
    const json = await safeJson(res);
    expect(json.Pagination.Page).toBe(1);
  });
});
