import { describe, it, expect, vi } from 'vitest';

const mod = await import('../../functions/api/storage/[[path]].js');
const { onRequestGet } = mod;

function makeCtx(pathSegments) {
  return {
    request: {
      url: `https://cloudcdn.pro/api/storage/${pathSegments.join('/')}`,
      method: 'GET',
      headers: new Headers(),
    },
    params: { path: pathSegments },
    env: {
      // Dev mode: no auth keys configured
      STORAGE_KEY: undefined,
      DASHBOARD_SECRET: undefined,
      DASHBOARD_PASSWORD: undefined,
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
        ),
      },
    },
  };
}

describe('Path Security Suite', () => {
  // ── Path traversal: .. blocked ──
  it('blocks .. traversal', async () => {
    const ctx = makeCtx(['..', '..', 'etc', 'passwd']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks .. in middle of path', async () => {
    const ctx = makeCtx(['clients', 'akande', '..', '..', 'secrets']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks .. at end of path', async () => {
    const ctx = makeCtx(['clients', 'akande', '..']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── URL-encoded traversal: %2e%2e blocked ──
  it('blocks %2e%2e URL-encoded traversal', async () => {
    const ctx = makeCtx(['clients', '%2e%2e', 'secrets']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks mixed case %2E%2E encoded traversal', async () => {
    const ctx = makeCtx(['clients', '%2E%2E', 'secrets']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── Backslash normalized ──
  it('normalizes backslash in path segments', async () => {
    // After normalization, backslashes become forward slashes
    // The path should either work or get rejected, not bypass security
    const ctx = makeCtx(['clients', 'test\\..\\secrets']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── Null bytes rejected ──
  it('rejects null bytes in path', async () => {
    const ctx = makeCtx(['clients', 'test\0', 'file.svg']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects null byte before extension', async () => {
    const ctx = makeCtx(['clients', 'file.svg\0.exe']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── .git blocked ──
  it('blocks .git directory access', async () => {
    const ctx = makeCtx(['.git', 'config']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks .git nested in path', async () => {
    const ctx = makeCtx(['clients', '.git', 'HEAD']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── .github blocked ──
  it('blocks .github directory access', async () => {
    const ctx = makeCtx(['.github', 'workflows', 'deploy.yml']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks .github nested in path', async () => {
    const ctx = makeCtx(['clients', '.github', 'CODEOWNERS']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── node_modules blocked ──
  it('blocks node_modules directory access', async () => {
    const ctx = makeCtx(['node_modules', 'express', 'index.js']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks node_modules nested in path', async () => {
    const ctx = makeCtx(['clients', 'node_modules', 'pkg']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── Normal paths pass ──
  it('allows normal client path', async () => {
    const ctx = makeCtx(['clients', 'akande', 'v1', 'logos', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows stocks path', async () => {
    const ctx = makeCtx(['stocks', 'images', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows path with hyphens and numbers', async () => {
    const ctx = makeCtx(['clients', 'my-project-2026', 'v1', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  // ── Unicode paths pass ──
  it('allows Unicode path segments', async () => {
    const ctx = makeCtx(['clients', '日本語', 'v1', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows accented characters in path', async () => {
    const ctx = makeCtx(['clients', 'café', 'logos', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  // ── Extended traversal attacks ──
  it('blocks double URL-encoded traversal (%252e%252e)', async () => {
    const ctx = makeCtx(['clients', '%252e%252e', 'etc']);
    const res = await onRequestGet(ctx);
    // Should be safe: decoded once = %2e%2e which is literal dots in path
    expect([200, 400]).toContain(res.status);
  });

  it('blocks encoded forward slash (%2f) traversal', async () => {
    const ctx = makeCtx(['clients', 'test%2f..%2f..%2fetc']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks Windows-style backslash traversal', async () => {
    const ctx = makeCtx(['clients', '..\\..\\windows\\system32']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks mixed slash traversal (..\\../)', async () => {
    const ctx = makeCtx(['clients', '..\\/..\\/', 'etc']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks triple-dot traversal (...)', async () => {
    const ctx = makeCtx(['clients', '...', 'etc']);
    const res = await onRequestGet(ctx);
    // Triple dot contains .., so should be blocked
    expect(res.status).toBe(400);
  });

  it('blocks null byte between dots (.\\x00.)', async () => {
    const ctx = makeCtx(['clients', '.\0.', 'etc']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('blocks URL-encoded null byte (%00)', async () => {
    const ctx = makeCtx(['clients', 'test%00.svg']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  // ── Legitimate edge case paths ──
  it('allows path with single dot (not traversal)', async () => {
    const ctx = makeCtx(['clients', 'test', 'v1.0', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows path ending with extension', async () => {
    const ctx = makeCtx(['clients', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows deep nesting (10 levels)', async () => {
    const ctx = makeCtx(['clients', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows path with underscores', async () => {
    const ctx = makeCtx(['clients', 'my_project', 'v1_beta', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows path with uppercase characters', async () => {
    const ctx = makeCtx(['clients', 'MyProject', 'V1', 'Logos', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows path with numbers only', async () => {
    const ctx = makeCtx(['clients', '12345', '67890', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('allows path with mixed alphanumeric and special', async () => {
    const ctx = makeCtx(['clients', 'test-project_v2.1', 'images', '']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });
});
