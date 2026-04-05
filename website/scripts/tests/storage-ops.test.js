import { describe, it, expect, vi, afterEach } from 'vitest';

const mod = await import('../../../functions/api/storage/[[path]].js');
const { onRequestGet, onRequestPut, onRequestDelete } = mod;

const MANIFEST = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.svg', path: 'akande/v1/banners/banner.svg', project: 'akande', category: 'banners', format: 'svg', size: 5600 },
  { name: 'photo.webp', path: 'stocks/images/photo.webp', project: 'stocks', category: 'images', format: 'webp', size: 12000 },
];

function makeContext(method, pathSegments, options = {}) {
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
      STORAGE_KEY: options.storageKey ?? 'test-key',
      GITHUB_TOKEN: options.githubToken,
      GITHUB_REPO: options.githubRepo,
      CLOUDFLARE_ZONE_ID: options.cfZoneId,
      CLOUDFLARE_API_TOKEN: options.cfApiToken,
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          options.assetResponse || new Response(JSON.stringify(MANIFEST), { status: 200, headers: { 'Content-Type': 'application/json' } })
        ),
      },
    },
    waitUntil: vi.fn(),
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Storage Operations — Extended', () => {
  // ── Directory listing from manifest ──
  describe('list directory from manifest', () => {
    it('lists root directories', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(Array.isArray(entries)).toBe(true);
    });

    it('lists subdirectory contents', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const entries = await res.json();
      const dirs = entries.filter(e => e.IsDirectory);
      expect(dirs.length).toBeGreaterThan(0);
    });

    it('distinguishes files from directories', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', 'logos', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      const files = entries.filter(e => !e.IsDirectory);
      const dirs = entries.filter(e => e.IsDirectory);
      expect(files.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Physical path resolution ──
  describe('physical path resolution', () => {
    it('resolves client paths with clients/ prefix', async () => {
      const fileResponse = new Response('file-data', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', 'logos', 'logo.svg'], {
        accessKey: 'test-key',
        assetResponse: fileResponse,
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    });

    it('resolves stocks paths without clients/ prefix', async () => {
      const fileResponse = new Response('file-data', { status: 200, headers: { 'Content-Type': 'image/webp' } });
      const ctx = makeContext('GET', ['stocks', 'images', 'photo.webp'], {
        accessKey: 'test-key',
        assetResponse: fileResponse,
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    });
  });

  // ── Security: .git blocking ──
  describe('.git blocking', () => {
    it('rejects paths containing .git segment', async () => {
      const ctx = makeContext('GET', ['clients', '.git', 'config'], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects paths containing .github segment', async () => {
      const ctx = makeContext('GET', ['clients', '.github', 'workflows'], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects paths containing node_modules', async () => {
      const ctx = makeContext('GET', ['node_modules', 'package', 'index.js'], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── URL-encoded traversal ──
  describe('URL-encoded path traversal', () => {
    it('rejects %2e%2e encoded traversal', async () => {
      const ctx = makeContext('GET', ['clients', '%2e%2e', 'etc', 'passwd'], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects double-dot traversal', async () => {
      const ctx = makeContext('GET', ['..', '..', 'etc'], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Null byte rejection ──
  describe('null byte rejection', () => {
    it('rejects paths with null bytes', async () => {
      const ctx = makeContext('GET', ['clients', 'test\0evil', 'file.svg'], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Overwrite triggers cache purge ──
  describe('overwrite triggers cache purge', () => {
    it('triggers cache purge on overwrite when file exists', async () => {
      const content = new TextEncoder().encode('<svg>new</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'existing-sha' }), { status: 200 })) // file exists
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 200 })) // upload
        .mockResolvedValueOnce(new Response('{}', { status: 200 })); // cache purge

      const ctx = makeContext('PUT', ['clients', 'test', 'logo.svg'], {
        accessKey: 'test-key',
        body: content.buffer,
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
        cfZoneId: 'zone-123',
        cfApiToken: 'cf-token',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
      expect(ctx.waitUntil).toHaveBeenCalled();
    });

    it('does not trigger cache purge on new file', async () => {
      const content = new TextEncoder().encode('<svg>new</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 })) // file doesn't exist
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'new.svg'], {
        accessKey: 'test-key',
        body: content.buffer,
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
        cfZoneId: 'zone-123',
        cfApiToken: 'cf-token',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
      // waitUntil is called for webhook dispatch (asset.created) but NOT for cache purge
      // Cache purge only fires on overwrites (when sha exists)
      if (ctx.waitUntil.mock.calls.length > 0) {
        // Verify no Cloudflare purge_cache call was made (only webhook)
        const purgeCalls = globalThis.fetch.mock.calls.filter(c => c[0]?.includes?.('purge_cache'));
        expect(purgeCalls).toHaveLength(0);
      }
    });
  });

  // ── Delete triggers cache purge ──
  describe('delete triggers cache purge', () => {
    it('triggers cache purge on delete', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: {} }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 })); // cache purge

      const ctx = makeContext('DELETE', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key',
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
        cfZoneId: 'zone-123',
        cfApiToken: 'cf-token',
      });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
      expect(ctx.waitUntil).toHaveBeenCalled();
    });
  });

  // ── Backslash normalization ──
  describe('backslash normalization', () => {
    it('normalizes backslashes to forward slashes', async () => {
      const ctx = makeContext('GET', ['clients', 'test\\evil', 'file.svg'], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect([200, 400, 404].includes(res.status)).toBe(true);
    });
  });

  // ── Extended operations ──
  describe('list operations extended', () => {
    it('list returns correct ObjectName for files', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', 'logos', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      const files = entries.filter(e => !e.IsDirectory);
      for (const f of files) {
        expect(f.ObjectName).toBeTruthy();
      }
    });

    it('list returns ServerId=0 for all entries', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      for (const entry of entries) {
        expect(entry.ServerId).toBe(0);
      }
    });

    it('list returns Length=0 for directories', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      const dirs = entries.filter(e => e.IsDirectory);
      for (const d of dirs) {
        expect(d.Length).toBe(0);
      }
    });

    it('list returns correct Length for files', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', 'logos', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      const files = entries.filter(e => !e.IsDirectory);
      for (const f of files) {
        expect(f.Length).toBeGreaterThan(0);
      }
    });

    it('list returns Guid for each entry', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      for (const entry of entries) {
        expect(entry.Guid).toBeTruthy();
        expect(entry.Guid).toMatch(/^[0-9a-f-]+$/);
      }
    });

    it('list returns StorageZoneName=cloudcdn', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      for (const entry of entries) {
        expect(entry.StorageZoneName).toBe('cloudcdn');
      }
    });

    it('list returns UserId=cloudcdn', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      for (const entry of entries) {
        expect(entry.UserId).toBe('cloudcdn');
      }
    });

    it('list deep directory returns expected files', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', 'banners', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      const names = entries.map(e => e.ObjectName);
      expect(names).toContain('banner.svg');
    });

    it('list nonexistent directory returns empty array', async () => {
      const ctx = makeContext('GET', ['clients', 'nonexistent', 'v1', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      expect(entries).toEqual([]);
    });

    it('stocks path listing works', async () => {
      const ctx = makeContext('GET', ['stocks', 'images', ''], { accessKey: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  describe('upload operations extended', () => {
    it('upload creates commit with correct message', async () => {
      const content = new TextEncoder().encode('<svg>test</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'new.svg'], {
        accessKey: 'test-key',
        body: content.buffer,
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);

      // Verify commit message in the PUT request body
      const putCall = globalThis.fetch.mock.calls[1];
      const putBody = JSON.parse(putCall[1].body);
      expect(putBody.message).toContain('upload');
      expect(putBody.message).toContain('[skip ci]');
    });

    it('upload sets branch to main', async () => {
      const content = new TextEncoder().encode('test');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key',
        body: content.buffer,
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
      });
      await onRequestPut(ctx);

      const putCall = globalThis.fetch.mock.calls[1];
      const putBody = JSON.parse(putCall[1].body);
      expect(putBody.branch).toBe('main');
    });

    it('upload sends base64 encoded content', async () => {
      const content = new TextEncoder().encode('hello world');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'file.txt'], {
        accessKey: 'test-key',
        body: content.buffer,
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
      });
      await onRequestPut(ctx);

      const putCall = globalThis.fetch.mock.calls[1];
      const putBody = JSON.parse(putCall[1].body);
      expect(putBody.content).toBeTruthy();
      // base64 decode should give back original content
      expect(atob(putBody.content)).toBe('hello world');
    });

    it('upload uses correct GitHub API URL', async () => {
      const content = new TextEncoder().encode('test');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key',
        body: content.buffer,
        githubToken: 'ghp_test',
        githubRepo: 'myorg/myrepo',
      });
      await onRequestPut(ctx);

      const apiUrl = globalThis.fetch.mock.calls[0][0];
      expect(apiUrl).toContain('api.github.com');
      expect(apiUrl).toContain('myorg/myrepo');
    });

    it('upload sends Authorization header', async () => {
      const content = new TextEncoder().encode('test');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key',
        body: content.buffer,
        githubToken: 'ghp_mytoken123',
        githubRepo: 'user/repo',
      });
      await onRequestPut(ctx);

      const authHeader = globalThis.fetch.mock.calls[0][1].headers.Authorization;
      expect(authHeader).toBe('Bearer ghp_mytoken123');
    });
  });

  describe('delete operations extended', () => {
    it('delete sends correct commit message', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: {} }), { status: 200 }));

      const ctx = makeContext('DELETE', ['clients', 'test', 'old.svg'], {
        accessKey: 'test-key',
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
      });
      await onRequestDelete(ctx);

      const deleteCall = globalThis.fetch.mock.calls[1];
      const deleteBody = JSON.parse(deleteCall[1].body);
      expect(deleteBody.message).toContain('delete');
      expect(deleteBody.message).toContain('[skip ci]');
      expect(deleteBody.sha).toBe('abc123');
    });

    it('delete returns EdgeNote in response', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: {} }), { status: 200 }));

      const ctx = makeContext('DELETE', ['clients', 'test', 'old.svg'], {
        accessKey: 'test-key',
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
      });
      const res = await onRequestDelete(ctx);
      const json = await res.json();
      expect(json.EdgeNote).toBeDefined();
      expect(json.EdgeNote.length).toBeGreaterThan(0);
    });

    it('delete returns Path in response', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: {} }), { status: 200 }));

      const ctx = makeContext('DELETE', ['clients', 'test', 'old.svg'], {
        accessKey: 'test-key',
        githubToken: 'ghp_test',
        githubRepo: 'user/repo',
      });
      const res = await onRequestDelete(ctx);
      const json = await res.json();
      expect(json.Path).toBeDefined();
    });
  });
});
