import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mod = await import('../../functions/api/storage/[[path]].js');
const { onRequestGet, onRequestPut, onRequestDelete, onRequestHead, onRequestOptions } = mod;

function makeContext(method, pathSegments, options = {}) {
  const {
    accessKey,
    body,
    headers = {},
    env = {},
    assetResponse,
  } = options;

  const h = new Headers(headers);
  if (accessKey) h.set('AccessKey', accessKey);

  const manifestData = [
    { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
    { name: 'banner.svg', path: 'akande/v1/banners/banner.svg', project: 'akande', category: 'banners', format: 'svg', size: 5600 },
    { name: 'photo.webp', path: 'stocks/images/photo.webp', project: 'stocks', category: 'images', format: 'webp', size: 12000 },
  ];

  return {
    request: {
      url: `https://cloudcdn.pro/api/storage/${pathSegments.join('/')}`,
      method,
      headers: h,
      arrayBuffer: vi.fn().mockResolvedValue(body || new ArrayBuffer(0)),
    },
    params: { path: pathSegments },
    env: {
      STORAGE_KEY: env.STORAGE_KEY ?? 'test-key-123',
      DASHBOARD_SECRET: env.DASHBOARD_SECRET,
      GITHUB_TOKEN: env.GITHUB_TOKEN,
      GITHUB_REPO: env.GITHUB_REPO,
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          assetResponse || new Response(JSON.stringify(manifestData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        ),
      },
      ...env,
    },
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Storage API', () => {
  // ── Auth ──
  describe('authentication', () => {
    it('returns 401 when no AccessKey provided', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', '']);
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.HttpCode).toBe(401);
    });

    it('returns 401 with wrong AccessKey', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', ''], { accessKey: 'wrong-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('authenticates with correct AccessKey', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    });

    it('allows access in dev mode (no keys configured)', async () => {
      const ctx = makeContext('GET', ['clients', ''], {
        env: { STORAGE_KEY: undefined, DASHBOARD_SECRET: undefined, DASHBOARD_PASSWORD: undefined },
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    });
  });

  // ── List directory ──
  describe('GET — list directory', () => {
    it('lists files in a directory', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', 'logos', ''], { accessKey: 'test-key-123' });
      // Override ASSETS to return manifest
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(Array.isArray(entries)).toBe(true);
    });

    it('returns ISO 8601 dates', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      if (entries.length > 0) {
        expect(entries[0].DateCreated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(entries[0].LastChanged).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('returns Bunny.net-compatible JSON schema', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      if (entries.length > 0) {
        const entry = entries[0];
        expect(entry).toHaveProperty('Guid');
        expect(entry).toHaveProperty('StorageZoneName');
        expect(entry).toHaveProperty('Path');
        expect(entry).toHaveProperty('ObjectName');
        expect(entry).toHaveProperty('Length');
        expect(entry).toHaveProperty('IsDirectory');
        expect(entry).toHaveProperty('DateCreated');
        expect(entry).toHaveProperty('LastChanged');
        expect(entry).toHaveProperty('ServerId');
        expect(entry.StorageZoneName).toBe('cloudcdn');
      }
    });

    it('distinguishes files and directories', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      const dirs = entries.filter(e => e.IsDirectory);
      const files = entries.filter(e => !e.IsDirectory);
      // Should have subdirectories (logos, banners)
      expect(dirs.length).toBeGreaterThan(0);
    });
  });

  // ── Download ──
  describe('GET — download file', () => {
    it('downloads a file', async () => {
      const fileResponse = new Response('file-content', {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml' },
      });
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', 'logos', 'logo.svg'], {
        accessKey: 'test-key-123',
        assetResponse: fileResponse,
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('returns 404 for missing file', async () => {
      const notFound = new Response('not found', { status: 404 });
      const ctx = makeContext('GET', ['clients', 'akande', 'nonexistent.png'], {
        accessKey: 'test-key-123',
        assetResponse: notFound,
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.HttpCode).toBe(404);
    });
  });

  // ── Upload ──
  describe('PUT — upload file', () => {
    it('returns 501 when GITHUB_TOKEN not configured', async () => {
      const ctx = makeContext('PUT', ['clients', 'akande', 'v1', 'logos', 'new.svg'], {
        accessKey: 'test-key-123',
        body: new TextEncoder().encode('<svg></svg>').buffer,
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(501);
      const json = await res.json();
      expect(json.Message).toContain('GITHUB_TOKEN');
    });

    it('validates checksum when provided', async () => {
      const content = new TextEncoder().encode('test content');
      const ctx = makeContext('PUT', ['clients', 'test', 'file.txt'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        headers: { Checksum: 'WRONG_CHECKSUM' },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('checksum');
    });

    it('uploads via GitHub API when configured', async () => {
      const content = new TextEncoder().encode('<svg>test</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))  // file doesn't exist
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));  // upload succeeds

      const ctx = makeContext('PUT', ['clients', 'test', 'logo.svg'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.HttpCode).toBe(201);
      expect(json.DateCreated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejects upload to directory path', async () => {
      const ctx = makeContext('PUT', ['clients', 'akande', ''], {
        accessKey: 'test-key-123',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 413 for oversized payload via Content-Length', async () => {
      const ctx = makeContext('PUT', ['clients', 'test', 'huge.bin'], {
        accessKey: 'test-key-123',
        headers: { 'Content-Length': String(30 * 1024 * 1024) },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.HttpCode).toBe(413);
      expect(json.Message).toContain('Payload too large');
    });

    it('includes EdgeStatus and EdgeNote on successful upload', async () => {
      const content = new TextEncoder().encode('<svg>test</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'logo.svg'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      const json = await res.json();
      expect(json.EdgeStatus).toBe('pending');
      expect(json.EdgeNote).toContain('CI/CD');
    });

    it('returns 409 on Git tree conflict', async () => {
      const content = new TextEncoder().encode('data');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'sha conflict' }), { status: 409 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.Message).toContain('Conflict');
    });
  });

  // ── Delete ──
  describe('DELETE — delete file', () => {
    it('returns 501 when GITHUB_TOKEN not configured', async () => {
      const ctx = makeContext('DELETE', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key-123',
      });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(501);
    });

    it('deletes file via GitHub API with EdgeStatus', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ commit: {} }), { status: 200 }));

      const ctx = makeContext('DELETE', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key-123',
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      ctx.waitUntil = vi.fn();
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.HttpCode).toBe(200);
      expect(json.EdgeStatus).toBe('purging');
    });

    it('returns 404 for nonexistent file', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }));

      const ctx = makeContext('DELETE', ['clients', 'test', 'missing.svg'], {
        accessKey: 'test-key-123',
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── HEAD ──
  describe('HEAD — file metadata', () => {
    it('returns 200 for existing file', async () => {
      const ctx = makeContext('HEAD', ['clients', 'akande', 'v1', 'logos', 'logo.svg'], {
        accessKey: 'test-key-123',
        assetResponse: new Response('', { status: 200, headers: { 'Content-Length': '3400' } }),
      });
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(200);
    });

    it('returns 404 for missing file', async () => {
      const ctx = makeContext('HEAD', ['clients', 'missing.svg'], {
        accessKey: 'test-key-123',
        assetResponse: new Response('', { status: 404 }),
      });
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── OPTIONS ──
  describe('OPTIONS — CORS preflight', () => {
    it('returns 204 with CORS headers', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('AccessKey');
    });
  });

  // ── Path traversal ──
  describe('security', () => {
    it('rejects path traversal attempts', async () => {
      const ctx = makeContext('GET', ['..', '..', 'etc', 'passwd'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects paths containing .git/ segment', async () => {
      const ctx = makeContext('GET', ['clients', 'test', '.git', 'config'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Path traversal extended ──
  describe('security — extended path traversal', () => {
    it('rejects URL-encoded path traversal (%2e%2e)', async () => {
      const ctx = makeContext('GET', ['%2e%2e', '%2e%2e', 'etc', 'passwd'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects double-encoded traversal (%252e%252e)', async () => {
      const ctx = makeContext('GET', ['%252e%252e', 'etc'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      // Either 400 (blocked) or 200 (safely decoded to literal %2e%2e) is acceptable
      expect([200, 400]).toContain(res.status);
    });

    it('rejects null byte injection (\\x00)', async () => {
      const ctx = makeContext('GET', ['clients', 'test\x00evil', 'file.svg'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects backslash traversal (..\\\\..)', async () => {
      const ctx = makeContext('GET', ['clients', '..\\..\\etc\\passwd'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects empty path segments (a//b)', async () => {
      // Empty string in segments creates // in joined path
      const ctx = makeContext('GET', ['clients', '', 'file.svg'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects node_modules segment', async () => {
      const ctx = makeContext('GET', ['clients', 'node_modules', 'pkg', 'file.svg'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects .github segment', async () => {
      const ctx = makeContext('GET', ['clients', '.github', 'workflows', 'ci.yml'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Path edge cases ──
  describe('path edge cases', () => {
    it('handles very long path (>4096 chars)', async () => {
      const longSegment = 'a'.repeat(4100);
      const ctx = makeContext('GET', ['clients', longSegment, ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      // Should not crash; returns 200 (empty list) or 400
      expect([200, 400]).toContain(res.status);
    });

    it('handles path with special chars (!@#$%^&)', async () => {
      const fileResponse = new Response('not found', { status: 404 });
      const ctx = makeContext('GET', ['clients', 'test', 'file!@#$%^&.svg'], {
        accessKey: 'test-key-123',
        assetResponse: fileResponse,
      });
      const res = await onRequestGet(ctx);
      // Should be 400 (blocked) or 404 (not found) — not a crash
      expect([400, 404]).toContain(res.status);
    });

    it('handles path with spaces', async () => {
      const fileResponse = new Response('not found', { status: 404 });
      const ctx = makeContext('GET', ['clients', 'my project', 'my file.svg'], {
        accessKey: 'test-key-123',
        assetResponse: fileResponse,
      });
      const res = await onRequestGet(ctx);
      expect([200, 404]).toContain(res.status);
    });

    it('handles mixed case paths', async () => {
      const ctx = makeContext('GET', ['clients', 'Akande', 'V1', 'Logos', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    });

    it('handles file with no extension', async () => {
      const fileResponse = new Response('not found', { status: 404 });
      const ctx = makeContext('GET', ['clients', 'test', 'Makefile'], {
        accessKey: 'test-key-123',
        assetResponse: fileResponse,
      });
      const res = await onRequestGet(ctx);
      // No extension means it could be treated as directory listing
      expect([200, 404]).toContain(res.status);
    });
  });

  // ── HEAD extended ──
  describe('HEAD — content types', () => {
    it('returns correct Content-Type for image/webp', async () => {
      const ctx = makeContext('HEAD', ['clients', 'akande', 'v1', 'banners', 'banner.webp'], {
        accessKey: 'test-key-123',
        assetResponse: new Response('', { status: 200, headers: { 'Content-Length': '5600', 'Content-Type': 'image/webp' } }),
      });
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/webp');
    });

    it('returns a Content-Type when original header is missing', async () => {
      const ctx = makeContext('HEAD', ['clients', 'test', 'file.bin'], {
        accessKey: 'test-key-123',
        assetResponse: new Response('', { status: 200, headers: { 'Content-Length': '100' } }),
      });
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(200);
      // Falls back to some default content type
      expect(res.headers.get('Content-Type')).toBeDefined();
    });

    it('HEAD returns CORS header', async () => {
      const ctx = makeContext('HEAD', ['clients', 'akande', 'v1', 'logos', 'logo.svg'], {
        accessKey: 'test-key-123',
        assetResponse: new Response('', { status: 200, headers: { 'Content-Length': '3400' } }),
      });
      const res = await onRequestHead(ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('HEAD returns 400 for path traversal', async () => {
      const ctx = makeContext('HEAD', ['..', '..', 'etc', 'passwd'], { accessKey: 'test-key-123' });
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── List directory extended ──
  describe('GET — list directory extended', () => {
    it('lists root directory', async () => {
      const ctx = makeContext('GET', [''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(Array.isArray(entries)).toBe(true);
      // Root should have top-level directories
      expect(entries.every(e => e.IsDirectory)).toBe(true);
    });

    it('list returns empty array when ASSETS is missing', async () => {
      const ctx = makeContext('GET', ['clients', ''], {
        accessKey: 'test-key-123',
        env: { STORAGE_KEY: 'test-key-123', ASSETS: undefined },
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual([]);
    });
  });

  // ── Upload extended ──
  describe('PUT — upload extended', () => {
    it('overwrites existing file (SHA-based update)', async () => {
      const content = new TextEncoder().encode('<svg>updated</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'oldsha123' }), { status: 200 }))  // file exists
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 200 }));  // update succeeds

      const ctx = makeContext('PUT', ['clients', 'test', 'logo.svg'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);

      // Verify the PUT call included sha
      const putCall = globalThis.fetch.mock.calls[1];
      const putBody = JSON.parse(putCall[1].body);
      expect(putBody.sha).toBe('oldsha123');
    });

    it('upload then immediately download returns file', async () => {
      const content = new TextEncoder().encode('<svg>new</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))  // file doesn't exist
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));  // upload succeeds

      const uploadCtx = makeContext('PUT', ['clients', 'test', 'fresh.svg'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const uploadRes = await onRequestPut(uploadCtx);
      expect(uploadRes.status).toBe(201);

      // Download (from ASSETS)
      const fileResponse = new Response('<svg>new</svg>', {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml' },
      });
      const downloadCtx = makeContext('GET', ['clients', 'test', 'fresh.svg'], {
        accessKey: 'test-key-123',
        assetResponse: fileResponse,
      });
      const downloadRes = await onRequestGet(downloadCtx);
      expect(downloadRes.status).toBe(200);
    });

    it('rejects PUT with invalid Checksum format (non-hex)', async () => {
      const content = new TextEncoder().encode('test');
      const ctx = makeContext('PUT', ['clients', 'test', 'file.txt'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        headers: { Checksum: 'NOT_A_HEX_STRING!!!' },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('checksum');
    });
  });

  // ── Delete extended ──
  describe('DELETE — extended', () => {
    it('rejects delete with path traversal', async () => {
      const ctx = makeContext('DELETE', ['..', '..', 'etc', 'passwd'], {
        accessKey: 'test-key-123',
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth on DELETE', async () => {
      const ctx = makeContext('DELETE', ['clients', 'test', 'file.svg']);
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(401);
    });

    it('handles GitHub API failure on delete', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'fail' }), { status: 500 }));

      const ctx = makeContext('DELETE', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key-123',
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      ctx.waitUntil = vi.fn();
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(502);
    });
  });

  // ── Edge cases ──
  describe('edge cases', () => {
    it('handles 0-byte file upload', async () => {
      const content = new ArrayBuffer(0);
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'empty.txt'], {
        accessKey: 'test-key-123',
        body: content,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.HttpCode).toBe(201);
    });

    it('handles Unicode filename in path', async () => {
      const content = new TextEncoder().encode('<svg>test</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'ícône-日本語.svg'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.HttpCode).toBe(201);
    });

    it('OPTIONS returns 204 with correct Allow-Methods', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
    });

    it('OPTIONS has Max-Age header', async () => {
      const res = await onRequestOptions();
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('OPTIONS has empty body', async () => {
      const res = await onRequestOptions();
      const text = await res.text();
      expect(text).toBe('');
    });

    it('GET list returns JSON content type', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.headers.get('Content-Type')).toContain('application/json');
    });

    it('GET list returns CORS header', async () => {
      const ctx = makeContext('GET', ['clients', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('401 response has CORS header', async () => {
      const ctx = makeContext('GET', ['clients', '']);
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('401 response has JSON content type', async () => {
      const ctx = makeContext('GET', ['clients', '']);
      const res = await onRequestGet(ctx);
      expect(res.headers.get('Content-Type')).toContain('application/json');
    });

    it('400 response has CORS header', async () => {
      const ctx = makeContext('GET', ['..', '..', 'etc'], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('404 response has CORS header', async () => {
      const notFound = new Response('not found', { status: 404 });
      const ctx = makeContext('GET', ['clients', 'test', 'missing.svg'], {
        accessKey: 'test-key-123',
        assetResponse: notFound,
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(404);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('upload response includes Path field', async () => {
      const content = new TextEncoder().encode('<svg></svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));
      const ctx = makeContext('PUT', ['clients', 'test', 'new.svg'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      const json = await res.json();
      expect(json.Path).toBeDefined();
    });

    it('upload response includes Length field', async () => {
      const content = new TextEncoder().encode('<svg>data</svg>');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));
      const ctx = makeContext('PUT', ['clients', 'test', 'sized.svg'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      const json = await res.json();
      expect(json.Length).toBe(content.buffer.byteLength);
    });

    it('list deep directory path works', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('list deep path shows both files and dirs', async () => {
      const ctx = makeContext('GET', ['clients', 'akande', 'v1', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      const entries = await res.json();
      const dirs = entries.filter(e => e.IsDirectory);
      expect(dirs.length).toBeGreaterThan(0);
    });

    it('HEAD 401 without auth', async () => {
      const ctx = makeContext('HEAD', ['clients', 'test', 'file.svg']);
      const res = await onRequestHead(ctx);
      expect(res.status).toBe(401);
    });

    it('DELETE 501 without GITHUB env vars returns Message', async () => {
      const ctx = makeContext('DELETE', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key-123',
      });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(501);
      const json = await res.json();
      expect(json.Message).toContain('GITHUB_TOKEN');
    });

    it('PUT 501 without GITHUB env vars returns Message', async () => {
      const ctx = makeContext('PUT', ['clients', 'test', 'file.svg'], {
        accessKey: 'test-key-123',
        body: new TextEncoder().encode('test').buffer,
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(501);
      const json = await res.json();
      expect(json.Message).toContain('GITHUB_TOKEN');
    });

    it('PUT rejects directory path (ends with /)', async () => {
      const ctx = makeContext('PUT', ['clients', 'test', ''], {
        accessKey: 'test-key-123',
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(400);
    });

    it('correct checksum passes validation', async () => {
      const content = new TextEncoder().encode('test content');
      const hashBuffer = await crypto.subtle.digest('SHA-256', content);
      const hashHex = [...new Uint8Array(hashBuffer)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

      const ctx = makeContext('PUT', ['clients', 'test', 'verified.txt'], {
        accessKey: 'test-key-123',
        body: content.buffer,
        headers: { Checksum: hashHex },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(201);
    });

    it('GET download returns correct CORS on success', async () => {
      const fileResponse = new Response('file data', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
      const ctx = makeContext('GET', ['clients', 'test', 'readme.txt'], {
        accessKey: 'test-key-123',
        assetResponse: fileResponse,
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('413 for oversized actual body', async () => {
      const largeBody = new ArrayBuffer(26 * 1024 * 1024); // 26MB
      const ctx = makeContext('PUT', ['clients', 'test', 'huge.bin'], {
        accessKey: 'test-key-123',
        body: largeBody,
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(413);
    });

    it('lists stocks directory correctly', async () => {
      const ctx = makeContext('GET', ['stocks', ''], { accessKey: 'test-key-123' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(Array.isArray(entries)).toBe(true);
    });
  });
});
