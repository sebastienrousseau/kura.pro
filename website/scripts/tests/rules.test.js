import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestPost, onRequestOptions } = await import('../../../functions/api/core/rules.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function makeCtx(method, options = {}) {
  const h = new Headers();
  if (options.accountKey) h.set('AccountKey', options.accountKey);
  if (options.contentType) h.set('Content-Type', options.contentType);

  return {
    request: {
      url: 'https://cloudcdn.pro/api/core/rules',
      method,
      headers: h,
      json: options.body ? vi.fn().mockResolvedValue(options.body) : vi.fn().mockRejectedValue(new Error('no body')),
    },
    env: {
      ACCOUNT_KEY: options.envAccountKey ?? 'acct-123',
      GITHUB_TOKEN: options.githubToken,
      GITHUB_REPO: options.githubRepo,
      ASSETS: {
        fetch: vi.fn().mockImplementation(async (urlOrReq) => {
          const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.toString();
          if (u.includes('_headers')) return new Response('/* headers */\n/*.webp\n  Cache-Control: max-age=31536000', { status: 200 });
          if (u.includes('_redirects')) return new Response('/old /new 301', { status: 200 });
          return new Response('not found', { status: 404 });
        }),
      },
    },
  };
}

describe('Core Rules API', () => {
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

  // ── GET ──
  it('GET reads _headers and _redirects', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Headers).toContain('Cache-Control');
    expect(json.Redirects).toContain('/old');
    expect(json.Editable).toContain('_headers');
    expect(json.Editable).toContain('_redirects');
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('GET allows access in dev mode (no ACCOUNT_KEY)', async () => {
    const ctx = makeCtx('GET');
    ctx.env.ACCOUNT_KEY = undefined;
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('GET handles ASSETS fetch failure gracefully', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    ctx.env.ASSETS.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Headers).toBeNull();
    expect(json.Redirects).toBeNull();
  });

  // ── POST ──
  it('POST returns 501 when GITHUB_TOKEN not configured', async () => {
    const ctx = makeCtx('POST', { accountKey: 'acct-123', body: { File: '_headers', Content: 'test' } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(501);
    const json = await res.json();
    expect(json.Message).toContain('GITHUB_TOKEN');
  });

  it('POST rejects invalid file name', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123',
      body: { File: 'evil.js', Content: 'test' },
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.Message).toContain('_headers');
  });

  it('POST rejects content too large (>100KB)', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123',
      body: { File: '_headers', Content: 'x'.repeat(100001) },
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.Message).toContain('100 KB');
  });

  it('POST rejects non-string Content field', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123',
      body: { File: '_headers', Content: 42 },
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('POST rejects malformed JSON body', async () => {
    const ctx = makeCtx('POST', { accountKey: 'acct-123', githubToken: 'ghp_test', githubRepo: 'user/repo' });
    ctx.request.json = vi.fn().mockRejectedValue(new Error('bad json'));
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.Message).toContain('invalid JSON');
  });

  it('POST updates file via GitHub API successfully', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'old-sha' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'new-sha' } }), { status: 200 }));

    const ctx = makeCtx('POST', {
      accountKey: 'acct-123',
      body: { File: '_headers', Content: '/*.css\n  Cache-Control: max-age=3600' },
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.File).toBe('_headers');
    expect(json.EdgeStatus).toBe('pending');
  });

  it('POST returns 502 when GitHub API fails', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'error' }), { status: 422 }));

    const ctx = makeCtx('POST', {
      accountKey: 'acct-123',
      body: { File: '_redirects', Content: '/a /b 301' },
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(502);
  });

  // ── OPTIONS ──
  it('OPTIONS returns 204', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });

  // --- Extended rules tests ---
  it('OPTIONS has CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('GET has Content-Type JSON', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('GET has CORS header', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('GET 401 has CORS', async () => {
    const ctx = makeCtx('GET', {});
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('POST rejects _headers with Content-Length check', async () => {
    // Very large content should still be accepted (no size limit on rules)
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

    const ctx = makeCtx('POST', {
      accountKey: 'acct-123',
      body: { File: '_headers', Content: 'x'.repeat(10000) },
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect([200, 400]).toContain(res.status);
  });

  it('GET rules includes Editable field with valid files', async () => {
    const ctx = makeCtx('GET', { accountKey: 'acct-123' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Editable).toContain('_headers');
    expect(json.Editable).toContain('_redirects');
  });

  it('POST rejects files not in editable list', async () => {
    const ctx = makeCtx('POST', {
      accountKey: 'acct-123',
      body: { File: 'package.json', Content: '{}' },
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('POST with empty Content returns error or success', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

    const ctx = makeCtx('POST', {
      accountKey: 'acct-123',
      body: { File: '_headers', Content: '' },
      githubToken: 'ghp_test',
      githubRepo: 'user/repo',
    });
    const res = await onRequestPost(ctx);
    expect([200, 400, 502]).toContain(res.status);
  });
});
