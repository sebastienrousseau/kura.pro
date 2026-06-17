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

  it('generate_alt_text POSTs to /api/ai/alt-text with the url body field', async () => {
    mockFetch({ url: '/x.png', alt: 'A red square.', source: 'ai' });
    const tools = await getTools();
    const result = await tools.generate_alt_text({ url: '/x.png' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.alt).toBe('A red square.');

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/ai/alt-text');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ url: '/x.png' });
  });

  it('smart_crop POSTs to /api/ai/smart-crop', async () => {
    mockFetch({ url: '/x.png', gravity: 'north', confidence: 'high' });
    const tools = await getTools();
    const result = await tools.smart_crop({ url: '/x.png' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.gravity).toBe('north');

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/ai/smart-crop');
    expect(opts.method).toBe('POST');
  });

  it('moderate_image POSTs to /api/ai/moderate', async () => {
    mockFetch({ url: '/x.png', verdict: 'safe', safe: true, categories: {} });
    const tools = await getTools();
    const result = await tools.moderate_image({ url: '/x.png' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.verdict).toBe('safe');
    expect(parsed.safe).toBe(true);

    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/ai/moderate');
  });

  it('placeholder_lqip GETs /api/lqip with url/size/blur params', async () => {
    mockFetch({ lqip: 'data:image/webp;base64,xyz', width: 32 });
    const tools = await getTools();
    await tools.placeholder_lqip({ url: '/x.png', size: 16, blur: 20 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/lqip');
    expect(url.searchParams.get('url')).toBe('/x.png');
    expect(url.searchParams.get('size')).toBe('16');
    expect(url.searchParams.get('blur')).toBe('20');
  });

  it('placeholder_lqip omits optional params when not supplied', async () => {
    mockFetch({ lqip: 'data:image/webp;base64,xyz', width: 32 });
    const tools = await getTools();
    await tools.placeholder_lqip({ url: '/x.png' });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.searchParams.get('url')).toBe('/x.png');
    expect(url.searchParams.has('size')).toBe(false);
    expect(url.searchParams.has('blur')).toBe(false);
  });

  it('placeholder_blurhash GETs /api/blurhash', async () => {
    mockFetch({ hash: 'a'.repeat(40), dataUri: 'data:image/webp;base64,xyz' });
    const tools = await getTools();
    await tools.placeholder_blurhash({ url: '/x.png', size: 24 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/blurhash');
    expect(url.searchParams.get('size')).toBe('24');
  });

  it('placeholder_blurhash omits size when not supplied', async () => {
    mockFetch({ hash: 'a'.repeat(40) });
    const tools = await getTools();
    await tools.placeholder_blurhash({ url: '/x.png' });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.searchParams.has('size')).toBe(false);
  });

  it('chat_ask POSTs to /api/chat with messages array', async () => {
    mockFetch({ answer: 'Use /api/purge with tags', sources: [], confidence: 'high', source: 'ai' });
    const tools = await getTools();
    const result = await tools.chat_ask({ question: 'how do I purge by tag' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.answer).toContain('purge');
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/chat');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.messages).toEqual([{ role: 'user', content: 'how do I purge by tag' }]);
  });

  it('remove_background catch branch surfaces a structured NotImplemented body', async () => {
    process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const { registerAiTools } = await import('../../lib/tools/ai.js');
    const tools = {};
    registerAiTools({
      tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
    });
    const result = await tools.remove_background({ url: '/x.png' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe('NotImplemented');
    expect(parsed.error.message).toBe('fetch failed');
  });

  it('remove_background catch branch coerces error to string when message is missing', async () => {
    process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
    // Reject with a plain object (not an Error) so err.message is undefined.
    globalThis.fetch = vi.fn().mockRejectedValue({ toString: () => 'opaque-failure' });
    const { registerAiTools } = await import('../../lib/tools/ai.js');
    const tools = {};
    registerAiTools({
      tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
    });
    const result = await tools.remove_background({ url: '/x.png' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe('NotImplemented');
    expect(parsed.error.message).toBe('opaque-failure');
  });

  it('remove_background catch branch surfaces upstream response body if attached', async () => {
    process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
    const err = new Error('boom');
    err.response = { data: { error: { code: 'NotImplemented', message: 'upstream said no' } } };
    globalThis.fetch = vi.fn().mockRejectedValue(err);
    const { registerAiTools } = await import('../../lib/tools/ai.js');
    const tools = {};
    registerAiTools({
      tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
    });
    const result = await tools.remove_background({ url: '/x.png' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.message).toBe('upstream said no');
  });

  it('remove_background POSTs to /api/ai/background-remove (501 stub)', async () => {
    // Stub returns 501 with a structured body; the MCP tool should surface
    // the body as text content rather than throwing, so the agent can read
    // the "blocked by dependency" hint.
    mockFetch({
      error: { code: 'NotImplemented', message: 'Background removal requires a segmentation model...' },
      HttpCode: 501,
    });
    const tools = await getTools();
    const result = await tools.remove_background({ url: '/x.png' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe('NotImplemented');

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/ai/background-remove');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ url: '/x.png' });
  });
});
