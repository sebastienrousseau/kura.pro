import { describe, it, expect, vi, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

function mockFetch(data = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

async function getResources() {
  process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
  process.env.CLOUDCDN_ACCESS_KEY = 'sk_test';
  process.env.CLOUDCDN_ACCOUNT_KEY = 'ak_test';
  const { registerResources } = await import('../lib/resources/index.js');
  const resources = {};
  const server = {
    resource: (name, uri, meta, handler) => {
      resources[name] = { uri, meta, handler };
    },
  };
  registerResources(server);
  return resources;
}

describe('MCP resources', () => {
  it('registers six resources with the cloudcdn:// scheme', async () => {
    const resources = await getResources();
    expect(Object.keys(resources).sort()).toEqual([
      'health',
      'insights-today',
      'manifest',
      'openapi',
      'rules',
      'zones',
    ]);
    for (const r of Object.values(resources)) {
      expect(r.uri.startsWith('cloudcdn://')).toBe(true);
      expect(r.meta.mimeType).toBe('application/json');
      expect(typeof r.meta.description).toBe('string');
    }
  });

  it('manifest resource pulls /manifest.json and emits its URI', async () => {
    mockFetch({ assets: ['a', 'b'] });
    const { manifest } = await getResources();
    const out = await manifest.handler();
    expect(out.contents[0].uri).toBe('cloudcdn://manifest');
    expect(out.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(out.contents[0].text).assets).toEqual(['a', 'b']);
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/manifest.json');
  });

  it('zones resource pulls /api/core/zones with AccountKey', async () => {
    mockFetch([{ Id: 'akande' }]);
    const { zones } = await getResources();
    const out = await zones.handler();
    expect(out.contents[0].uri).toBe('cloudcdn://zones');
    expect(globalThis.fetch.mock.calls[0][1].headers.AccountKey).toBe('ak_test');
  });

  it('rules resource pulls /api/core/rules with AccountKey', async () => {
    mockFetch({ Headers: '/*\n  X-Frame-Options: DENY' });
    const { rules } = await getResources();
    const out = await rules.handler();
    expect(out.contents[0].uri).toBe('cloudcdn://rules');
    expect(JSON.parse(out.contents[0].text).Headers).toContain('X-Frame');
  });

  it('health resource pulls /api/health?deep=1', async () => {
    mockFetch({ status: 'ok' });
    const { health } = await getResources();
    const out = await health.handler();
    expect(out.contents[0].uri).toBe('cloudcdn://health');
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/health');
    expect(url.searchParams.get('deep')).toBe('1');
  });

  it('openapi resource pulls /api-reference/openapi.json', async () => {
    mockFetch({ openapi: '3.1.0', paths: {} });
    const { openapi } = await getResources();
    const out = await openapi.handler();
    expect(out.contents[0].uri).toBe('cloudcdn://openapi');
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api-reference/openapi.json');
  });

  it('insights-today resource pulls /api/insights/summary with AccessKey', async () => {
    mockFetch({ totalRequests: 5000 });
    const resources = await getResources();
    const r = resources['insights-today'];
    const out = await r.handler();
    expect(out.contents[0].uri).toBe('cloudcdn://insights/today');
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/insights/summary');
    expect(opts.headers.AccessKey).toBe('sk_test');
  });
});
