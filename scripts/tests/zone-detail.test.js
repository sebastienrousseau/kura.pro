import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestDelete, onRequestPost, onRequestOptions } = await import('../../functions/api/core/zones/[[id]].js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const MANIFEST = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.webp', path: 'akande/v1/banners/banner.webp', project: 'akande', category: 'banners', format: 'webp', size: 5600 },
];

function makeCtx(method, idSegments, options = {}) {
  const h = new Headers();
  if (options.accountKey) h.set('AccountKey', options.accountKey);
  return {
    request: {
      url: `https://cloudcdn.pro/api/core/zones/${idSegments.join('/')}`,
      method,
      headers: h,
      json: options.body ? vi.fn().mockResolvedValue(options.body) : vi.fn().mockRejectedValue(new Error('no body')),
    },
    params: { id: idSegments },
    env: {
      ACCOUNT_KEY: options.envAccountKey ?? 'acct-123',
      GITHUB_TOKEN: options.githubToken,
      GITHUB_REPO: options.githubRepo,
      CLOUDFLARE_ZONE_ID: options.cfZoneId,
      CLOUDFLARE_API_TOKEN: options.cfApiToken,
      CLOUDFLARE_ACCOUNT_ID: options.cfAccountId,
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(MANIFEST), { status: 200 })
        ),
      },
    },
    waitUntil: vi.fn(),
  };
}

describe('Zone Detail API — [[id]].js', () => {
  // ── Auth on all methods ──
  it('GET returns 401 without AccountKey', async () => {
    const ctx = makeCtx('GET', ['akande']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('DELETE returns 401 without AccountKey', async () => {
    const ctx = makeCtx('DELETE', ['akande']);
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(401);
  });

  it('POST returns 401 without AccountKey', async () => {
    const ctx = makeCtx('POST', ['akande', 'domains']);
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  // ── GET zone details ──
  it('GET returns zone details with files', async () => {
    const ctx = makeCtx('GET', ['akande'], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Id).toBe('akande');
    expect(json.FileCount).toBe(2);
    expect(json.StorageZoneName).toBe('cloudcdn');
    expect(json.Files).toBeInstanceOf(Array);
    expect(json.Files.length).toBe(2);
    expect(json.Categories).toBeInstanceOf(Array);
    expect(json.Formats).toBeInstanceOf(Array);
  });

  it('GET returns 404 for nonexistent zone', async () => {
    const ctx = makeCtx('GET', ['nonexistent'], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(404);
  });

  it('GET returns 400 when zone id is empty', async () => {
    const ctx = makeCtx('GET', [], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── DELETE zone ──
  it('DELETE returns 501 without GITHUB_TOKEN', async () => {
    const ctx = makeCtx('DELETE', ['akande'], { accountKey: 'acct-123' });
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(501);
  });

  it('DELETE rejects path traversal in zone id', async () => {
    const ctx = makeCtx('DELETE', ['..'], { accountKey: 'acct-123', githubToken: 'tok', githubRepo: 'r' });
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(400);
  });

  it('DELETE returns 404 when zone has no files', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ tree: [] }), { status: 200 })
    );
    const ctx = makeCtx('DELETE', ['empty'], {
      accountKey: 'acct-123', githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(404);
  });

  it('DELETE removes zone via GitHub API', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tree: [
          { path: 'clients/testzone/v1/logos/.gitkeep', type: 'blob' },
          { path: 'clients/testzone/v1/banners/.gitkeep', type: 'blob' },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'head-sha' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 'tree-sha' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'new-tree' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'commit-sha' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const ctx = makeCtx('DELETE', ['testzone'], {
      accountKey: 'acct-123', githubToken: 'ghp_test', githubRepo: 'user/repo',
    });
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.FilesRemoved).toBe(2);
    expect(json.EdgeStatus).toBe('purging');
  });

  // ── POST: Domain addition ──
  it('POST returns 404 for unknown sub-route', async () => {
    const ctx = makeCtx('POST', ['akande', 'unknown'], { accountKey: 'acct-123' });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(404);
  });

  it('POST returns 501 without Cloudflare credentials', async () => {
    const ctx = makeCtx('POST', ['akande', 'domains'], {
      accountKey: 'acct-123',
      body: { Hostname: 'cdn.akande.com' },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(501);
  });

  it('POST rejects invalid hostname (no dot)', async () => {
    const ctx = makeCtx('POST', ['akande', 'domains'], {
      accountKey: 'acct-123',
      body: { Hostname: 'nodot' },
      cfAccountId: 'cf-id',
      cfApiToken: 'cf-token',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.Message).toContain('hostname');
  });

  it('POST adds custom domain successfully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: { id: 'domain-id' } }), { status: 200 })
    );
    const ctx = makeCtx('POST', ['akande', 'domains'], {
      accountKey: 'acct-123',
      body: { Hostname: 'cdn.akande.com' },
      cfAccountId: 'cf-id',
      cfApiToken: 'cf-token',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.Hostname).toBe('cdn.akande.com');
    expect(json.Zone).toBe('akande');
  });

  it('POST returns error when Cloudflare API fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, errors: [{ message: 'bad' }] }), { status: 400 })
    );
    const ctx = makeCtx('POST', ['akande', 'domains'], {
      accountKey: 'acct-123',
      body: { Hostname: 'cdn.akande.com' },
      cfAccountId: 'cf-id',
      cfApiToken: 'cf-token',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  // ── OPTIONS ──
  it('OPTIONS returns 204', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });

  // --- Extended zone detail tests ---

  it('OPTIONS has CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('GET zone detail includes File list', async () => {
    const ctx = makeCtx('GET', ['akande'], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Files).toBeInstanceOf(Array);
    expect(json.Files.length).toBeGreaterThan(0);
  });

  it('GET zone detail includes StorageUsed', async () => {
    const ctx = makeCtx('GET', ['akande'], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.StorageUsed).toBeGreaterThan(0);
    expect(json.StorageUsedHuman).toBeDefined();
  });

  it('GET zone detail includes Name field', async () => {
    const ctx = makeCtx('GET', ['akande'], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Name).toBe('akande');
  });

  it('GET 404 for nonexistent zone is valid JSON', async () => {
    const ctx = makeCtx('GET', ['doesnotexist'], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('GET zone detail has CORS header', async () => {
    const ctx = makeCtx('GET', ['akande'], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('GET zone detail has Content-Type JSON', async () => {
    const ctx = makeCtx('GET', ['akande'], { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('DELETE without GITHUB_TOKEN returns 501', async () => {
    const ctx = makeCtx('DELETE', ['akande'], { accountKey: 'acct-123' });
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(501);
  });

  it('DELETE 401 without auth', async () => {
    const ctx = makeCtx('DELETE', ['akande'], {});
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(401);
  });

  it('POST domain 401 without auth', async () => {
    const ctx = makeCtx('POST', ['akande', 'domains'], { body: { Hostname: 'cdn.example.com' } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  it('POST domain rejects hostname with spaces', async () => {
    const ctx = makeCtx('POST', ['akande', 'domains'], {
      accountKey: 'acct-123',
      body: { Hostname: 'bad host.com' },
      cfAccountId: 'cf-id',
      cfApiToken: 'cf-token',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });
});
