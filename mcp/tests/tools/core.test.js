import { describe, it, expect, vi, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

function mockFetch(data = {}, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('core tools', () => {
  async function getTools() {
    process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
    process.env.CLOUDCDN_ACCOUNT_KEY = 'ak_test';
    const { registerCoreTools } = await import('../../lib/tools/core.js');
    const tools = {};
    const server = {
      tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
    };
    registerCoreTools(server);
    return tools;
  }

  it('zone_list calls GET /api/core/zones with AccountKey', async () => {
    mockFetch([{ Id: 'akande', FileCount: 10 }]);
    const tools = await getTools();
    const result = await tools.zone_list({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].Id).toBe('akande');
    expect(globalThis.fetch.mock.calls[0][1].headers.AccountKey).toBe('ak_test');
  });

  it('zone_get calls GET /api/core/zones/{id}', async () => {
    mockFetch({ Id: 'akande', FileCount: 10, Files: [] });
    const tools = await getTools();
    await tools.zone_get({ zone_id: 'akande' });
    expect(globalThis.fetch.mock.calls[0][0]).toContain('/api/core/zones/akande');
  });

  it('zone_create calls POST /api/core/zones with Name', async () => {
    mockFetch({ HttpCode: 201, Id: 'newzone' });
    const tools = await getTools();
    await tools.zone_create({ name: 'newzone' });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/core/zones');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).Name).toBe('newzone');
  });

  it('zone_delete calls DELETE /api/core/zones/{id}', async () => {
    mockFetch({ HttpCode: 200, FilesRemoved: 5 });
    const tools = await getTools();
    await tools.zone_delete({ zone_id: 'oldzone' });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/core/zones/oldzone');
    expect(opts.method).toBe('DELETE');
  });

  it('domain_add calls POST /api/core/zones/{id}/domains', async () => {
    mockFetch({ HttpCode: 201, Hostname: 'cdn.example.com' });
    const tools = await getTools();
    await tools.domain_add({ zone_id: 'akande', hostname: 'cdn.example.com' });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/core/zones/akande/domains');
    expect(JSON.parse(opts.body).Hostname).toBe('cdn.example.com');
  });

  it('rules_get calls GET /api/core/rules', async () => {
    mockFetch({ Headers: '/*\n  X-Frame-Options: DENY', Redirects: null });
    const tools = await getTools();
    const result = await tools.rules_get({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.Headers).toContain('X-Frame-Options');
  });

  it('rules_update calls POST /api/core/rules with File and Content', async () => {
    mockFetch({ HttpCode: 200, File: '_headers' });
    const tools = await getTools();
    await tools.rules_update({ file: '_headers', content: '/*\n  X-Frame-Options: DENY' });
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.File).toBe('_headers');
    expect(body.Content).toContain('X-Frame-Options');
  });
});
