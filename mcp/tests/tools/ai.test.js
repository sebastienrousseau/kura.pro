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

describe('ai tools', () => {
  async function getTools() {
    process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
    const { registerAiTools } = await import('../../lib/tools/ai.js');
    const tools = {};
    const server = {
      tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
    };
    registerAiTools(server);
    return tools;
  }

  it('semantic_search passes q and limit to /api/search', async () => {
    mockFetch({ results: [{ name: 'logo.svg', score: 0.95 }], count: 1 });
    const tools = await getTools();
    const result = await tools.semantic_search({ q: 'dark blue banking logo', limit: 10 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results[0].name).toBe('logo.svg');

    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('q')).toBe('dark blue banking logo');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('health_check calls /api/health with no auth', async () => {
    mockFetch({ status: 'ok', bindings: { assets: true, kv: true } });
    const tools = await getTools();
    const result = await tools.health_check({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('ok');

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/health');
    expect(opts.headers.AccessKey).toBeUndefined();
    expect(opts.headers.AccountKey).toBeUndefined();
  });
});
