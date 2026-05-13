import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestPost, onRequestDelete, onRequestOptions, dispatchWebhook } = await import('../../functions/api/webhooks.js');

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

    // A 32+ char secret is now mandatory; use a constant 64-char hex string.
    const SECRET = 'a'.repeat(64);

    it('creates a webhook', async () => {
      const kv = makeKV();
      const ctx = makeCtx('POST', '', { key: 'test-key', kv, body: {
        url: 'https://hook.example.com/cb', events: ['asset.created', 'asset.deleted'], secret: SECRET,
      } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Webhook.url).toBe('https://hook.example.com/cb');
      expect(json.Webhook.events).toEqual(['asset.created', 'asset.deleted']);
      expect(json.Webhook.id).toBeTruthy();
      expect(json.Webhook.secret).toBe(SECRET);
    });

    it('rejects non-https URLs', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'http://evil.com', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects http://localhost (no longer permitted)', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'http://localhost:3000/hook', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects https://localhost host', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://localhost:3000/hook', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('internal');
    });

    it('rejects RFC1918 IP hosts', async () => {
      const cases = ['https://10.0.0.1/h', 'https://192.168.1.1/h', 'https://172.16.0.1/h', 'https://127.0.0.1/h'];
      for (const url of cases) {
        const ctx = makeCtx('POST', '', { key: 'test-key', body: { url, events: ['asset.created'], secret: SECRET } });
        const res = await onRequestPost(ctx);
        expect(res.status).toBe(400);
      }
    });

    it('rejects 0.0.0.0/8 hosts', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://0.0.0.0/h', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects 0/8 IPs other than the literal 0.0.0.0', async () => {
      // 0.1.2.3 skips the early-return literal check and hits `if (a === 0)`.
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://0.1.2.3/h', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('accepts public IPs that look close to private ranges but aren\'t', async () => {
      // Each URL below targets a specific && branch in isBlockedHost:
      //   169.253.x.x — NOT link-local (link-local is 169.254.0.0/16)
      //   192.169.x.x — NOT RFC1918
      //   172.15.x.x  — NOT in 172.16.0.0/12 (lower boundary - 1)
      //   172.32.x.x  — NOT in 172.16.0.0/12 (upper boundary + 1)
      const kv = makeKV();
      for (const url of [
        'https://169.253.1.1/h',
        'https://192.169.1.1/h',
        'https://172.15.1.1/h',
        'https://172.32.1.1/h',
      ]) {
        const ctx = makeCtx('POST', '', {
          key: 'test-key', kv, body: { url, events: ['asset.created'], secret: SECRET },
        });
        const res = await onRequestPost(ctx);
        expect(res.status).toBe(201);
      }
    });

    it('rejects IPv6 unique-local (fd00::/8) hosts', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://[fd00::1]/h', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects empty-string URL', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: '', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('required');
    });

    it('rejects link-local 169.254.169.254 (cloud metadata)', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://169.254.169.254/latest/meta-data/', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects other 169.254.x.x link-local addresses', async () => {
      // Bypasses the literal "169.254.169.254" check at the top of
      // isBlockedHost and hits the IPv4 range check at line 66.
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://169.254.1.1/h', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects .internal and .local suffixes', async () => {
      for (const url of ['https://service.internal/h', 'https://printer.local/h']) {
        const ctx = makeCtx('POST', '', { key: 'test-key', body: { url, events: ['asset.created'], secret: SECRET } });
        const res = await onRequestPost(ctx);
        expect(res.status).toBe(400);
      }
    });

    it('rejects URLs with embedded credentials', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://user:pass@example.com/h', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message.toLowerCase()).toContain('credentials');
    });

    it('rejects URLs longer than 2048 chars', async () => {
      const longPath = 'a'.repeat(2100);
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: `https://example.com/${longPath}`, events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects malformed URLs', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'not a url', events: ['asset.created'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects a missing secret', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://hook.example.com/cb', events: ['asset.created'] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('32 characters');
    });

    it('rejects a short secret (< 32 chars)', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://hook.example.com/cb', events: ['asset.created'], secret: 'short' } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects oversized request body via Content-Length', async () => {
      const h = new Headers();
      h.set('AccountKey', 'test-key');
      h.set('content-length', String(100_000));
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/webhooks', {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ url: 'https://hook.example.com/cb', events: ['asset.created'], secret: SECRET, pad: 'x'.repeat(100_000) }),
        }),
        env: { ACCOUNT_KEY: 'test-key', RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(413);
    });

    it('rejects invalid events', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://hook.example.com/cb', events: ['invalid.event'], secret: SECRET } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('Invalid events');
    });

    it('returns 400 when registry is at MAX_WEBHOOKS', async () => {
      const full = Array.from({ length: 25 }, (_, i) => ({
        id: `w-${i}`, url: 'https://x.com', events: ['asset.created'], active: true,
      }));
      const kv = makeKV({ 'webhooks:registered': JSON.stringify(full) });
      const ctx = makeCtx('POST', '', {
        key: 'test-key', kv,
        body: { url: 'https://new.example.com/hook', events: ['asset.created'], secret: SECRET },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('Maximum 25');
    });

    it('rejects empty events', async () => {
      const ctx = makeCtx('POST', '', { key: 'test-key', body: { url: 'https://hook.example.com/cb', events: [], secret: SECRET } });
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

    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('DELETE', '?id=anything');
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(401);
    });
  });

  describe('503 when RATE_KV is missing', () => {
    function makeCtxNoKv(method, query = '') {
      const h = new Headers();
      h.set('AccountKey', 'test-key');
      return {
        request: new Request(`https://cloudcdn.pro/api/webhooks${query}`, {
          method, headers: h,
          ...(method === 'POST' ? { body: JSON.stringify({ url: 'https://x.com/h', events: ['asset.created'] }) } : {}),
        }),
        env: { ACCOUNT_KEY: 'test-key', RATE_KV: null },
      };
    }
    it('GET returns 503', async () => {
      const res = await onRequestGet(makeCtxNoKv('GET'));
      expect(res.status).toBe(503);
    });
    it('POST returns 503', async () => {
      const res = await onRequestPost(makeCtxNoKv('POST'));
      expect(res.status).toBe(503);
    });
    it('DELETE returns 503', async () => {
      const res = await onRequestDelete(makeCtxNoKv('DELETE', '?id=x'));
      expect(res.status).toBe(503);
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

    it('enqueues messages on the WEBHOOK_QUEUE when bound (no direct fetch)', async () => {
      const kv = makeKV({ 'webhooks:registered': JSON.stringify([
        { id: 'w1', url: 'https://a.example.com/h', secret: 'a'.repeat(40), active: true, events: ['asset.created'] },
        { id: 'w2', url: 'https://b.example.com/h', secret: null,             active: true, events: ['asset.created'] },
      ]) });
      const send = vi.fn().mockResolvedValue(undefined);
      globalThis.fetch = vi.fn();
      await dispatchWebhook({ RATE_KV: kv, WEBHOOK_QUEUE: { send } }, 'asset.created', { path: '/x.png' });
      // Two messages enqueued (one per matching webhook), zero direct fetches.
      expect(send).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      const first = send.mock.calls[0][0];
      expect(first).toMatchObject({
        webhookId: 'w1', url: 'https://a.example.com/h', event: 'asset.created', attempt: 0,
      });
      const parsedBody = JSON.parse(first.body);
      expect(parsedBody.event).toBe('asset.created');
      expect(parsedBody.data.path).toBe('/x.png');
    });

    it('silently exits when getWebhooks throws (KV read fails)', async () => {
      // Forces the outer catch in dispatchWebhook (webhooks.js:168).
      const kv = {
        get: vi.fn().mockRejectedValue(new Error('KV read failure')),
        put: vi.fn(),
      };
      globalThis.fetch = vi.fn();
      await dispatchWebhook({ RATE_KV: kv }, 'asset.created', { path: '/x.png' });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('logs a warning when delivery fetch throws', async () => {
      const kv = makeKV({ 'webhooks:registered': JSON.stringify([{ active: true, events: ['asset.created'], url: 'https://hook.example.com/cb' }]) });
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await dispatchWebhook({ RATE_KV: kv }, 'asset.created', { path: '/x.png' });
        expect(warn).toHaveBeenCalled();
        const entry = JSON.parse(warn.mock.calls[0][0]);
        expect(entry.code).toBe('WEBHOOK_DELIVERY_FAILED');
        expect(entry.error).toBe('network down');
      } finally {
        warn.mockRestore();
      }
    });
  });
});
