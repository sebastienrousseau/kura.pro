/**
 * Control Plane regression — cross-cutting tests for zones, zone-detail, rules, statistics.
 *
 * Tests the lifecycle: create zone → list → get detail → add domain → delete zone,
 * rules read/update, and auth separation (AccountKey vs AccessKey).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const zonesModule = await import('../../../functions/api/core/zones.js');
const zoneDetailModule = await import('../../../functions/api/core/zones/[[id]].js');
const rulesModule = await import('../../../functions/api/core/rules.js');
const statsModule = await import('../../../functions/api/core/statistics.js');

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.svg', path: 'akande/v1/banners/banner.svg', project: 'akande', category: 'banners', format: 'svg', size: 5600 },
  { name: 'photo.webp', path: 'stocks/images/photo.webp', project: 'stocks', category: 'images', format: 'webp', size: 12000 },
];

const originalFetch = globalThis.fetch;

function makeCtx(method, url, options = {}) {
  const { accountKey, body, env = {}, params } = options;
  const h = new Headers();
  if (accountKey) h.set('AccountKey', accountKey);
  if (body) h.set('Content-Type', 'application/json');

  return {
    request: {
      url: `https://cloudcdn.pro${url}`,
      method,
      headers: h,
      json: vi.fn().mockResolvedValue(body || {}),
    },
    params: params || {},
    env: {
      ACCOUNT_KEY: env.ACCOUNT_KEY ?? 'acct-key-123',
      GITHUB_TOKEN: env.GITHUB_TOKEN,
      GITHUB_REPO: env.GITHUB_REPO,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_ZONE_ID: env.CLOUDFLARE_ZONE_ID,
      RATE_KV: env.RATE_KV ?? { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(manifestData), { status: 200, headers: { 'Content-Type': 'application/json' } })
        ),
      },
      ...env,
    },
    waitUntil: vi.fn(),
  };
}

afterEach(() => { globalThis.fetch = originalFetch; });

describe('Control Plane — Create zone → List → Get detail → Add domain → Delete zone', () => {
  it('list zones returns all non-stock zones', async () => {
    const ctx = makeCtx('GET', '/api/core/zones', { accountKey: 'acct-key-123' });
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const zones = await res.json();
    expect(Array.isArray(zones)).toBe(true);
    const names = zones.map(z => z.Name);
    expect(names).toContain('akande');
    expect(names).not.toContain('stocks');
  });

  it('get zone detail returns files and categories', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/akande', {
      accountKey: 'acct-key-123',
      params: { id: ['akande'] },
    });
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const zone = await res.json();
    expect(zone.Id).toBe('akande');
    expect(zone.FileCount).toBe(2);
    expect(zone.Files).toHaveLength(2);
    expect(zone.Categories).toContain('logos');
    expect(zone.Categories).toContain('banners');
  });

  it('get unknown zone returns 404', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/nonexistent', {
      accountKey: 'acct-key-123',
      params: { id: ['nonexistent'] },
    });
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.status).toBe(404);
  });

  it('create zone returns 501 without GITHUB_TOKEN', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'newclient' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(501);
  });

  it('add domain returns 501 without CLOUDFLARE_ACCOUNT_ID', async () => {
    const ctx = makeCtx('POST', '/api/core/zones/akande/domains', {
      accountKey: 'acct-key-123',
      params: { id: ['akande', 'domains'] },
      body: { Hostname: 'cdn.akande.com' },
    });
    const res = await zoneDetailModule.onRequestPost(ctx);
    expect(res.status).toBe(501);
  });

  it('delete zone returns 501 without GITHUB_TOKEN', async () => {
    const ctx = makeCtx('DELETE', '/api/core/zones/akande', {
      accountKey: 'acct-key-123',
      params: { id: ['akande'] },
    });
    const res = await zoneDetailModule.onRequestDelete(ctx);
    expect(res.status).toBe(501);
  });
});

describe('Control Plane — Rules read → update → verify', () => {
  it('reads edge rules with headers content', async () => {
    const ctx = makeCtx('GET', '/api/core/rules', { accountKey: 'acct-key-123' });
    ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response('/*.webp\n  Cache-Control: immutable', { status: 200 }));
    const res = await rulesModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Headers).toContain('Cache-Control');
    expect(json.Editable).toContain('_headers');
    expect(json.Editable).toContain('_redirects');
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects non-allowed file names for update', async () => {
    const ctx = makeCtx('POST', '/api/core/rules', {
      accountKey: 'acct-key-123',
      body: { File: 'wrangler.toml', Content: 'hacked' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await rulesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 501 for update without GITHUB_TOKEN', async () => {
    const ctx = makeCtx('POST', '/api/core/rules', {
      accountKey: 'acct-key-123',
      body: { File: '_headers', Content: '/*.webp\n  Cache-Control: max-age=300' },
    });
    const res = await rulesModule.onRequestPost(ctx);
    expect(res.status).toBe(501);
  });
});

describe('Control Plane — All endpoints require AccountKey', () => {
  it('zones rejects without AccountKey', async () => {
    const ctx = makeCtx('GET', '/api/core/zones');
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('zone detail rejects without AccountKey', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/akande', { params: { id: ['akande'] } });
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('statistics rejects without AccountKey', async () => {
    const ctx = makeCtx('GET', '/api/core/statistics?days=1');
    const res = await statsModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('rules rejects without AccountKey', async () => {
    const ctx = makeCtx('GET', '/api/core/rules');
    const res = await rulesModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

describe('Control Plane — AccessKey rejected on control plane', () => {
  it('zones rejects AccessKey (wrong header)', async () => {
    const ctx = makeCtx('GET', '/api/core/zones');
    ctx.request.headers.set('AccessKey', 'storage-key-456');
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('statistics rejects AccessKey (wrong header)', async () => {
    const ctx = makeCtx('GET', '/api/core/statistics?days=1');
    ctx.request.headers.set('AccessKey', 'storage-key-456');
    const res = await statsModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('rules rejects AccessKey (wrong header)', async () => {
    const ctx = makeCtx('GET', '/api/core/rules');
    ctx.request.headers.set('AccessKey', 'storage-key-456');
    const res = await rulesModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

describe('Control Plane — Statistics', () => {
  it('returns statistics with daily breakdown and geo data', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('hits')) return Promise.resolve('42');
        if (key.includes('bandwidth')) return Promise.resolve('1048576');
        if (key.includes('top')) return Promise.resolve(JSON.stringify({ '/akande/v1/logos/logo.svg': 10 }));
        if (key.includes('geo')) return Promise.resolve(JSON.stringify({ US: 20, GB: 15 }));
        if (key.includes('cache')) return Promise.resolve(JSON.stringify({ hit: 30, miss: 12 }));
        return Promise.resolve(null);
      }),
      put: vi.fn(),
    };
    const ctx = makeCtx('GET', '/api/core/statistics?days=3', {
      accountKey: 'acct-key-123',
      env: { ACCOUNT_KEY: 'acct-key-123', RATE_KV: kv },
    });
    const res = await statsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.Summary.TotalRequests).toBe(126);
    expect(stats.Summary.CacheHitRate).toContain('%');
    expect(stats.Daily).toHaveLength(3);
    expect(stats.Daily[0].Date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('statistics with empty KV returns zero totals', async () => {
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    const ctx = makeCtx('GET', '/api/core/statistics?days=1', {
      accountKey: 'acct-key-123',
      env: { ACCOUNT_KEY: 'acct-key-123', RATE_KV: kv },
    });
    const res = await statsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.Summary.TotalRequests).toBe(0);
  });

  it('statistics filters by zone', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('top')) return Promise.resolve(JSON.stringify({ '/akande/v1/logo.svg': 5 }));
        return Promise.resolve('10');
      }),
      put: vi.fn(),
    };
    const ctx = makeCtx('GET', '/api/core/statistics?days=1&zone=akande', {
      accountKey: 'acct-key-123',
      env: { ACCOUNT_KEY: 'acct-key-123', RATE_KV: kv },
    });
    const res = await statsModule.onRequestGet(ctx);
    const stats = await res.json();
    expect(stats.Period.Zone).toBe('akande');
  });

  it('statistics rejects without AccountKey', async () => {
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    const ctx = makeCtx('GET', '/api/core/statistics', { env: { ACCOUNT_KEY: 'acct-key-123', RATE_KV: kv } });
    const res = await statsModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('statistics OPTIONS returns 204', async () => {
    const res = await statsModule.onRequestOptions();
    expect(res.status).toBe(204);
  });
});

describe('Control Plane — Extended zones', () => {
  it('zone list excludes stocks project', async () => {
    const ctx = makeCtx('GET', '/api/core/zones', { accountKey: 'acct-key-123' });
    const res = await zonesModule.onRequestGet(ctx);
    const zones = await res.json();
    const names = zones.map(z => z.Name);
    expect(names).not.toContain('stocks');
  });

  it('zone detail for akande returns correct FileCount', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/akande', {
      accountKey: 'acct-key-123',
      params: { id: ['akande'] },
    });
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.FileCount).toBeGreaterThan(0);
  });

  it('zone list has ISO DateCreated', async () => {
    const ctx = makeCtx('GET', '/api/core/zones', { accountKey: 'acct-key-123' });
    const res = await zonesModule.onRequestGet(ctx);
    const zones = await res.json();
    for (const zone of zones) {
      expect(zone.DateCreated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
