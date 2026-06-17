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
  const { registerWebhookTools } = await import('../../lib/tools/webhooks.js');
  const tools = {};
  const server = {
    tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
  };
  registerWebhookTools(server);
  return tools;
}

describe('webhook tools', () => {
  it('webhook_list calls GET /api/webhooks with AccountKey', async () => {
    mockFetch({ webhooks: [{ id: 'wh_1', url: 'https://example.com/hook' }] });
    const tools = await getTools();
    const result = await tools.webhook_list({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.webhooks[0].id).toBe('wh_1');

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/webhooks');
    expect(opts.headers.AccountKey).toBe('ak_test');
  });

  it('webhook_create POSTs url + events array', async () => {
    mockFetch({ id: 'wh_new', url: 'https://example.com/hook' });
    const tools = await getTools();
    await tools.webhook_create({
      url: 'https://example.com/hook',
      events: ['asset.created', 'zone.deleted'],
    });

    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.url).toBe('https://example.com/hook');
    expect(body.events).toEqual(['asset.created', 'zone.deleted']);
    expect(body.secret).toBeUndefined();
  });

  it('webhook_create includes secret when provided', async () => {
    mockFetch({ id: 'wh_new' });
    const tools = await getTools();
    await tools.webhook_create({
      url: 'https://example.com/hook',
      events: ['asset.created'],
      secret: 'super-secret',
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.secret).toBe('super-secret');
  });

  it('webhook_delete DELETEs /api/webhooks?id=', async () => {
    mockFetch({ deleted: true });
    const tools = await getTools();
    await tools.webhook_delete({ id: 'wh_abc' });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/webhooks?id=wh_abc');
    expect(opts.method).toBe('DELETE');
  });
});
