import { describe, it, expect, vi } from 'vitest';

const { onRequestPost, onRequestGet, onRequestDelete, onRequestOptions } = await import('../../functions/api/passkeys/index.js');

function makeKV(data = {}) {
  const store = { ...data };
  return {
    get: vi.fn(key => Promise.resolve(store[key] || null)),
    put: vi.fn((key, val) => { store[key] = val; return Promise.resolve(); }),
    delete: vi.fn(key => { delete store[key]; return Promise.resolve(); }),
  };
}

function makeCtx(path, method = 'POST', options = {}) {
  const h = new Headers();
  if (options.key) h.set('AccountKey', options.key);
  const kv = options.kv || makeKV();
  return {
    request: new Request(`https://cloudcdn.pro/api/passkeys${path}`, {
      method,
      headers: h,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }),
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'admin-key',
      RATE_KV: kv,
      DASHBOARD_SECRET: options.dashboardSecret ?? 'test-secret',
    },
  };
}

describe('Passkeys API', () => {
  describe('POST /api/passkeys/register/begin', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('/register/begin');
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('returns challenge and options', async () => {
      const ctx = makeCtx('/register/begin', 'POST', { key: 'admin-key' });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.challenge).toBeTruthy();
      expect(json.rp.name).toBe('CloudCDN');
      expect(json.pubKeyCredParams).toBeInstanceOf(Array);
      expect(json.pubKeyCredParams.length).toBeGreaterThan(0);
    });

    it('issues stateless challenge without touching KV', async () => {
      const kv = makeKV();
      const ctx = makeCtx('/register/begin', 'POST', { key: 'admin-key', kv });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.challenge).toBeTruthy();
      // No challenge KV writes — stateless model avoids the KV daily quota.
      const challengePuts = kv.put.mock.calls.filter(c => c[0].startsWith('passkeys:challenge:'));
      expect(challengePuts).toHaveLength(0);
    });
  });

  describe('POST /api/passkeys/register/complete', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('/register/complete', 'POST', { body: {} });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('rejects missing fields', async () => {
      const ctx = makeCtx('/register/complete', 'POST', { key: 'admin-key', body: {} });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects invalid challenge', async () => {
      const ctx = makeCtx('/register/complete', 'POST', {
        key: 'admin-key',
        body: { credentialId: 'cred-1', publicKey: 'pk-1', challenge: 'invalid' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('expired');
    });

    it('registers credential with valid challenge', async () => {
      const kv = makeKV();
      // Mint a real signed challenge via /register/begin
      const beginCtx = makeCtx('/register/begin', 'POST', { key: 'admin-key', kv });
      const beginRes = await onRequestPost(beginCtx);
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/register/complete', 'POST', {
        key: 'admin-key', kv,
        body: { credentialId: 'cred-1', publicKey: 'pk-1', challenge, name: 'My YubiKey' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('POST /api/passkeys/auth/begin', () => {
    it('returns challenge and allowed credentials', async () => {
      const kv = makeKV({ 'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1' }]) });
      const ctx = makeCtx('/auth/begin', 'POST', { kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.challenge).toBeTruthy();
      expect(json.allowCredentials).toHaveLength(1);
      expect(json.allowCredentials[0].id).toBe('cred-1');
    });
  });

  describe('POST /api/passkeys/auth/complete', () => {
    it('rejects invalid challenge', async () => {
      const ctx = makeCtx('/auth/complete', 'POST', {
        body: { credentialId: 'cred-1', challenge: 'bad' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects unknown credential', async () => {
      const kv = makeKV({ 'passkeys:credentials': '[]' });
      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'unknown', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('authenticates with valid credential and sets session cookie', async () => {
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1', signCount: 0 }]),
      });
      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'cred-1', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const cookie = res.headers.get('Set-Cookie');
      expect(cookie).toContain('cdn_session=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Strict');
    });

    it('rejects a challenge issued for the register flow (cross-flow replay defence)', async () => {
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1', signCount: 0 }]),
      });
      // Mint a register-flow challenge
      const regCtx = makeCtx('/register/begin', 'POST', { key: 'admin-key', kv });
      const regRes = await onRequestPost(regCtx);
      const { challenge } = await regRes.json();

      // Try to use it on auth/complete — must fail
      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'cred-1', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('expired');
    });
  });

  describe('POST unknown path', () => {
    it('returns 404 for unknown passkey endpoint', async () => {
      const ctx = makeCtx('/unknown', 'POST');
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/passkeys', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('', 'GET');
      // GET handler needs to be called directly
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('lists registered passkeys without publicKey', async () => {
      const kv = makeKV({ 'passkeys:credentials': JSON.stringify([
        { id: 'p1', credentialId: 'c1', publicKey: 'secret-key', name: 'YubiKey', createdAt: '2026-01-01', lastUsedAt: null, signCount: 3 },
      ]) });
      const ctx = makeCtx('', 'GET', { key: 'admin-key', kv });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Passkeys).toHaveLength(1);
      expect(json.Passkeys[0].name).toBe('YubiKey');
      expect(json.Passkeys[0].publicKey).toBeUndefined();
      expect(json.Passkeys[0].credentialId).toBeUndefined();
    });
  });

  describe('DELETE /api/passkeys', () => {
    it('removes a passkey', async () => {
      const kv = makeKV({ 'passkeys:credentials': JSON.stringify([{ id: 'p1', credentialId: 'c1' }]) });
      const ctx = makeCtx('?id=p1', 'DELETE', { key: 'admin-key', kv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown passkey', async () => {
      const kv = makeKV({ 'passkeys:credentials': '[]' });
      const ctx = makeCtx('?id=nope', 'DELETE', { key: 'admin-key', kv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(404);
    });
  });

  describe('OPTIONS', () => {
    it('returns 204', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
    });
  });

  describe('resilience against corrupt KV state', () => {
    it('authBegin returns empty allowCredentials when KV value is malformed JSON', async () => {
      const kv = makeKV({ 'passkeys:credentials': '{not-json' });
      const ctx = makeCtx('/auth/begin', 'POST', { kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.allowCredentials).toEqual([]);
    });

    it('authBegin tolerates a non-array KV value (returns empty list)', async () => {
      const kv = makeKV({ 'passkeys:credentials': '{"oops":"object-not-array"}' });
      const ctx = makeCtx('/auth/begin', 'POST', { kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.allowCredentials).toEqual([]);
    });

    it('POST returns JSON 500 (not a Worker crash) when a handler throws', async () => {
      const throwingKv = {
        get: vi.fn().mockRejectedValue(new Error('kv backplane unreachable')),
        put: vi.fn().mockRejectedValue(new Error('kv backplane unreachable')),
      };
      const ctx = makeCtx('/auth/begin', 'POST', { kv: throwingKv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Passkey handler failed');
      expect(json.detail).toContain('kv backplane');
    });

    it('GET returns JSON 500 when getCredentials KV-reads throw', async () => {
      const throwingKv = {
        get: vi.fn().mockRejectedValue(new Error('storage offline')),
      };
      const ctx = makeCtx('', 'GET', { key: 'admin-key', kv: throwingKv });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Passkey handler failed');
    });

    it('DELETE returns JSON 500 when KV throws mid-operation', async () => {
      const throwingKv = {
        get: vi.fn().mockRejectedValue(new Error('boom')),
      };
      const ctx = makeCtx('?id=p1', 'DELETE', { key: 'admin-key', kv: throwingKv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Passkey handler failed');
    });

    it('POST routes to a JSON 404 for unknown passkey path', async () => {
      const ctx = makeCtx('/nope/unknown', 'POST');
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('Unknown passkey endpoint');
    });
  });
});
