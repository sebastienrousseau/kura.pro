import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set env before importing
process.env.CLOUDCDN_BASE_URL = 'https://test.cloudcdn.pro';
process.env.CLOUDCDN_ACCESS_KEY = 'test-access-key';
process.env.CLOUDCDN_ACCOUNT_KEY = 'test-account-key';
process.env.CLOUDCDN_PURGE_KEY = 'test-purge-key';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('api-client', () => {
  it('sends GET with access auth header', async () => {
    const { get } = await import('../lib/api-client.js');
    await get('/api/assets', { auth: 'access' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://test.cloudcdn.pro/api/assets');
    expect(opts.method).toBe('GET');
    expect(opts.headers.AccessKey).toBe('test-access-key');
  });

  it('sends POST with account auth and JSON body', async () => {
    const { post } = await import('../lib/api-client.js');
    await post('/api/core/zones', { Name: 'test' }, { auth: 'account' });

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://test.cloudcdn.pro/api/core/zones');
    expect(opts.method).toBe('POST');
    expect(opts.headers.AccountKey).toBe('test-account-key');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ Name: 'test' });
  });

  it('sends DELETE with access auth', async () => {
    const { del } = await import('../lib/api-client.js');
    await del('/api/storage/clients/test/logo.svg', { auth: 'access' });

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://test.cloudcdn.pro/api/storage/clients/test/logo.svg');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers.AccessKey).toBe('test-access-key');
  });

  it('sends purge auth as x-api-key', async () => {
    const { post } = await import('../lib/api-client.js');
    await post('/api/purge', { purge_everything: true }, { auth: 'purge' });

    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('test-purge-key');
  });

  it('appends query params to URL', async () => {
    const { get } = await import('../lib/api-client.js');
    await get('/api/assets', { auth: 'access', params: { project: 'akande', page: 2 } });

    const [url] = globalThis.fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('project')).toBe('akande');
    expect(parsed.searchParams.get('page')).toBe('2');
  });

  it('skips undefined params', async () => {
    const { get } = await import('../lib/api-client.js');
    await get('/api/assets', { params: { project: 'test', format: undefined } });

    const [url] = globalThis.fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.has('project')).toBe(true);
    expect(parsed.searchParams.has('format')).toBe(false);
  });

  it('handles non-JSON responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('binary data', {
        headers: { 'content-type': 'image/webp', 'content-length': '12345' },
      })
    );
    const { get } = await import('../lib/api-client.js');
    const res = await get('/api/transform', { params: { url: '/test.png', w: 100 } });

    expect(res.data.contentType).toBe('image/webp');
    expect(res.data.contentLength).toBe('12345');
  });

  it('sends no auth headers for public endpoints', async () => {
    const { get } = await import('../lib/api-client.js');
    await get('/api/health');

    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers.AccessKey).toBeUndefined();
    expect(opts.headers.AccountKey).toBeUndefined();
  });
});
