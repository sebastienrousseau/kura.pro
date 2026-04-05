import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestPost, onRequestOptions } = await import('../../../functions/api/storage/batch.js');

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Helper: build a context for batch endpoint.
 */
function makeContext(options = {}) {
  const {
    accessKey,
    cookie,
    body,
    env = {},
  } = options;

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (accessKey) headers.set('AccessKey', accessKey);
  if (cookie) headers.set('Cookie', cookie);

  return {
    request: {
      url: 'https://cloudcdn.pro/api/storage/batch',
      method: 'POST',
      headers,
      json: body !== undefined
        ? (typeof body === 'string' ? vi.fn().mockRejectedValue(new Error('Invalid JSON')) : vi.fn().mockResolvedValue(body))
        : vi.fn().mockRejectedValue(new Error('Invalid JSON')),
    },
    env: {
      STORAGE_KEY: env.STORAGE_KEY ?? 'test-key-123',
      DASHBOARD_SECRET: env.DASHBOARD_SECRET,
      DASHBOARD_PASSWORD: env.DASHBOARD_PASSWORD,
      GITHUB_TOKEN: env.GITHUB_TOKEN,
      GITHUB_REPO: env.GITHUB_REPO,
      ...env,
    },
    waitUntil: vi.fn(),
  };
}

function validFile(path = 'clients/akande/v1/logos/new.svg', content = 'PHN2Zz48L3N2Zz4=') {
  return { path, content, encoding: 'base64' };
}

describe('Batch Upload API', () => {
  // ── Auth ──
  describe('authentication', () => {
    it('returns 401 without AccessKey', async () => {
      const ctx = makeContext({
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.HttpCode).toBe(401);
    });

    it('returns 401 with wrong AccessKey', async () => {
      const ctx = makeContext({
        accessKey: 'wrong-key',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('allows access in dev mode (no keys configured)', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'abc' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 'def' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'blobsha' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'treesha' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'commitsha' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const ctx = makeContext({
        body: { files: [validFile()] },
        env: { STORAGE_KEY: undefined, DASHBOARD_SECRET: undefined, DASHBOARD_PASSWORD: undefined, GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
    });
  });

  // ── Missing GITHUB_TOKEN ──
  describe('server configuration', () => {
    it('returns 501 without GITHUB_TOKEN', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(501);
      const json = await res.json();
      expect(json.Message).toContain('GITHUB_TOKEN');
    });

    it('returns 501 without GITHUB_REPO', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(501);
      const json = await res.json();
      expect(json.Message).toContain('GITHUB_REPO');
    });
  });

  // ── Validation ──
  describe('input validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: 'not-json',
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('invalid json');
    });

    it('returns 400 for empty files array', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('files');
      expect(json.Message.toLowerCase()).toContain('array');
    });

    it('returns 400 when files is not an array', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: 'not-an-array' },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 when files exceed max batch size (50)', async () => {
      const files = Array.from({ length: 51 }, (_, i) => validFile(`clients/test/file${i}.svg`));
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('50');
    });

    it('returns 413 when a single file exceeds size limit', async () => {
      // base64 content that decodes to >25MB: length * 3/4 > 25*1024*1024
      const hugContent = 'A'.repeat(35_000_000); // ~26.25 MB decoded
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [{ path: 'clients/test/huge.bin', content: hugContent, encoding: 'base64' }] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.HttpCode).toBe(413);
      expect(json.Message).toContain('exceeds');
    });

    it('returns 400 for path traversal in file paths', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [{ path: '../../../etc/passwd', content: 'dGVzdA==', encoding: 'base64' }] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('Invalid path');
    });

    it('returns 400 when file missing path field', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [{ content: 'dGVzdA==' }] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('path');
      expect(json.Message.toLowerCase()).toContain('content');
    });

    it('returns 400 when file missing content field', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [{ path: 'clients/test/file.svg' }] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('path');
      expect(json.Message.toLowerCase()).toContain('content');
    });
  });

  // ── Successful upload ──
  describe('successful batch upload', () => {
    it('creates single commit via Git Database API and returns 201', async () => {
      const commitSha = 'abc123def456';

      globalThis.fetch = vi.fn()
        // 1. Get branch ref
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'headsha' } }), { status: 200 }))
        // 2. Get commit (base tree)
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 'basetreesha' } }), { status: 200 }))
        // 3. Create blob for file 1
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'blob1sha' }), { status: 201 }))
        // 4. Create blob for file 2
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'blob2sha' }), { status: 201 }))
        // 5. Create tree
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'newtreesha' }), { status: 201 }))
        // 6. Create commit
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: commitSha }), { status: 201 }))
        // 7. Update branch ref
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const files = [
        validFile('clients/akande/v1/logos/a.svg'),
        validFile('clients/akande/v1/logos/b.svg'),
      ];

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.HttpCode).toBe(201);
      expect(json.Commit).toBe(commitSha);
      expect(json.EdgeStatus).toBe('pending');
      expect(json.Files).toHaveLength(2);
      expect(json.DateCreated).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Verify Git Database API was called correctly
      expect(globalThis.fetch).toHaveBeenCalledTimes(7);
      // Branch ref
      expect(globalThis.fetch.mock.calls[0][0]).toContain('/git/ref/heads/main');
      // Blobs
      expect(globalThis.fetch.mock.calls[2][0]).toContain('/git/blobs');
      expect(globalThis.fetch.mock.calls[3][0]).toContain('/git/blobs');
      // Tree
      expect(globalThis.fetch.mock.calls[4][0]).toContain('/git/trees');
      // Commit
      expect(globalThis.fetch.mock.calls[5][0]).toContain('/git/commits');
    });

    it('generates single-file commit message for one file', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Message).toContain('1 file(s) uploaded');
    });

    it('triggers cache purge when Cloudflare env vars are set', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))  // ref
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))    // commit
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))               // blob
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))              // tree
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))               // commit
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'c' } }), { status: 200 }))  // update ref
        .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));             // purge

      const waitUntilFn = vi.fn();
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: {
          STORAGE_KEY: 'test-key-123',
          GITHUB_TOKEN: 'ghp_test',
          GITHUB_REPO: 'user/repo',
          CLOUDFLARE_ZONE_ID: 'zone123',
          CLOUDFLARE_API_TOKEN: 'cftoken',
        },
      });
      // Override waitUntil on the context directly (makeContext sets it on env)
      ctx.waitUntil = waitUntilFn;
      const res = await onRequestPost(ctx);
      // Verify upload succeeded first
      expect(res.status).toBe(201);
      expect(waitUntilFn).toHaveBeenCalled();
    });
  });

  // ── Error handling ──
  describe('error handling', () => {
    it('returns 500 when GitHub ref fetch fails', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 500 }));

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('batch');
      expect(json.Message.toLowerCase()).toContain('failed');
    });

    it('returns 500 when blob creation fails', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response('', { status: 500 })); // blob fails

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(500);
    });
  });

  // ── Extended tests ──
  describe('batch edge cases', () => {
    it('batch with exactly 1 file succeeds', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Files).toHaveLength(1);
    });

    it('batch with exactly 50 files succeeds', async () => {
      const files = Array.from({ length: 50 }, (_, i) => validFile(`clients/test/file${i}.svg`));
      // Need: ref, commit, 50 blobs, tree, commit, update ref
      const mocks = [
        new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }),
        new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }),
        ...Array.from({ length: 50 }, () => new Response(JSON.stringify({ sha: 'b' }), { status: 201 })),
        new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }),
        new Response(JSON.stringify({ sha: 'c' }), { status: 201 }),
        new Response('', { status: 200 }),
      ];
      globalThis.fetch = vi.fn();
      for (let i = 0; i < mocks.length; i++) {
        globalThis.fetch.mockResolvedValueOnce(mocks[i]);
      }

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Files).toHaveLength(50);
    });

    it('batch with 51 files returns 400', async () => {
      const files = Array.from({ length: 51 }, (_, i) => validFile(`clients/test/file${i}.svg`));
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('file with utf8 encoding', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [{ path: 'clients/test/data.json', content: '{"hello":"world"}', encoding: 'utf-8' }] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
    });

    it('file path starting with stocks/', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile('stocks/images/photo.webp')] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
    });

    it('all files in same directory', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b1' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b2' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b3' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const files = [
        validFile('clients/test/dir/a.svg'),
        validFile('clients/test/dir/b.svg'),
        validFile('clients/test/dir/c.svg'),
      ];
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
    });

    it('files in different directories', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b1' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b2' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const files = [
        validFile('clients/projA/v1/logos/logo.svg'),
        validFile('clients/projB/v1/icons/icon.svg'),
      ];
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
    });

    it('returns 500 when GitHub tree creation fails', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 500 })); // tree creation fails

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(500);
    });

    it('returns 500 when GitHub commit creation fails', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 500 })); // commit creation fails

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(500);
    });

    it('returns 500 when GitHub ref update fails', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 500 })); // ref update fails

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(500);
    });

    it('commit message for multiple files contains count', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b1' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b2' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b3' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const files = [
        validFile('clients/a/a.svg'),
        validFile('clients/b/b.svg'),
        validFile('clients/c/c.svg'),
      ];
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Message).toContain('3 file(s)');
    });
  });

  // ── OPTIONS ──
  describe('OPTIONS — CORS preflight', () => {
    it('returns 204 with CORS headers', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('AccessKey');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('OPTIONS has empty body', async () => {
      const res = await onRequestOptions();
      const text = await res.text();
      expect(text).toBe('');
    });
  });

  // ── Response format ──
  describe('response format', () => {
    it('201 response includes HttpCode', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.HttpCode).toBe(201);
    });

    it('201 response has CORS header', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('401 response includes HttpCode', async () => {
      const ctx = makeContext({
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.HttpCode).toBe(401);
    });

    it('400 response includes HttpCode', async () => {
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.HttpCode).toBe(400);
    });

    it('500 response is valid JSON', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 500 }));
      const ctx = makeContext({
        accessKey: 'test-key-123',
        body: { files: [validFile()] },
        env: { STORAGE_KEY: 'test-key-123', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(() => JSON.parse(text)).not.toThrow();
    });
  });
});
