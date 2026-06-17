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

  it('uses analytics auth as x-api-key', async () => {
    process.env.CLOUDCDN_ANALYTICS_KEY = 'an_test';
    const { get } = await import('../lib/api-client.js');
    await get('/api/analytics', { auth: 'analytics' });

    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('an_test');
    delete process.env.CLOUDCDN_ANALYTICS_KEY;
  });

  it('sends HEAD verb via head()', async () => {
    const { head } = await import('../lib/api-client.js');
    await head('/api/transform', { params: { url: '/x.png' } });
    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.method).toBe('HEAD');
  });

  it('sends PUT with raw Uint8Array body (no JSON wrapping)', async () => {
    const { put } = await import('../lib/api-client.js');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await put('/api/storage/foo.bin', bytes, { auth: 'access' });
    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBeInstanceOf(Uint8Array);
    expect(opts.headers['Content-Type']).toBeUndefined();
  });

  it('sends PUT with ArrayBuffer body without JSON wrapping', async () => {
    const { put } = await import('../lib/api-client.js');
    const buf = new ArrayBuffer(8);
    await put('/api/storage/foo.bin', buf, { auth: 'access' });
    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.body).toBe(buf);
    expect(opts.headers['Content-Type']).toBeUndefined();
  });

  it('emits empty auth headers when configured key is missing', async () => {
    // Each fetch() consumes the Response body, so build a fresh Response per call.
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }))
    );
    const { get } = await import('../lib/api-client.js');
    const prevAccess = process.env.CLOUDCDN_ACCESS_KEY;
    const prevAccount = process.env.CLOUDCDN_ACCOUNT_KEY;
    const prevPurge = process.env.CLOUDCDN_PURGE_KEY;
    delete process.env.CLOUDCDN_ACCESS_KEY;
    delete process.env.CLOUDCDN_ACCOUNT_KEY;
    delete process.env.CLOUDCDN_PURGE_KEY;
    try {
      await get('/api/x', { auth: 'access' });
      let [, opts] = globalThis.fetch.mock.calls.at(-1);
      expect(opts.headers.AccessKey).toBeUndefined();

      await get('/api/x', { auth: 'account' });
      [, opts] = globalThis.fetch.mock.calls.at(-1);
      expect(opts.headers.AccountKey).toBeUndefined();

      await get('/api/x', { auth: 'purge' });
      [, opts] = globalThis.fetch.mock.calls.at(-1);
      expect(opts.headers['x-api-key']).toBeUndefined();
    } finally {
      process.env.CLOUDCDN_ACCESS_KEY = prevAccess;
      process.env.CLOUDCDN_ACCOUNT_KEY = prevAccount;
      process.env.CLOUDCDN_PURGE_KEY = prevPurge;
    }
  });

  it('falls back to empty headers when auth name is unknown', async () => {
    const { get } = await import('../lib/api-client.js');
    await get('/api/x', { auth: 'nope' });
    const [, opts] = globalThis.fetch.mock.calls.at(-1);
    expect(opts.headers.AccessKey).toBeUndefined();
    expect(opts.headers.AccountKey).toBeUndefined();
  });

  it('analytics auth without a key emits no x-api-key header', async () => {
    const prev = process.env.CLOUDCDN_ANALYTICS_KEY;
    delete process.env.CLOUDCDN_ANALYTICS_KEY;
    try {
      const { get } = await import('../lib/api-client.js');
      await get('/api/analytics', { auth: 'analytics' });
      const [, opts] = globalThis.fetch.mock.calls.at(-1);
      expect(opts.headers['x-api-key']).toBeUndefined();
    } finally {
      process.env.CLOUDCDN_ANALYTICS_KEY = prev;
    }
  });

  it('falls back gracefully when the response has no content-type header', async () => {
    // Building a fake response object so the runtime can't auto-fill a default
    // text/plain content-type the way `new Response(stringBody)` does.
    const fake = {
      ok: true,
      status: 200,
      headers: { get: () => null },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(fake);
    const { get } = await import('../lib/api-client.js');
    const res = await get('/api/raw');
    expect(res.data.contentType).toBe('');
  });
});
