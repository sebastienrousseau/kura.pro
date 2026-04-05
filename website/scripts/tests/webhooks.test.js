import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestPost, onRequestDelete, onRequestOptions, dispatchWebhook } = await import('../../../functions/api/webhooks.js');

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeKV(data = {}) {
  const store = { ...data };
  return {
    get: vi.fn(key => Promise.resolve(store[key] || null)),
    put: vi.fn((key, val) => { store[key] = val; return Promise.resolve(); }),
    delete: vi.fn(key => { delete store[key]; return Promise.resolve(); }),
  };
}

function makeCtx(method, query = '', options = {}) {
  const h = new Headers();
  if (options.key) h.set('AccountKey', options.key);
  const kv = options.kv || makeKV();
  return {
    request: new Request(`https://cloudcdn.pro/api/webhooks${query}`, {
      method,
      headers: h,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }),
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'test-key',
      RATE_KV: kv,
    },
  };
}

describe('Webhooks API', () => {
  describe('GET /api/webhooks', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('GET');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('returns empty list initially', async () => {
      const ctx = makeCtx('GET', '', { key: 'test-key' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.Webhooks).toEqual([]);
      expect(json.Count).toBe(0);
    });

    it('returns registered webhooks', async () => {
      const kv = makeKV({ 'webhooks:registered': JSON.stringify([{ id: '1', url: 'https://a.com', events: ['asset.created'] }]) });
      const ctx = makeCtx('GET', '', { key: 'test-key', kv });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Count).toBe(1);
      expect(json.Webhooks[0].url).toBe('https://a.com');
    });
  });

  describe('POST /api/webhooks', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('POST', '', { body: { url: 'https://a.com', events: ['asset.created'] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('creates a webhook', async () => {
      const kv = makeKV();
      const ctx = makeCtx('POST', '', { key: 'test-key', kv, body: { url: 'https://hook.example.com/cb', events: ['asset.created', 'asset.deleted'] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Webhook.url).toBe('https://hook.example.com/cb');
      expect(json.Webhook.events).toEqual(['asset.created', 'asset.deleted']);
      expect(json.Webhook.id).toBeTruthy();
    });

    it('rejects non-https URLs', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'http://evil.com', events: ['asset.created'] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('allows http://localhost for dev', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'http://localhost:3000/hook', events: ['asset.created'] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
    });

    it('rejects invalid events', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://a.com', events: ['invalid.event'] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('Invalid events');
    });

    it('rejects empty events', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://a.com', events: [] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects invalid JSON', async () => {
      const h = new Headers(); h.set('AccountKey', 'test-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/webhooks', { method: 'POST', headers: h, body: 'not json' }),
        env: { ACCOUNT_KEY: 'test-key', RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/webhooks', () => {
    it('deletes a webhook by id', async () => {
      const kv = makeKV({ 'webhooks:registered': JSON.stringify([{ id: 'abc', url: 'https://a.com', events: ['asset.created'], active: true }]) });
      const ctx = makeCtx('DELETE', '?id=abc', { key: 'test-key', kv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown id', async () => {
      const kv = makeKV({ 'webhooks:registered': '[]' });
      const ctx = makeCtx('DELETE', '?id=nonexistent', { key: 'test-key', kv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(404);
    });

    it('requires id param', async () => {
      const ctx = makeCtx('DELETE', '', { key: 'test-key' });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(400);
    });
  });

  describe('OPTIONS', () => {
    it('returns 204', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
    });
  });

  describe('dispatchWebhook', () => {
    it('does nothing when KV is null', async () => {
      await dispatchWebhook({}, 'asset.created', { path: '/test.png' });
      // Should not throw
    });

    it('does nothing when no webhooks match', async () => {
      const kv = makeKV({ 'webhooks:registered': JSON.stringify([{ active: true, events: ['zone.created'], url: 'https://a.com' }]) });
      globalThis.fetch = vi.fn();
      await dispatchWebhook({ RATE_KV: kv }, 'asset.created', { path: '/test.png' });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('delivers to matching webhooks', async () => {
      const kv = makeKV({ 'webhooks:registered': JSON.stringify([{ active: true, events: ['asset.created'], url: 'https://hook.example.com/cb' }]) });
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
      await dispatchWebhook({ RATE_KV: kv }, 'asset.created', { path: '/test.png' });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = globalThis.fetch.mock.calls[0];
      expect(url).toBe('https://hook.example.com/cb');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.event).toBe('asset.created');
      expect(body.data.path).toBe('/test.png');
    });

    it('includes HMAC signature when secret configured', async () => {
      const kv = makeKV({ 'webhooks:registered': JSON.stringify([{ active: true, events: ['asset.created'], url: 'https://hook.example.com', secret: 'my-secret' }]) });
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
      await dispatchWebhook({ RATE_KV: kv }, 'asset.created', { path: '/test.png' });
      const [, opts] = globalThis.fetch.mock.calls[0];
      expect(opts.headers['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it('skips inactive webhooks', async () => {
      const kv = makeKV({ 'webhooks:registered': JSON.stringify([{ active: false, events: ['asset.created'], url: 'https://a.com' }]) });
      globalThis.fetch = vi.fn();
      await dispatchWebhook({ RATE_KV: kv }, 'asset.created', {});
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
