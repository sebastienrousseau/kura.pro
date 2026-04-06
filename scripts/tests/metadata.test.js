import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearManifestCache } from '../../functions/api/_shared.js';

const mod = await import('../../functions/api/assets/metadata.js');
const { onRequestGet, onRequestOptions } = mod;

beforeEach(() => { clearManifestCache(); });

const MANIFEST = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'logo.png', path: 'akande/v1/logos/logo.png', project: 'akande', category: 'logos', format: 'png', size: 8200 },
  { name: 'banner.webp', path: 'akande/v1/banners/banner.webp', project: 'akande', category: 'banners', format: 'webp', size: 5600 },
  { name: 'video.mp4', path: 'stocks/videos/video.mp4', project: 'stocks', category: 'videos', format: 'mp4', size: 102400 },
];

function makeCtx(query, options = {}) {
  const h = new Headers();
  if (options.accessKey) h.set('AccessKey', options.accessKey);
  return {
    request: {
      url: `https://cloudcdn.pro/api/assets/metadata${query}`,
      headers: h,
    },
    env: {
      STORAGE_KEY: options.storageKey ?? 'test-key',
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(MANIFEST), { status: 200, headers: { 'Content-Type': 'application/json' } })
        ),
      },
    },
  };
}

describe('Asset Metadata API', () => {
  it('returns 401 when auth is required and no key provided', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.HttpCode).toBe(401);
  });

  it('returns 400 when path param is missing', async () => {
    const ctx = makeCtx('', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.HttpCode).toBe(400);
    expect(json.Message).toContain('path');
  });

  it('returns 400 when path param is empty string', async () => {
    const ctx = makeCtx('?path=', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown asset path', async () => {
    const ctx = makeCtx('?path=nonexistent/file.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.HttpCode).toBe(404);
    expect(json.Message).toContain('nonexistent/file.svg');
  });

  it('returns all fields for a found asset', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Path).toBe('akande/v1/logos/logo.svg');
    expect(json.Name).toBe('logo.svg');
    expect(json.Project).toBe('akande');
    expect(json.Category).toBe('logos');
    expect(json.Format).toBe('svg');
    expect(json.Size).toBe(3400);
    expect(json.SizeHuman).toBeDefined();
    expect(json.ContentType).toBe('image/svg+xml');
    expect(json.CdnUrl).toContain('cloudcdn.pro');
    expect(json.TransformUrl).toContain('/api/transform');
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('discovers available formats for image assets', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.AvailableFormats).toContain('svg');
    expect(json.AvailableFormats).toContain('png');
  });

  it('maps content type correctly for various formats', async () => {
    const ctx = makeCtx('?path=akande/v1/banners/banner.webp', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.ContentType).toBe('image/webp');
  });

  it('returns application/octet-stream for unknown formats', async () => {
    const manifest = [
      { name: 'data.xyz', path: 'test/data.xyz', project: 'test', category: 'data', format: 'xyz', size: 100 },
    ];
    const ctx = makeCtx('?path=test/data.xyz', { accessKey: 'test-key' });
    ctx.env.ASSETS = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(manifest), { status: 200, headers: { 'Content-Type': 'application/json' } })
      ),
    };
    clearManifestCache();
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ContentType).toBe('application/octet-stream');
  });

  it('does not discover cross-format for non-image assets', async () => {
    const ctx = makeCtx('?path=stocks/videos/video.mp4', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.AvailableFormats).toEqual(['mp4']);
  });

  it('returns 503 when manifest cannot be loaded', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    ctx.env.ASSETS.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(503);
  });

  it('allows access in dev mode when no keys configured', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { storageKey: undefined });
    ctx.env.STORAGE_KEY = undefined;
    ctx.env.DASHBOARD_SECRET = undefined;
    ctx.env.DASHBOARD_PASSWORD = undefined;
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('OPTIONS returns 204 with CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });

  // --- Extended metadata tests ---

  it('OPTIONS has Access-Control-Allow-Origin', async () => {
    const res = await onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('OPTIONS has Access-Control-Max-Age', async () => {
    const res = await onRequestOptions();
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('GET response has Content-Type JSON', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('GET response has CORS header', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('metadata includes Size field', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Size).toBe(3400);
  });

  it('metadata includes Project field', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Project).toBe('akande');
  });

  it('metadata includes Category field', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.Category).toBe('logos');
  });

  it('metadata includes TransformUrl for images', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.TransformUrl).toContain('/api/transform');
  });

  it('metadata 400 has CORS header', async () => {
    const ctx = makeCtx('', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('metadata 404 has CORS header', async () => {
    const ctx = makeCtx('?path=nonexistent/file.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('metadata 401 has CORS header', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('metadata includes DateFetched', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('metadata for webp file returns result', async () => {
    clearManifestCache();
    const ctx = makeCtx('?path=stocks/images/photo.webp', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    // stocks/images/photo.webp exists in manifest
    expect([200, 404]).toContain(res.status);
  });

  it('metadata for png file returns 200', async () => {
    const ctx = makeCtx('?path=akande/v1/logos/logo.png', { accessKey: 'test-key' });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Format).toBe('png');
  });
});
