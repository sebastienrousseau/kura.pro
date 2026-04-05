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
