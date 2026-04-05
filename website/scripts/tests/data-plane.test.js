/**
 * Data Plane regression — cross-cutting tests for storage, batch, assets, metadata.
 *
 * Tests the lifecycle: upload → list → download → transform → delete,
 * batch commit atomicity, asset catalog consistency, and auth patterns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearManifestCache } from '../../../functions/api/_shared.js';

const storageModule = await import('../../../functions/api/storage/[[path]].js');
const batchModule = await import('../../../functions/api/storage/batch.js');
const assetsModule = await import('../../../functions/api/assets.js');
const metadataModule = await import('../../../functions/api/assets/metadata.js');

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.svg', path: 'akande/v1/banners/banner.svg', project: 'akande', category: 'banners', format: 'svg', size: 5600 },
  { name: 'photo.webp', path: 'stocks/images/photo.webp', project: 'stocks', category: 'images', format: 'webp', size: 12000 },
];

const originalFetch = globalThis.fetch;

function makeStorageCtx(method, pathSegments, options = {}) {
  const h = new Headers(options.headers || {});
  if (options.accessKey) h.set('AccessKey', options.accessKey);

  return {
    request: {
      url: `https://cloudcdn.pro/api/storage/${pathSegments.join('/')}`,
      method,
      headers: h,
      arrayBuffer: vi.fn().mockResolvedValue(options.body || new ArrayBuffer(0)),
    },
    params: { path: pathSegments },
    env: {
      STORAGE_KEY: options.storageKey ?? 'test-key-123',
      DASHBOARD_SECRET: options.dashboardSecret,
      GITHUB_TOKEN: options.githubToken,
      GITHUB_REPO: options.githubRepo,
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          options.assetResponse || new Response(JSON.stringify(manifestData), { status: 200 })
        ),
      },
    },
    waitUntil: vi.fn(),
  };
}

function makeAssetsCtx(url, options = {}) {
  const h = new Headers();
  if (options.accessKey) h.set('AccessKey', options.accessKey);
  return {
    request: { url: `https://cloudcdn.pro${url}`, headers: h },
    env: {
      STORAGE_KEY: options.storageKey ?? 'test-key',
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })),
      },
    },
  };
}

beforeEach(() => clearManifestCache());
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Data Plane — Upload → List → Download → Transform → Delete lifecycle', () => {
  it('upload returns 201 with ISO date', async () => {
    const content = new TextEncoder().encode('<svg>test</svg>');
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

    const ctx = makeStorageCtx('PUT', ['clients', 'akande', 'v1', 'logos', 'new.svg'], {
      accessKey: 'test-key-123',
      body: content.buffer,
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await storageModule.onRequestPut(ctx);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.DateCreated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('list directory returns valid entries after upload', async () => {
    const ctx = makeStorageCtx('GET', ['clients', 'akande', 'v1', 'logos', ''], {
      accessKey: 'test-key-123',
    });
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const entries = await res.json();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('download file returns content with CORS', async () => {
    const fileRes = new Response('file-content', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
    const ctx = makeStorageCtx('GET', ['clients', 'akande', 'v1', 'logos', 'logo.svg'], {
      accessKey: 'test-key-123',
      assetResponse: fileRes,
    });
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('transform returns image options via cf.image', async () => {
    const { onRequestGet } = await import('../../../functions/api/transform.js');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('imgdata', { status: 200, headers: { 'Content-Type': 'image/webp' } }));
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/transform?url=/akande/v1/logos/logo.svg&w=100&format=webp' },
      env: { RATE_KV: null },
    };
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(globalThis.fetch.mock.calls[0][1].cf.image.width).toBe(100);
    expect(globalThis.fetch.mock.calls[0][1].cf.image.format).toBe('webp');
  });

  it('delete file returns 200 with EdgeStatus', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ commit: {} }), { status: 200 }));

    const ctx = makeStorageCtx('DELETE', ['clients', 'akande', 'v1', 'logos', 'logo.svg'], {
      accessKey: 'test-key-123',
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await storageModule.onRequestDelete(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.EdgeStatus).toBe('purging');
  });
});

describe('Data Plane — Batch upload creates single commit', () => {
  it('batch upload of 3 files produces exactly 1 commit via Git Database API', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b2' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b3' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'newtree' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'commitsha' }), { status: 201 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const files = [
      { path: 'clients/akande/v1/logos/a.svg', content: 'PHN2Zz48L3N2Zz4=', encoding: 'base64' },
      { path: 'clients/akande/v1/logos/b.svg', content: 'PHN2Zz48L3N2Zz4=', encoding: 'base64' },
      { path: 'clients/akande/v1/logos/c.svg', content: 'PHN2Zz48L3N2Zz4=', encoding: 'base64' },
    ];

    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/batch',
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json', AccessKey: 'test-key-123' }),
        json: vi.fn().mockResolvedValue({ files }),
      },
      env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      waitUntil: vi.fn(),
    };

    const res = await batchModule.onRequestPost(ctx);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.Commit).toBe('commitsha');
    expect(json.Files).toHaveLength(3);

    // Verify exactly 1 tree creation (single atomic commit)
    const treeCalls = globalThis.fetch.mock.calls.filter(c => c[0].includes('/git/trees') && c[1]?.method === 'POST');
    expect(treeCalls).toHaveLength(1);
  });
});

describe('Data Plane — Asset catalog reflects manifest', () => {
  it('assets endpoint returns items matching manifest', async () => {
    const ctx = makeAssetsCtx('/api/assets', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Data).toHaveLength(3);
    expect(json.Pagination.TotalItems).toBe(3);
  });

  it('metadata endpoint returns details for a specific asset', async () => {
    const ctx = makeAssetsCtx('/api/assets/metadata?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Name).toBe('logo.svg');
    expect(json.Format).toBe('svg');
    expect(json.CdnUrl).toContain('cloudcdn.pro');
  });
});

describe('Data Plane — All data plane endpoints accept AccessKey auth', () => {
  it('storage GET accepts AccessKey', async () => {
    const ctx = makeStorageCtx('GET', ['clients', ''], { accessKey: 'test-key-123' });
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('assets GET accepts AccessKey', async () => {
    const ctx = makeAssetsCtx('/api/assets', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('metadata GET accepts AccessKey', async () => {
    const ctx = makeAssetsCtx('/api/assets/metadata?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('storage rejects wrong AccessKey', async () => {
    const ctx = makeStorageCtx('GET', ['clients', ''], { accessKey: 'wrong-key' });
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('assets rejects wrong AccessKey', async () => {
    const ctx = makeAssetsCtx('/api/assets', { accessKey: 'wrong-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('metadata rejects wrong AccessKey', async () => {
    clearManifestCache();
    const ctx = makeAssetsCtx('/api/assets/metadata?path=test', { accessKey: 'wrong-key' });
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('storage GET 401 has JSON Content-Type', async () => {
    const ctx = makeStorageCtx('GET', ['clients', ''], { accessKey: 'wrong-key' });
    const res = await storageModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('assets GET 401 has CORS header', async () => {
    const ctx = makeAssetsCtx('/api/assets', { accessKey: 'wrong-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('Data Plane — Dev mode access', () => {
  it('storage allows access when no keys configured', async () => {
    const ctx = makeStorageCtx('GET', ['clients', ''], {});
    ctx.env.STORAGE_KEY = undefined;
    ctx.env.DASHBOARD_SECRET = undefined;
    ctx.env.DASHBOARD_PASSWORD = undefined;
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('assets allows access when no keys configured', async () => {
    clearManifestCache();
    const ctx = makeAssetsCtx('/api/assets', {});
    ctx.env.STORAGE_KEY = undefined;
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });
});

describe('Data Plane — Response format', () => {
  it('storage list returns valid JSON array', async () => {
    const ctx = makeStorageCtx('GET', ['clients', ''], { accessKey: 'test-key-123' });
    const res = await storageModule.onRequestGet(ctx);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  it('assets returns valid JSON with Pagination', async () => {
    clearManifestCache();
    const ctx = makeAssetsCtx('/api/assets', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json).toHaveProperty('Pagination');
    expect(json).toHaveProperty('Data');
  });

  it('metadata returns valid JSON with Path', async () => {
    clearManifestCache();
    const ctx = makeAssetsCtx('/api/assets/metadata?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json).toHaveProperty('Path');
  });
});
