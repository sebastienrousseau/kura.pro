import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestPost, onRequestDelete, onRequestOptions, validateToken, authorizeWithScope } = await import('../../functions/api/tokens.js');

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
  if (options.bearer) h.set('Authorization', `Bearer ${options.bearer}`);
  const kv = options.kv || makeKV();
  return {
    request: new Request(`https://cloudcdn.pro/api/tokens${query}`, {
      method,
      headers: h,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }),
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'admin-key',
      RATE_KV: kv,
    },
  };
}

describe('Tokens API', () => {
  describe('GET /api/tokens', () => {
    it('returns 401 without AccountKey', async () => {
      const res = await onRequestGet(makeCtx('GET'));
      expect(res.status).toBe(401);
    });

    it('returns empty list initially', async () => {
      const ctx = makeCtx('GET', '', { key: 'admin-key' });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Tokens).toEqual([]);
      expect(json.Count).toBe(0);
    });

    it('returns tokens with redacted secrets', async () => {
      const kv = makeKV({ 'tokens:registry': JSON.stringify([{
        id: '1', name: 'CI Bot', prefix: 'cdnsk_abcd1234', hash: 'abc', scopes: ['storage:write'],
        createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-12-31T00:00:00Z', lastUsedAt: null,
      }]) });
      const ctx = makeCtx('GET', '', { key: 'admin-key', kv });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Tokens[0].prefix).toBe('cdnsk_abcd1234');
      expect(json.Tokens[0].hash).toBeUndefined();
    });
  });

  describe('POST /api/tokens', () => {
    it('creates a token with scopes', async () => {
      const kv = makeKV();
      const ctx = makeCtx('POST', '', {
        key: 'admin-key', kv,
        body: { name: 'Deploy Bot', scopes: ['storage:write', 'purge:write'], expiresInDays: 90 },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Token.secret).toMatch(/^cdnsk_[0-9a-f]{40}$/);
      expect(json.Token.name).toBe('Deploy Bot');
      expect(json.Token.scopes).toEqual(['storage:write', 'purge:write']);
      expect(json.Token.expiresAt).toBeTruthy();
    });

    it('rejects invalid scopes', async () => {
      const ctx = makeCtx('POST', '', {
        key: 'admin-key',
        body: { name: 'Bad', scopes: ['admin:nuke'] },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('Invalid scopes');
    });

    it('rejects empty scopes', async () => {
      const ctx = makeCtx('POST', '', { key: 'admin-key', body: { name: 'Bad', scopes: [] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects missing name', async () => {
      const ctx = makeCtx('POST', '', { key: 'admin-key', body: { scopes: ['assets:read'] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('defaults to 365-day expiry', async () => {
      const kv = makeKV();
      const ctx = makeCtx('POST', '', { key: 'admin-key', kv, body: { name: 'Test', scopes: ['assets:read'] } });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      const expires = new Date(json.Token.expiresAt);
      const daysFromNow = (expires - Date.now()) / 86400000;
      expect(daysFromNow).toBeGreaterThan(360);
      expect(daysFromNow).toBeLessThanOrEqual(366);
    });

    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('POST', '', { body: { name: 'X', scopes: ['assets:read'] } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid JSON body', async () => {
      const h = new Headers();
      h.set('AccountKey', 'admin-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/tokens', {
          method: 'POST',
          headers: h,
          body: '{not json',
        }),
        env: { ACCOUNT_KEY: 'admin-key', RATE_KV: makeKV() },
      };
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('Invalid JSON');
    });

    it('returns 400 when registry is at MAX_TOKENS', async () => {
      const full = Array.from({ length: 50 }, (_, i) => ({
        id: `t-${i}`, name: `T${i}`, hash: 'h', scopes: ['assets:read'],
      }));
      const kv = makeKV({ 'tokens:registry': JSON.stringify(full) });
      const ctx = makeCtx('POST', '', {
        key: 'admin-key', kv,
        body: { name: 'Overflow', scopes: ['assets:read'] },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.Message).toContain('Maximum 50');
    });
  });

  describe('DELETE /api/tokens', () => {
    it('revokes a token by id', async () => {
      const kv = makeKV({ 'tokens:registry': JSON.stringify([{ id: 'tok-1', name: 'Old', hash: 'x', scopes: [] }]) });
      const ctx = makeCtx('DELETE', '?id=tok-1', { key: 'admin-key', kv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown token', async () => {
      const kv = makeKV({ 'tokens:registry': '[]' });
      const ctx = makeCtx('DELETE', '?id=nope', { key: 'admin-key', kv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(404);
    });

    it('requires id param', async () => {
      const ctx = makeCtx('DELETE', '', { key: 'admin-key' });
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
      h.set('AccountKey', 'admin-key');
      return {
        request: new Request(`https://cloudcdn.pro/api/tokens${query}`, {
          method, headers: h,
          ...(method === 'POST' ? { body: JSON.stringify({ name: 'x', scopes: ['assets:read'] }) } : {}),
        }),
        env: { ACCOUNT_KEY: 'admin-key', RATE_KV: null },
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

  describe('validateToken', () => {
    it('returns false for missing Authorization header', async () => {
      const req = new Request('https://cloudcdn.pro/api/test');
      const result = await validateToken({ RATE_KV: makeKV() }, req, 'storage:read');
      expect(result).toBe(false);
    });

    it('returns false for non-cdnsk token', async () => {
      const req = new Request('https://cloudcdn.pro/api/test', { headers: { Authorization: 'Bearer sk_other_token' } });
      const result = await validateToken({ RATE_KV: makeKV() }, req, 'storage:read');
      expect(result).toBe(false);
    });

    it('returns false for unknown token hash', async () => {
      const kv = makeKV({ 'tokens:registry': '[]' });
      const req = new Request('https://cloudcdn.pro/api/test', { headers: { Authorization: 'Bearer cdnsk_0123456789abcdef0123456789abcdef01234567' } });
      const result = await validateToken({ RATE_KV: kv }, req, 'storage:read');
      expect(result).toBe(false);
    });

    it('returns false for expired token', async () => {
      // Create a token, then manually set its expiry to the past
      const kv = makeKV();
      const ctx = makeCtx('POST', '', { key: 'admin-key', kv, body: { name: 'Expired', scopes: ['storage:read'], expiresInDays: 1 } });
      const res = await onRequestPost(ctx);
      const json = await res.json();

      // Tamper: set expiry to past
      const registry = JSON.parse(kv.put.mock.calls.find(c => c[0] === 'tokens:registry')[1]);
      registry[0].expiresAt = '2020-01-01T00:00:00Z';
      kv.get.mockImplementation(key => key === 'tokens:registry' ? Promise.resolve(JSON.stringify(registry)) : Promise.resolve(null));

      const req = new Request('https://cloudcdn.pro/api/test', { headers: { Authorization: `Bearer ${json.Token.secret}` } });
      const result = await validateToken({ RATE_KV: kv }, req, 'storage:read');
      expect(result).toBe(false);
    });

    it('returns false for wrong scope', async () => {
      const kv = makeKV();
      const ctx = makeCtx('POST', '', { key: 'admin-key', kv, body: { name: 'ReadOnly', scopes: ['assets:read'], expiresInDays: 30 } });
      const res = await onRequestPost(ctx);
      const json = await res.json();

      const registry = JSON.parse(kv.put.mock.calls.find(c => c[0] === 'tokens:registry')[1]);
      kv.get.mockImplementation(key => key === 'tokens:registry' ? Promise.resolve(JSON.stringify(registry)) : Promise.resolve(null));

      const req = new Request('https://cloudcdn.pro/api/test', { headers: { Authorization: `Bearer ${json.Token.secret}` } });
      const result = await validateToken({ RATE_KV: kv }, req, 'storage:write');
      expect(result).toBe(false);
    });

    it('returns true for valid token with correct scope', async () => {
      const kv = makeKV();
      const ctx = makeCtx('POST', '', { key: 'admin-key', kv, body: { name: 'Writer', scopes: ['storage:write'], expiresInDays: 30 } });
      const res = await onRequestPost(ctx);
      const json = await res.json();

      const registry = JSON.parse(kv.put.mock.calls.find(c => c[0] === 'tokens:registry')[1]);
      kv.get.mockImplementation(key => key === 'tokens:registry' ? Promise.resolve(JSON.stringify(registry)) : Promise.resolve(null));

      const req = new Request('https://cloudcdn.pro/api/test', { headers: { Authorization: `Bearer ${json.Token.secret}` } });
      const result = await validateToken({ RATE_KV: kv }, req, 'storage:write');
      expect(result).toBe(true);
    });

    it('returns false when KV is unavailable', async () => {
      const req = new Request('https://cloudcdn.pro/api/test', { headers: { Authorization: 'Bearer cdnsk_abc' } });
      const result = await validateToken({}, req, 'storage:read');
      expect(result).toBe(false);
    });
  });

  describe('authorizeWithScope', () => {
    it('returns true when a valid token matches the required scope (no fallback needed)', async () => {
      const kv = makeKV();
      const ctx = makeCtx('POST', '', { key: 'admin-key', kv, body: { name: 'Reader', scopes: ['assets:read'], expiresInDays: 30 } });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      const registry = JSON.parse(kv.put.mock.calls.find(c => c[0] === 'tokens:registry')[1]);
      kv.get.mockImplementation(key => key === 'tokens:registry' ? Promise.resolve(JSON.stringify(registry)) : Promise.resolve(null));

      const req = new Request('https://cloudcdn.pro/api/test', { headers: { Authorization: `Bearer ${json.Token.secret}` } });
      const fallback = vi.fn().mockReturnValue(false);
      const ok = await authorizeWithScope(req, { RATE_KV: kv }, 'assets:read', fallback);
      expect(ok).toBe(true);
      expect(fallback).not.toHaveBeenCalled();
    });

    it('falls through to the supplied fallback when no token is present', async () => {
      const req = new Request('https://cloudcdn.pro/api/test');
      const fallback = vi.fn().mockReturnValue(true);
      const ok = await authorizeWithScope(req, { RATE_KV: makeKV() }, 'storage:read', fallback);
      expect(ok).toBe(true);
      expect(fallback).toHaveBeenCalled();
    });

    it('falls through to the fallback when the token has the wrong scope', async () => {
      const kv = makeKV();
      const ctx = makeCtx('POST', '', { key: 'admin-key', kv, body: { name: 'NarrowToken', scopes: ['assets:read'], expiresInDays: 30 } });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      const registry = JSON.parse(kv.put.mock.calls.find(c => c[0] === 'tokens:registry')[1]);
      kv.get.mockImplementation(key => key === 'tokens:registry' ? Promise.resolve(JSON.stringify(registry)) : Promise.resolve(null));

      const req = new Request('https://cloudcdn.pro/api/test', { headers: { Authorization: `Bearer ${json.Token.secret}` } });
      const fallback = vi.fn().mockReturnValue(true);
      const ok = await authorizeWithScope(req, { RATE_KV: kv }, 'storage:write', fallback);
      expect(ok).toBe(true);
      expect(fallback).toHaveBeenCalled();
    });

    it('awaits async fallbacks', async () => {
      const req = new Request('https://cloudcdn.pro/api/test');
      const fallback = vi.fn().mockResolvedValue(true);
      const ok = await authorizeWithScope(req, { RATE_KV: makeKV() }, 'storage:read', fallback);
      expect(ok).toBe(true);
    });

    it('returns false when neither the token nor the fallback authorize', async () => {
      const req = new Request('https://cloudcdn.pro/api/test');
      const fallback = vi.fn().mockReturnValue(false);
      const ok = await authorizeWithScope(req, { RATE_KV: makeKV() }, 'storage:read', fallback);
      expect(ok).toBe(false);
    });
  });
});
