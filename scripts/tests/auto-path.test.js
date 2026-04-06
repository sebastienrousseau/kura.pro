import { describe, it, expect, vi } from 'vitest';

vi.mock('../../functions/api/auto.js', () => ({
  onRequestGet: vi.fn().mockImplementation(async (ctx) => {
    const url = new URL(ctx.request.url);
    const path = url.searchParams.get('path');
    if (!path) return Response.json({ error: 'Missing required parameter: path' }, { status: 400 });
    return Response.json({ path, negotiated: true });
  }),
}));

const { onRequestGet } = await import('../../functions/api/auto/[[path]].js');

function makeCtx(pathSegments, options = {}) {
  return {
    request: {
      url: `https://cloudcdn.pro/api/auto/${pathSegments.join('/')}`,
      headers: new Headers({ Accept: options.accept || 'image/webp,*/*' }),
    },
    params: { path: pathSegments },
    env: {
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response('', { status: 404 })),
      },
    },
  };
}

describe('Auto Path Router — [[path]].js', () => {
  it('extracts path from array params and delegates to handler', async () => {
    const ctx = makeCtx(['bankingonai', 'images', 'logos', 'logo']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.path).toBe('/bankingonai/images/logos/logo');
    expect(json.negotiated).toBe(true);
  });

  it('handles single segment path', async () => {
    const ctx = makeCtx(['logo']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/logo');
  });

  it('handles deeply nested paths', async () => {
    const ctx = makeCtx(['a', 'b', 'c', 'd', 'e', 'f']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/a/b/c/d/e/f');
  });

  it('handles string param instead of array', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/auto/simple',
        headers: new Headers({ Accept: '*/*' }),
      },
      params: { path: 'simple' },
      env: {
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('', { status: 404 })) },
      },
    };
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/simple');
  });

  it('rewrites URL to include path as query param', async () => {
    const ctx = makeCtx(['project', 'icons', 'star']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/project/icons/star');
  });

  it('preserves existing query params on rewrite', async () => {
    const ctx = makeCtx(['project', 'logo']);
    ctx.request.url = 'https://cloudcdn.pro/api/auto/project/logo?width=100';
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/project/logo');
  });

  it('handles path with extension', async () => {
    const ctx = makeCtx(['project', 'logos', 'logo.svg']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/project/logos/logo.svg');
  });

  it('handles empty path segments gracefully', async () => {
    const ctx = makeCtx(['']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/');
  });

  // --- Extended auto-path tests ---

  it('handles path with hyphens', async () => {
    const ctx = makeCtx(['my-project', 'my-image']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/my-project/my-image');
  });

  it('handles path with underscores', async () => {
    const ctx = makeCtx(['my_project', 'my_image']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/my_project/my_image');
  });

  it('handles path with numbers', async () => {
    const ctx = makeCtx(['project123', 'v2', 'img456']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/project123/v2/img456');
  });

  it('handles two segment path', async () => {
    const ctx = makeCtx(['project', 'logo']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/project/logo');
  });

  it('handles three segment path', async () => {
    const ctx = makeCtx(['project', 'v1', 'logo']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/project/v1/logo');
  });

  it('response status is 200 for valid path', async () => {
    const ctx = makeCtx(['project', 'logo']);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('returns negotiated=true in response', async () => {
    const ctx = makeCtx(['project', 'logo']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.negotiated).toBe(true);
  });

  it('handles path with dots in segments', async () => {
    const ctx = makeCtx(['project', 'v1.0', 'logo.min']);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/project/v1.0/logo.min');
  });

  it('handles very long path', async () => {
    const segments = Array.from({ length: 20 }, (_, i) => `seg${i}`);
    const ctx = makeCtx(segments);
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.path).toBe('/' + segments.join('/'));
  });
});
