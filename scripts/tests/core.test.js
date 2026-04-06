import { describe, it, expect, vi, afterEach } from 'vitest';

const zonesModule = await import('../../functions/api/core/zones.js');
const zoneDetailModule = await import('../../functions/api/core/zones/[[id]].js');
const statsModule = await import('../../functions/api/core/statistics.js');
const rulesModule = await import('../../functions/api/core/rules.js');

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.svg', path: 'akande/v1/banners/banner.svg', project: 'akande', category: 'banners', format: 'svg', size: 5600 },
  { name: 'photo.webp', path: 'stocks/images/photo.webp', project: 'stocks', category: 'images', format: 'webp', size: 12000 },
  { name: 'icon.png', path: 'shokunin/v1/icons/icon.png', project: 'shokunin', category: 'icons', format: 'png', size: 8800 },
];

function makeCtx(method, url, options = {}) {
  const { accountKey, body, env = {} } = options;
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
    params: options.params || {},
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

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Core API — Zones', () => {
  it('rejects without AccountKey', async () => {
    const ctx = makeCtx('GET', '/api/core/zones');
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('lists all zones from manifest', async () => {
    const ctx = makeCtx('GET', '/api/core/zones', { accountKey: 'acct-key-123' });
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const zones = await res.json();
    expect(Array.isArray(zones)).toBe(true);
    const names = zones.map(z => z.Name);
    expect(names).toContain('akande');
    expect(names).toContain('shokunin');
    expect(names).not.toContain('stocks');
  });

  it('zone has ISO dates and storage info', async () => {
    const ctx = makeCtx('GET', '/api/core/zones', { accountKey: 'acct-key-123' });
    const res = await zonesModule.onRequestGet(ctx);
    const zones = await res.json();
    const akande = zones.find(z => z.Name === 'akande');
    expect(akande.FileCount).toBe(2);
    expect(akande.StorageUsed).toBe(9000);
    expect(akande.DateCreated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(akande.OriginUrl).toBe('https://cloudcdn.pro/akande/');
  });

  it('returns 501 when creating zone without GITHUB_TOKEN', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', { accountKey: 'acct-key-123', body: { Name: 'newclient' } });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(501);
  });

  it('validates zone name', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'x' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });
});

describe('Core API — Zone Detail', () => {
  it('returns zone details', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/akande', { accountKey: 'acct-key-123', params: { id: ['akande'] } });
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const zone = await res.json();
    expect(zone.Id).toBe('akande');
    expect(zone.FileCount).toBe(2);
    expect(zone.Files).toHaveLength(2);
  });

  it('returns 404 for unknown zone', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/nonexistent', { accountKey: 'acct-key-123', params: { id: ['nonexistent'] } });
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.status).toBe(404);
  });

  it('rejects domain without CLOUDFLARE_ACCOUNT_ID', async () => {
    const ctx = makeCtx('POST', '/api/core/zones/akande/domains', {
      accountKey: 'acct-key-123',
      params: { id: ['akande', 'domains'] },
      body: { Hostname: 'cdn.akande.com' },
    });
    const res = await zoneDetailModule.onRequestPost(ctx);
    expect(res.status).toBe(501);
  });
});

describe('Core API — Statistics', () => {
  it('returns statistics with ISO dates', async () => {
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
    const ctx = makeCtx('GET', '/api/core/statistics?days=3', { accountKey: 'acct-key-123', env: { ACCOUNT_KEY: 'acct-key-123', RATE_KV: kv } });
    const res = await statsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.Summary.TotalRequests).toBe(126);
    expect(stats.Summary.CacheHitRate).toContain('%');
    expect(stats.Daily).toHaveLength(3);
    expect(stats.Daily[0].Date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stats.TopAssets.length).toBeGreaterThan(0);
    expect(stats.GeoDistribution.length).toBe(2);
  });

  it('filters by zone', async () => {
    const kv = {
      get: vi.fn().mockImplementation(key => {
        if (key.includes('top')) return Promise.resolve(JSON.stringify({ '/akande/v1/logo.svg': 5, '/shokunin/v1/icon.png': 3 }));
        return Promise.resolve('10');
      }),
      put: vi.fn(),
    };
    const ctx = makeCtx('GET', '/api/core/statistics?days=1&zone=akande', { accountKey: 'acct-key-123', env: { ACCOUNT_KEY: 'acct-key-123', RATE_KV: kv } });
    const res = await statsModule.onRequestGet(ctx);
    const stats = await res.json();
    expect(stats.Period.Zone).toBe('akande');
    expect(stats.TopAssets.every(a => a.Path.includes('akande'))).toBe(true);
  });
});

describe('Core API — Rules', () => {
  it('reads edge rules', async () => {
    const ctx = makeCtx('GET', '/api/core/rules', { accountKey: 'acct-key-123' });
    ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response('/*.webp\n  Cache-Control: immutable', { status: 200 }));
    const res = await rulesModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const rules = await res.json();
    expect(rules.Headers).toContain('Cache-Control');
    expect(rules.Editable).toContain('_headers');
  });

  it('rejects invalid file name', async () => {
    const ctx = makeCtx('POST', '/api/core/rules', {
      accountKey: 'acct-key-123',
      body: { File: 'wrangler.toml', Content: 'hacked' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await rulesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.Message).toContain('_headers');
  });

  it('returns 501 without GITHUB_TOKEN', async () => {
    const ctx = makeCtx('POST', '/api/core/rules', {
      accountKey: 'acct-key-123',
      body: { File: '_headers', Content: '/*.webp\n  Cache-Control: max-age=300' },
    });
    const res = await rulesModule.onRequestPost(ctx);
    expect(res.status).toBe(501);
  });
});

describe('Core API — Zone name edge cases', () => {
  it('rejects empty zone name', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: '' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects 1-char zone name', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'a' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects very long zone name (65 chars)', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'a'.repeat(65) },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects reserved zone name "stocks"', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'stocks' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects reserved zone name "shared"', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'shared' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects reserved zone name "cdn"', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'cdn' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects zone name with spaces', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'my zone' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect([400, 500]).toContain(res.status);
  });

  it('rejects duplicate zone name', async () => {
    const ctx = makeCtx('POST', '/api/core/zones', {
      accountKey: 'acct-key-123',
      body: { Name: 'akande' },
      env: { ACCOUNT_KEY: 'acct-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' },
    });
    const res = await zonesModule.onRequestPost(ctx);
    expect([400, 409, 500]).toContain(res.status);
  });
});

describe('Core API — Zone Detail extended', () => {
  it('zone detail DELETE returns 501 without GITHUB_TOKEN', async () => {
    const ctx = makeCtx('DELETE', '/api/core/zones/akande', {
      accountKey: 'acct-key-123',
      params: { id: ['akande'] },
    });
    const res = await zoneDetailModule.onRequestDelete(ctx);
    expect(res.status).toBe(501);
  });

  it('zone detail rejects path traversal in ID', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/..%2F..', {
      accountKey: 'acct-key-123',
      params: { id: ['../..'] },
    });
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect([400, 404]).toContain(res.status);
  });

  it('zone detail OPTIONS returns 204', async () => {
    const res = await zoneDetailModule.onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('Core API — Statistics extended', () => {
  it('returns zero values when KV has no data', async () => {
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    const ctx = makeCtx('GET', '/api/core/statistics?days=1', {
      accountKey: 'acct-key-123',
      env: { ACCOUNT_KEY: 'acct-key-123', RATE_KV: kv },
    });
    const res = await statsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.Summary.TotalRequests).toBe(0);
    expect(stats.Summary.TotalBandwidth).toBeDefined();
  });
});

describe('Core API — Auth separation', () => {
  it('AccountKey is separate from StorageKey', async () => {
    const ctx = makeCtx('GET', '/api/core/zones', {
      env: { ACCOUNT_KEY: 'acct-key-123' },
    });
    ctx.request.headers.set('AccessKey', 'storage-key-456');
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

describe('Core API — Response headers', () => {
  it('zones GET has Content-Type JSON', async () => {
    const ctx = makeCtx('GET', '/api/core/zones', { accountKey: 'acct-key-123' });
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('zones GET has CORS header', async () => {
    const ctx = makeCtx('GET', '/api/core/zones', { accountKey: 'acct-key-123' });
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('zone detail GET has CORS header', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/akande', { accountKey: 'acct-key-123', params: { id: ['akande'] } });
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('statistics GET has CORS header', async () => {
    const ctx = makeCtx('GET', '/api/core/statistics?days=1', { accountKey: 'acct-key-123' });
    const res = await statsModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rules GET has CORS header', async () => {
    const ctx = makeCtx('GET', '/api/core/rules', { accountKey: 'acct-key-123' });
    ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response('rules', { status: 200 }));
    const res = await rulesModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('zones 401 has Content-Type JSON', async () => {
    const ctx = makeCtx('GET', '/api/core/zones');
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('statistics 401 has Content-Type JSON', async () => {
    const ctx = makeCtx('GET', '/api/core/statistics');
    const res = await statsModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('rules 401 has Content-Type JSON', async () => {
    const ctx = makeCtx('GET', '/api/core/rules');
    const res = await rulesModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('Core API — zone detail edge cases', () => {
  it('zone detail Files array is non-empty for existing zone', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/akande', { accountKey: 'acct-key-123', params: { id: ['akande'] } });
    const res = await zoneDetailModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Files.length).toBeGreaterThan(0);
  });

  it('zone detail has Id matching param', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/akande', { accountKey: 'acct-key-123', params: { id: ['akande'] } });
    const res = await zoneDetailModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Id).toBe('akande');
  });

  it('zone detail has DateCreated', async () => {
    const ctx = makeCtx('GET', '/api/core/zones/akande', { accountKey: 'acct-key-123', params: { id: ['akande'] } });
    const res = await zoneDetailModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateCreated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('Core API — Statistics edge cases', () => {
  it('statistics with zone filter returns Zone in Period', async () => {
    const ctx = makeCtx('GET', '/api/core/statistics?days=1&zone=akande', { accountKey: 'acct-key-123' });
    const res = await statsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Zone).toBe('akande');
  });

  it('statistics without zone returns all in Period', async () => {
    const ctx = makeCtx('GET', '/api/core/statistics?days=1', { accountKey: 'acct-key-123' });
    const res = await statsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Period.Zone).toBe('all');
  });
});
