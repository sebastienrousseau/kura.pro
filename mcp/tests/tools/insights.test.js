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

describe('insights tools', () => {
  async function getTools() {
    process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
    process.env.CLOUDCDN_ACCESS_KEY = 'sk_test';
    const { registerInsightsTools } = await import('../../lib/tools/insights.js');
    const tools = {};
    const server = {
      tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
    };
    registerInsightsTools(server);
    return tools;
  }

  it('insights_summary passes days and zone params', async () => {
    mockFetch({ totalRequests: 5000 });
    const tools = await getTools();
    await tools.insights_summary({ days: 30, zone: 'akande' });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/insights/summary');
    expect(url.searchParams.get('days')).toBe('30');
    expect(url.searchParams.get('zone')).toBe('akande');
  });

  it('insights_top_assets passes days and limit', async () => {
    mockFetch({ assets: [] });
    const tools = await getTools();
    await tools.insights_top_assets({ days: 7, limit: 10 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/insights/top-assets');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('insights_geography passes days param', async () => {
    mockFetch({ US: 500, DE: 200 });
    const tools = await getTools();
    await tools.insights_geography({ days: 14 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/insights/geography');
    expect(url.searchParams.get('days')).toBe('14');
  });

  it('insights_errors passes days param', async () => {
    mockFetch({ '404': { count: 50 } });
    const tools = await getTools();
    await tools.insights_errors({ days: 7 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/insights/errors');
  });

  it('insights_asset queries /api/insights/asset with path and days', async () => {
    mockFetch({ Path: '/x', TotalRequests: 42, Daily: [] });
    const tools = await getTools();
    await tools.insights_asset({ path: 'stocks/photo.webp', days: 14 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/insights/asset');
    expect(url.searchParams.get('path')).toBe('stocks/photo.webp');
    expect(url.searchParams.get('days')).toBe('14');
  });

  it('audit_logs queries /api/core/audit-logs with AccountKey auth', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'acct_test';
    mockFetch({ Entries: [], Count: 0 });
    const tools = await getTools();
    await tools.audit_logs({ days: 7, action: 'token.create', limit: 100 });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    const u = new URL(url);
    expect(u.pathname).toBe('/api/core/audit-logs');
    expect(u.searchParams.get('action')).toBe('token.create');
    expect(opts.headers.AccountKey).toBe('acct_test');
  });
});
