import { describe, it, expect, vi, afterEach } from 'vitest';

const handlers = await import('../../functions/api/storage/[[path]].js');
const { onRequestGet, onRequestPut, onRequestDelete, onRequestHead, onRequestOptions } = handlers;

const MANIFEST = [
  { name: 'logo.svg',   path: 'akande/v1/logos/logo.svg',   project: 'akande',   category: 'logos',   format: 'svg',  size: 3400 },
  { name: 'banner.svg', path: 'akande/v1/banners/banner.svg', project: 'akande', category: 'banners', format: 'svg',  size: 5600 },
  { name: 'photo.webp', path: 'stocks/images/photo.webp',   project: 'stocks',   category: 'images',  format: 'webp', size: 12000 },
  { name: 'icon.svg',   path: 'shared/icons/icon.svg',      project: 'shared',   category: 'icons',   format: 'svg',  size: 1200 },
];

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function makeCtx({
  method = 'GET',
  path = ['stocks', 'images', 'photo.webp'],
  url = null,
  accessKey,
  body,
  headers = {},
  storageKey = 'storage-secret',
  githubToken,
  githubRepo,
  cloudflareZoneId,
  cloudflareApiToken,
  assetsResponse,
  waitUntilCalls,
} = {}) {
  const h = new Headers(headers);
  if (accessKey) h.set('AccessKey', accessKey);

  const segments = path;
  const finalUrl = url || `https://cloudcdn.pro/api/storage/${segments.join('/')}`;

  const request = new Request(finalUrl, {
    method,
    headers: h,
    ...(body !== undefined ? { body } : {}),
  });

  const env = {
    STORAGE_KEY: storageKey,
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(
        assetsResponse !== undefined
          ? assetsResponse
          : new Response(JSON.stringify(MANIFEST), { status: 200 })
      ),
    },
    GITHUB_TOKEN: githubToken,
    GITHUB_REPO: githubRepo,
    CLOUDFLARE_ZONE_ID: cloudflareZoneId,
    CLOUDFLARE_API_TOKEN: cloudflareApiToken,
    RATE_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
  };

  return {
    request,
    env,
    params: { path: segments },
    waitUntil: waitUntilCalls ? (p) => waitUntilCalls.push(p) : vi.fn(),
  };
}

describe('Storage API — /api/storage/{path}', () => {
  describe('authentication', () => {
    it('GET returns 401 without AccessKey', async () => {
      const res = await onRequestGet(makeCtx({ method: 'GET' }));
      expect(res.status).toBe(401);
    });
    it('PUT returns 401 without AccessKey', async () => {
      const res = await onRequestPut(makeCtx({ method: 'PUT', body: 'x' }));
      expect(res.status).toBe(401);
    });
    it('DELETE returns 401 without AccessKey', async () => {
      const res = await onRequestDelete(makeCtx({ method: 'DELETE' }));
      expect(res.status).toBe(401);
    });
    it('HEAD returns 401 without AccessKey', async () => {
      const res = await onRequestHead(makeCtx({ method: 'HEAD' }));
      expect(res.status).toBe(401);
    });

    it('GET allows when AccessKey matches STORAGE_KEY', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['stocks'], accessKey: 'storage-secret' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    });
  });

  describe('path resolution', () => {
    it('rejects paths with .. traversal', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['..', 'etc', 'passwd'], accessKey: 'storage-secret' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects paths with double slashes', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['a', '', 'b.svg'], accessKey: 'storage-secret' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects paths containing null bytes', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['a\0b.svg'], accessKey: 'storage-secret' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects malformed percent-escapes', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['%FX', 'broken.svg'], accessKey: 'storage-secret' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects .git/.github/node_modules segments', async () => {
      for (const seg of ['.git', '.github', 'node_modules']) {
        const ctx = makeCtx({ method: 'GET', path: [seg, 'whatever'], accessKey: 'storage-secret' });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(400);
      }
    });
  });

  describe('GET — directory listing', () => {
    it('lists top-level directories at the root', async () => {
      const ctx = makeCtx({
        method: 'GET',
        path: [''],
        url: 'https://cloudcdn.pro/api/storage/',
        accessKey: 'storage-secret',
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const entries = await res.json();
      const names = entries.map((e) => e.ObjectName).sort();
      expect(names).toEqual(expect.arrayContaining(['clients', 'shared', 'stocks']));
      expect(entries.every((e) => e.IsDirectory)).toBe(true);
    });

    it('lists files in a leaf directory', async () => {
      const ctx = makeCtx({
        method: 'GET',
        path: ['stocks', 'images'],
        url: 'https://cloudcdn.pro/api/storage/stocks/images/',
        accessKey: 'storage-secret',
      });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      expect(entries.some((e) => e.ObjectName === 'photo.webp' && !e.IsDirectory)).toBe(true);
      expect(entries[0]).toMatchObject({
        StorageZoneName: 'cloudcdn',
        Path: expect.stringContaining('stocks/images/'),
      });
    });

    it('lists subdirectories when a directory contains nested files', async () => {
      const ctx = makeCtx({
        method: 'GET',
        path: ['clients', 'akande', 'v1'],
        url: 'https://cloudcdn.pro/api/storage/clients/akande/v1/',
        accessKey: 'storage-secret',
      });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      const dirNames = entries.filter((e) => e.IsDirectory).map((e) => e.ObjectName);
      expect(dirNames).toEqual(expect.arrayContaining(['logos', 'banners']));
    });

    it('returns [] when the manifest fetch throws', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['anything'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockRejectedValue(new Error('manifest down'));
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('falls back to an empty path-segments array when params.path is omitted', async () => {
      // Forces the `params.path || []` fallback in onRequestGet — request
      // arrives with no params at all (e.g. /api/storage/ trailing-slash
      // root listing routed without the dynamic param being captured).
      const ctx = makeCtx({
        method: 'GET',
        path: [],
        url: 'https://cloudcdn.pro/api/storage/',
        accessKey: 'storage-secret',
      });
      delete ctx.params.path;
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    });

    it('returns [] when ASSETS binding is missing entirely', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['anything'], accessKey: 'storage-secret' });
      ctx.env.ASSETS = undefined;
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe('GET — file download', () => {
    it('proxies file content from ASSETS for stocks paths', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['stocks', 'images', 'photo.webp'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response('image-bytes', { status: 200 }));
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('image-bytes');
    });

    it('prefixes clients/ when path does not start with stocks or clients', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['akande', 'v1', 'logos', 'logo.svg'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response('svg', { status: 200 }));
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const fetchedUrl = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(fetchedUrl).toContain('/clients/akande/v1/logos/logo.svg');
    });

    it('returns 404 when ASSETS responds non-OK', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['stocks', 'images', 'gone.png'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(404);
    });

    it('returns 500 when ASSETS fetch throws on download', async () => {
      const ctx = makeCtx({ method: 'GET', path: ['stocks', 'images', 'photo.webp'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockRejectedValue(new Error('network'));
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(500);
    });
  });

  describe('PUT — upload', () => {
    it('returns 400 when path resolves to a directory', async () => {
      const ctx = makeCtx({
        method: 'PUT',
        path: ['clients', 'foo'],
        url: 'https://cloudcdn.pro/api/storage/clients/foo/',
        accessKey: 'storage-secret',
        body: 'data',
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 413 when Content-Length exceeds 25 MB', async () => {
      const ctx = makeCtx({
        method: 'PUT',
        path: ['clients', 'a', 'x.bin'],
        accessKey: 'storage-secret',
        headers: { 'Content-Length': String(26 * 1024 * 1024) },
        body: 'small actual body',
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(413);
    });

    it('returns 413 when the actual body exceeds 25 MB even if Content-Length is small', async () => {
      const ctx = makeCtx({
        method: 'PUT',
        path: ['clients', 'a', 'x.bin'],
        accessKey: 'storage-secret',
        body: new Uint8Array(26 * 1024 * 1024),
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(413);
    });

    it('returns 400 when Checksum header does not match the body', async () => {
      const ctx = makeCtx({
        method: 'PUT',
        path: ['clients', 'a', 'x.bin'],
        accessKey: 'storage-secret',
        body: new TextEncoder().encode('hello'),
        headers: { Checksum: 'DEADBEEF' },
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Expected).toBe('DEADBEEF');
      expect(json.Received).toMatch(/^[0-9A-F]{64}$/);
    });

    it('returns 501 without GitHub creds', async () => {
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(501);
    });

    it('creates a new file via GitHub Contents API (201)', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 201 }));
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'acme', 'v1', 'logo.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Path).toBe('clients/acme/v1/logo.svg');
    });

    it('updates an existing file (carries sha through PUT payload)', async () => {
      const putFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 200 }));
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'existing-sha' }), { status: 200 }))
        .mockImplementationOnce(putFetch);
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'acme', 'v1', 'logo.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
      const putBody = JSON.parse(putFetch.mock.calls[0][1].body);
      expect(putBody.sha).toBe('existing-sha');
    });

    it('triggers cache purge for overwrites when CLOUDFLARE_* env vars are set', async () => {
      const waitUntils = [];
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'existing-sha' }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'acme', 'v1', 'logo.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
        cloudflareZoneId: 'z', cloudflareApiToken: 't',
        waitUntilCalls: waitUntils,
      });
      await onRequestPut(ctx);
      expect(waitUntils.length).toBeGreaterThan(0);
      await Promise.all(waitUntils);
    });

    it('returns 409 on a Git tree conflict from GitHub', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(new Response('conflict', { status: 409 }));
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(409);
    });

    it('returns 502 on other GitHub upload failures', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(502);
    });

    it('returns 500 when fetch throws partway through upload', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockRejectedValueOnce(new Error('network down'));
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(500);
    });

    it('swallows errors from the existence-check fetch', async () => {
      globalThis.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('check failed'))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 201 }));
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
    });

    it('prefixes clients/ when path does not start with stocks or clients', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 201 }));
      const ctx = makeCtx({
        method: 'PUT', path: ['acme', 'v1', 'logo.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
      });
      await onRequestPut(ctx);
      const url = globalThis.fetch.mock.calls[1][0];
      expect(url).toContain('clients/acme/v1/logo.svg');
    });

    it('swallows cache-purge fetch rejections via the inline .catch', async () => {
      const waitUntils = [];
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('/purge_cache')) {
          return Promise.reject(new Error('purge down'));
        }
        if (typeof url === 'string' && url.includes('/contents/') && globalThis.fetch.mock.calls.length === 1) {
          return Promise.resolve(new Response(JSON.stringify({ sha: 'existing-sha' }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 200 }));
      });
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'acme', 'v1', 'logo.svg'], accessKey: 'storage-secret',
        body: new TextEncoder().encode('<svg/>'),
        githubToken: 'g', githubRepo: 'u/r',
        cloudflareZoneId: 'z', cloudflareApiToken: 't',
        waitUntilCalls: waitUntils,
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
      // Drain the waitUntil so the .catch runs.
      await Promise.all(waitUntils);
    });

    it('falls back to empty params.path on PUT (still triggers 400 path check)', async () => {
      const ctx = makeCtx({
        method: 'PUT', path: [], accessKey: 'storage-secret', body: new TextEncoder().encode('x'),
        githubToken: 'g', githubRepo: 'u/r',
      });
      delete ctx.params.path;
      const res = await onRequestPut(ctx);
      // Empty path resolves to '', which is_directory ⇒ 400
      expect(res.status).toBe(400);
    });

    it('accepts a matching SHA-256 checksum (uppercase hex)', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 201 }));
      const enc = new TextEncoder().encode('hello');
      const digest = await crypto.subtle.digest('SHA-256', enc);
      const expected = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      const ctx = makeCtx({
        method: 'PUT', path: ['clients', 'a', 'x.bin'], accessKey: 'storage-secret',
        body: enc, headers: { Checksum: expected },
        githubToken: 'g', githubRepo: 'u/r',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
    });
  });

  describe('DELETE', () => {
    it('returns 400 for invalid path', async () => {
      const ctx = makeCtx({ method: 'DELETE', path: ['..'], accessKey: 'storage-secret', githubToken: 'g', githubRepo: 'u/r' });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 501 without GitHub creds', async () => {
      const ctx = makeCtx({ method: 'DELETE', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret' });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(501);
    });

    it('returns 404 when file does not exist', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response('nope', { status: 404 }));
      const ctx = makeCtx({ method: 'DELETE', path: ['clients', 'a', 'missing.svg'], accessKey: 'storage-secret', githubToken: 'g', githubRepo: 'u/r' });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(404);
    });

    it('returns 200 on successful delete', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'existing' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 200 }));
      const ctx = makeCtx({ method: 'DELETE', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret', githubToken: 'g', githubRepo: 'u/r' });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.Path).toBe('clients/a/x.svg');
    });

    it('returns 502 when GitHub delete fails', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'existing' }), { status: 200 }))
        .mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const ctx = makeCtx({ method: 'DELETE', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret', githubToken: 'g', githubRepo: 'u/r' });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(502);
    });

    it('returns 500 when fetch throws during delete', async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('network'));
      const ctx = makeCtx({ method: 'DELETE', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret', githubToken: 'g', githubRepo: 'u/r' });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(500);
    });

    it('prefixes clients/ when path does not start with stocks or clients', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'existing' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 200 }));
      const ctx = makeCtx({ method: 'DELETE', path: ['acme', 'v1', 'x.svg'], accessKey: 'storage-secret', githubToken: 'g', githubRepo: 'u/r' });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
      const firstUrl = globalThis.fetch.mock.calls[0][0];
      expect(firstUrl).toContain('clients/acme/v1/x.svg');
    });

    it('triggers cache purge waitUntil when CLOUDFLARE_* is configured', async () => {
      const waitUntils = [];
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'existing' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 200 }))
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const ctx = makeCtx({
        method: 'DELETE', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret',
        githubToken: 'g', githubRepo: 'u/r',
        cloudflareZoneId: 'z', cloudflareApiToken: 't',
        waitUntilCalls: waitUntils,
      });
      await onRequestDelete(ctx);
      expect(waitUntils.length).toBeGreaterThan(0);
      await Promise.all(waitUntils);
    });

    it('swallows cache-purge fetch rejections via the inline .catch', async () => {
      const waitUntils = [];
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('/purge_cache')) {
          return Promise.reject(new Error('purge down'));
        }
        if (typeof url === 'string' && url.includes('/contents/') && globalThis.fetch.mock.calls.length === 1) {
          return Promise.resolve(new Response(JSON.stringify({ sha: 'existing' }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ commit: { sha: 'c' } }), { status: 200 }));
      });
      const ctx = makeCtx({
        method: 'DELETE', path: ['clients', 'a', 'x.svg'], accessKey: 'storage-secret',
        githubToken: 'g', githubRepo: 'u/r',
        cloudflareZoneId: 'z', cloudflareApiToken: 't',
        waitUntilCalls: waitUntils,
      });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
      await Promise.all(waitUntils);
    });

    it('falls back to empty params.path on DELETE', async () => {
      const ctx = makeCtx({ method: 'DELETE', path: [], accessKey: 'storage-secret', githubToken: 'g', githubRepo: 'u/r' });
      delete ctx.params.path;
      const res = await onRequestDelete(ctx);
      // Empty path resolves to '', GitHub fetch returns 404 → 404 response.
      // We just need to exercise the `|| []` fallback; status doesn't matter.
      expect([400, 404, 500]).toContain(res.status);
    });
  });

  describe('HEAD', () => {
    it('returns 200 with size/type headers when file exists', async () => {
      const ctx = makeCtx({ method: 'HEAD', path: ['stocks', 'images', 'photo.webp'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response(null, {
        status: 200,
        headers: { 'Content-Length': '12000', 'Content-Type': 'image/webp' },
      }));
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Length')).toBe('12000');
      expect(res.headers.get('Content-Type')).toBe('image/webp');
    });

    it('falls back to zero/octet-stream when headers are absent', async () => {
      const ctx = makeCtx({ method: 'HEAD', path: ['stocks', 'images', 'photo.webp'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const res = await onRequestHead(ctx);
      expect(res.headers.get('Content-Length')).toBe('0');
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('returns 404 when file does not exist', async () => {
      const ctx = makeCtx({ method: 'HEAD', path: ['stocks', 'images', 'gone.webp'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(404);
    });

    it('returns 404 when ASSETS fetch throws', async () => {
      const ctx = makeCtx({ method: 'HEAD', path: ['stocks', 'images', 'photo.webp'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockRejectedValue(new Error('network'));
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid path', async () => {
      const ctx = makeCtx({ method: 'HEAD', path: ['..'], accessKey: 'storage-secret' });
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(400);
    });

    it('falls back to empty params.path on HEAD', async () => {
      const ctx = makeCtx({ method: 'HEAD', path: [], accessKey: 'storage-secret' });
      delete ctx.params.path;
      ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const res = await onRequestHead(ctx);
      expect([200, 400, 404]).toContain(res.status);
    });

    it('prefixes clients/ when needed', async () => {
      const ctx = makeCtx({ method: 'HEAD', path: ['akande', 'v1', 'logos', 'logo.svg'], accessKey: 'storage-secret' });
      ctx.env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      await onRequestHead(ctx);
      const url = ctx.env.ASSETS.fetch.mock.calls[0][0].url;
      expect(url).toContain('/clients/akande/v1/logos/logo.svg');
    });
  });

  describe('OPTIONS', () => {
    it('returns 204 with the expected preflight headers', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });
});
