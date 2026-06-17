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
  const { registerTokenTools } = await import('../../lib/tools/tokens.js');
  const tools = {};
  const server = {
    tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
  };
  registerTokenTools(server);
  return tools;
}

describe('token tools', () => {
  it('token_list calls GET /api/tokens with AccountKey', async () => {
    mockFetch({ tokens: [{ id: 't_1', prefix: 'tk_abcd', scopes: ['assets:read'] }] });
    const tools = await getTools();
    const result = await tools.token_list({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tokens[0].prefix).toBe('tk_abcd');

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/tokens');
    expect(opts.headers.AccountKey).toBe('ak_test');
  });

  it('token_create POSTs name + scopes + expiresInDays', async () => {
    mockFetch({ id: 't_new', secret: 'tk_xxx_yyy', prefix: 'tk_xxx' });
    const tools = await getTools();
    const result = await tools.token_create({
      name: 'CI deploy bot',
      scopes: ['storage:read', 'storage:write'],
      expiresInDays: 30,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.secret).toBe('tk_xxx_yyy');

    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.name).toBe('CI deploy bot');
    expect(body.scopes).toEqual(['storage:read', 'storage:write']);
    expect(body.expiresInDays).toBe(30);
  });

  it('token_revoke DELETEs /api/tokens with id as a URL-encoded query param', async () => {
    mockFetch({ revoked: true });
    const tools = await getTools();
    await tools.token_revoke({ id: 't/with spaces & symbols' });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.method).toBe('DELETE');
    const u = new URL(url);
    expect(u.pathname).toBe('/api/tokens');
    // URL-encoded by the api-client rather than naively interpolated.
    expect(u.searchParams.get('id')).toBe('t/with spaces & symbols');
  });
});
