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
  process.env.CLOUDCDN_ACCOUNT_KEY = 'ak_test';
  const { registerLogTools } = await import('../../lib/tools/logs.js');
  const tools = {};
  const server = {
    tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
  };
  registerLogTools(server);
  return tools;
}

describe('log tools', () => {
  it('logs_query passes days/level/limit to /api/logs with AccountKey', async () => {
    mockFetch({ entries: [{ ts: 1, level: 'error', msg: 'boom' }] });
    const tools = await getTools();
    await tools.logs_query({ days: 3, level: 'error', limit: 50 });

    const [url, opts] = globalThis.fetch.mock.calls[0];
    const u = new URL(url);
    expect(u.pathname).toBe('/api/logs');
    expect(u.searchParams.get('days')).toBe('3');
    expect(u.searchParams.get('level')).toBe('error');
    expect(u.searchParams.get('limit')).toBe('50');
    expect(opts.headers.AccountKey).toBe('ak_test');
  });

  it('logs_query omits unset optional params', async () => {
    mockFetch({ entries: [] });
    const tools = await getTools();
    await tools.logs_query({});
    const u = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(u.searchParams.has('days')).toBe(false);
    expect(u.searchParams.has('level')).toBe(false);
    expect(u.searchParams.has('limit')).toBe(false);
  });
});
