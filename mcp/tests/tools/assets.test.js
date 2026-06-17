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

async function getTools() {
  process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
  process.env.CLOUDCDN_ACCESS_KEY = 'sk_test';
  const { registerAssetsTools } = await import('../../lib/tools/assets.js');
  const tools = {};
  const server = {
    tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
  };
  registerAssetsTools(server);
  return tools;
}

describe('assets tools', () => {
  describe('assets_list', () => {
    it('passes filter params to GET /api/assets with AccessKey', async () => {
      mockFetch({ results: [{ name: 'logo.svg' }], total: 1 });
      const tools = await getTools();

      const result = await tools.assets_list({
        project: 'akande',
        category: 'logos',
        format: 'svg',
        page: 2,
        per_page: 25,
        sort: 'size',
        order: 'desc',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results[0].name).toBe('logo.svg');

      const [url, opts] = globalThis.fetch.mock.calls[0];
      const u = new URL(url);
      expect(u.pathname).toBe('/api/assets');
      expect(u.searchParams.get('project')).toBe('akande');
      expect(u.searchParams.get('category')).toBe('logos');
      expect(u.searchParams.get('format')).toBe('svg');
      expect(u.searchParams.get('page')).toBe('2');
      expect(u.searchParams.get('per_page')).toBe('25');
      expect(u.searchParams.get('sort')).toBe('size');
      expect(u.searchParams.get('order')).toBe('desc');
      expect(opts.headers.AccessKey).toBe('sk_test');
    });

    it('works with zero filters', async () => {
      mockFetch({ results: [], total: 0 });
      const tools = await getTools();
      await tools.assets_list({});
      const u = new URL(globalThis.fetch.mock.calls[0][0]);
      expect(u.pathname).toBe('/api/assets');
    });
  });

  describe('asset_metadata_get', () => {
    it('passes path to /api/assets/metadata', async () => {
      mockFetch({ path: '/akande/v1/logos/akande.svg', size: 1234, format: 'svg' });
      const tools = await getTools();

      const result = await tools.asset_metadata_get({ path: '/akande/v1/logos/akande.svg' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.format).toBe('svg');

      const url = new URL(globalThis.fetch.mock.calls[0][0]);
      expect(url.pathname).toBe('/api/assets/metadata');
      expect(url.searchParams.get('path')).toBe('/akande/v1/logos/akande.svg');
    });
  });

  describe('assets_search', () => {
    it('passes q with optional project + format filters', async () => {
      mockFetch({ results: [{ name: 'banner-akande.svg' }] });
      const tools = await getTools();

      await tools.assets_search({ q: 'banner', project: 'akande', format: 'svg' });
      const u = new URL(globalThis.fetch.mock.calls[0][0]);
      expect(u.pathname).toBe('/api/assets');
      expect(u.searchParams.get('q')).toBe('banner');
      expect(u.searchParams.get('project')).toBe('akande');
      expect(u.searchParams.get('format')).toBe('svg');
      expect(u.searchParams.get('per_page')).toBe('50');
    });

    it('omits project + format when not provided', async () => {
      mockFetch({ results: [] });
      const tools = await getTools();
      await tools.assets_search({ q: 'banner' });
      const u = new URL(globalThis.fetch.mock.calls[0][0]);
      expect(u.searchParams.get('q')).toBe('banner');
      expect(u.searchParams.has('project')).toBe(false);
      expect(u.searchParams.has('format')).toBe(false);
    });
  });
});
