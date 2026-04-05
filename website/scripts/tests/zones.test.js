import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestPost, onRequestOptions } = await import('../../../functions/api/core/zones.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const MANIFEST = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.webp', path: 'akande/v1/banners/banner.webp', project: 'akande', category: 'banners', format: 'webp', size: 5600 },
  { name: 'photo.webp', path: 'stocks/images/photo.webp', project: 'stocks', category: 'images', format: 'webp', size: 12000 },
];

function makeKV() {
  return {
    get: vi.fn().mockResolvedValue('0'),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCtx(method, options = {}) {
  const h = new Headers();
  if (options.accountKey) h.set('AccountKey', options.accountKey);
  if (options.ip) h.set('cf-connecting-ip', options.ip);
  return {
    request: {
      url: 'https://cloudcdn.pro/api/core/zones',
      method,
      headers: h,
      json: options.body ? vi.fn().mockResolvedValue(options.body) : vi.fn().mockRejectedValue(new Error('no body')),
    },
    env: {
      ACCOUNT_KEY: options.envAccountKey ?? 'acct-123',
      GITHUB_TOKEN: options.githubToken,
      GITHUB_REPO: options.githubRepo,
      RATE_KV: options.kv ?? makeKV(),
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(MANIFEST), { status: 200 })
        ),
      },
    },
  };
}

describe('Core Zones API', () => {
  // ── Auth ──
  it('GET returns 401 without AccountKey', async () => {
    const ctx = makeCtx('GET');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('POST returns 401 without AccountKey', async () => {
    const ctx = makeCtx('POST');
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  // ── GET: List zones ──
  it('GET lists zones from manifest (excludes stocks/shared)', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    const names = json.map(z => z.Name);
    expect(names).toContain('akande');
    expect(names).not.toContain('stocks');
  });

  it('GET zones have correct schema', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    const zone = json.find(z => z.Name === 'akande');
    expect(zone.StorageZoneName).toBe('cloudcdn');
    expect(zone.OriginUrl).toContain('akande');
    expect(zone.FileCount).toBe(2);
    expect(zone.Categories).toBeInstanceOf(Array);
    expect(zone.Enabled).toBe(true);
  });

  it('GET returns 429 when rate limited', async () => {
    const kv = makeKV();
    kv.get = vi.fn().mockResolvedValue('60');
    const ctx = makeCtx('GET', { accountKey: 'acct-123', kv });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(429);
  });

  // ── POST: Create zone ──
  it('POST returns 501 without GITHUB_TOKEN', async () => {
    const ctx = makeCtx('POST', { accountKey: 'acct-123', body: { Name: 'newzone' } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(501);
  });

  it('POST rejects short name (<2 chars)', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123', body: { Name: 'a' },
      githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('POST rejects reserved name', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123', body: { Name: 'dashboard' },
      githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.Message).toContain('reserved');
  });

  it('POST returns 409 when zone already exists', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: '.gitkeep' }]), { status: 200 })
    );
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123', body: { Name: 'existing' },
      githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(409);
  });

  it('POST creates zone via GitHub API', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 })) // zone doesn't exist
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'head-sha' } }), { status: 200 })) // ref
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 'tree-sha' } }), { status: 200 })) // commit
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'new-tree-sha' }), { status: 201 })) // create tree
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'commit-sha' }), { status: 201 })) // commit
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })); // update ref

    const ctx = makeCtx('POST', {
      accountKey: 'acct-123', body: { Name: 'newclient' },
      githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.Name).toBe('newclient');
    expect(json.EdgeStatus).toBe('pending');
    expect(json.Directories).toBeInstanceOf(Array);
  });

  it('POST strips special characters from name', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'a' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 'b' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'd' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const ctx = makeCtx('POST', {
      accountKey: 'acct-123', body: { Name: 'My Project!' },
      githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.Name).toBe('myproject');
  });

  it('POST returns 429 when rate limited', async () => {
    const kv = makeKV();
    kv.get = vi.fn().mockResolvedValue('60');
    const ctx = makeCtx('POST', { accountKey: 'acct-123', body: { Name: 'test' }, kv });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(429);
  });

  it('OPTIONS returns 204', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });

  // --- Extended zone tests ---

  it('OPTIONS has CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('GET zones response has CORS header', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('GET zones response is JSON content type', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('zone list has OriginUrl for each zone', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const zones = await res.json();
    for (const zone of zones) {
      expect(zone.OriginUrl).toBeDefined();
      expect(zone.OriginUrl).toContain('cloudcdn.pro');
    }
  });

  it('zone list has FileCount for each zone', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const zones = await res.json();
    for (const zone of zones) {
      expect(typeof zone.FileCount).toBe('number');
      expect(zone.FileCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('zone list has StorageUsed for each zone', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const zones = await res.json();
    for (const zone of zones) {
      expect(typeof zone.StorageUsed).toBe('number');
      expect(zone.StorageUsed).toBeGreaterThanOrEqual(0);
    }
  });

  it('401 response is valid JSON', async () => {
    const ctx = makeCtx('GET', {});
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('POST 400 for reserved name "api"', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123', body: { Name: 'api' },
      githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('POST 400 for reserved name "dashboard"', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123', body: { Name: 'dashboard' },
      githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('POST rejects 2-char name (too short)', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123', body: { Name: 'ab' },
      githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect([400, 500]).toContain(res.status);
  });

  it('POST 401 with wrong AccountKey', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'wrong-key', body: { Name: 'test' },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });
});
