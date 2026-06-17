import { describe, it, expect, vi, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

function mockFetch(data = {}, status = 200, contentType = 'application/json') {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(
      contentType === 'application/json' ? JSON.stringify(data) : 'binary',
      { status, headers: { 'content-type': contentType, 'content-length': '1234' } }
    )
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('delivery tools', () => {
  async function getTools() {
    process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
    process.env.CLOUDCDN_ACCOUNT_KEY = 'ak_test';
    process.env.CLOUDCDN_PURGE_KEY = 'pk_test';
    const { registerDeliveryTools } = await import('../../lib/tools/delivery.js');
    const tools = {};
    const server = {
      tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
    };
    registerDeliveryTools(server);
    return tools;
  }

  it('transform_image builds correct URL with params', async () => {
    mockFetch(null, 200, 'image/webp');
    const tools = await getTools();
    const result = await tools.transform_image({ url: '/akande/v1/logos/logo.svg', w: 128, format: 'webp' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.transform_url).toContain('/api/transform');
    expect(parsed.transform_url).toContain('w=128');
    expect(parsed.transform_url).toContain('format=webp');
    expect(parsed.status).toBe(200);
  });

  it('transform_image skips explicitly undefined params and falls back to null content_type', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    );
    const tools = await getTools();
    const result = await tools.transform_image({
      url: '/akande/v1/logos/logo.svg',
      w: undefined,
      h: undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.transform_url).toContain('url=');
    expect(parsed.transform_url).not.toContain('w=');
    expect(parsed.content_type).toBeNull();
  });

  it('cache_purge with nothing set sends an empty body', async () => {
    mockFetch({ success: true });
    const tools = await getTools();
    await tools.cache_purge({});
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({});
  });

  it('cache_purge sends urls to POST /api/purge', async () => {
    mockFetch({ success: true });
    const tools = await getTools();
    await tools.cache_purge({ urls: ['https://cloudcdn.pro/akande/v1/logos/logo.svg'] });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/purge');
    expect(opts.headers['x-api-key']).toBe('pk_test');
    expect(JSON.parse(opts.body).urls).toHaveLength(1);
  });

  it('cache_purge sends purge_everything', async () => {
    mockFetch({ success: true });
    const tools = await getTools();
    await tools.cache_purge({ purge_everything: true });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.purge_everything).toBe(true);
  });

  it('cache_purge sends tags array', async () => {
    mockFetch({ success: true });
    const tools = await getTools();
    await tools.cache_purge({ tags: ['hero', 'home'] });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.tags).toEqual(['hero', 'home']);
    expect(body.urls).toBeUndefined();
  });

  it('signed_url_generate POSTs path + expires (default TTL)', async () => {
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    mockFetch({ url: 'https://test.cdn/x?sig=abc', expiresAt: fixedNow / 1000 + 3600 });
    const tools = await getTools();
    await tools.signed_url_generate({ path: '/clients/acme/private/report.pdf' });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/signed');
    expect(opts.headers.AccountKey).toBe('ak_test');
    const body = JSON.parse(opts.body);
    expect(body.path).toBe('/clients/acme/private/report.pdf');
    expect(body.expires).toBe(fixedNow / 1000 + 3600);
    vi.restoreAllMocks();
  });

  it('signed_url_generate honours custom expires_in', async () => {
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    mockFetch({ url: 'x', expiresAt: 1 });
    const tools = await getTools();
    await tools.signed_url_generate({ path: '/p', expires_in: 600 });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.expires).toBe(fixedNow / 1000 + 600);
    vi.restoreAllMocks();
  });

  it('stream_playlist GETs /api/stream with id param', async () => {
    mockFetch({ playlist_url: 'https://test.cdn/stream.m3u8' });
    const tools = await getTools();
    await tools.stream_playlist({ asset_id: '/stocks/promo/launch.mp4' });
    const u = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(u.pathname).toBe('/api/stream');
    expect(u.searchParams.get('id')).toBe('/stocks/promo/launch.mp4');
  });

  it('pipeline_ingest sends POST /api/pipeline with mode and svg', async () => {
    mockFetch({ HttpCode: 201, Files: ['clients/test/v1/logos/test.svg'] });
    const tools = await getTools();
    await tools.pipeline_ingest({
      mode: 'client',
      name: 'test',
      svg: btoa('<svg></svg>'),
      generateFavicon: true,
      generateIcons: true,
      generateBanners: true,
    });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/pipeline');
    expect(opts.headers.AccountKey).toBe('ak_test');
    const body = JSON.parse(opts.body);
    expect(body.mode).toBe('client');
    expect(body.name).toBe('test');
  });
});
