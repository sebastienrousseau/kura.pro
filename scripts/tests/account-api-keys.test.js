/**
 * Tests for the session-gated account API key endpoint
 * (functions/api/account/api-keys.js) and its dispatch from
 * functions/api/tokens.js#validateToken for `cdn_test_*` keys.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const lib = await import('../../functions/api/auth/_lib.js');
const apiKeys = await import('../../functions/api/account/api-keys.js');
const tokensModule = await import('../../functions/api/tokens.js');

afterEach(() => { vi.restoreAllMocks(); });

const SESSION_ROW = {
  token_hash: 'h', user_id: 'u1', account_id: 'a1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  revoked_at: null,
  email: 'who@example.com', name: null, email_verified_at: null,
  account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: 0,
};

function makeReq({ method = 'GET', url = 'https://cloudcdn.pro/api/account/api-keys', body, cookie = 'cdn_session=tok', auth } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (auth) headers.set('Authorization', auth);
  headers.set('cf-connecting-ip', '203.0.113.1');
  headers.set('user-agent', 'vitest');
  return { method, url, headers, json: async () => body };
}

function makeD1Chain({ firstSeq = [], allRows = [], runImpl } = {}) {
  let n = 0;
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => firstSeq[n++] ?? null),
        all: vi.fn().mockResolvedValue({ results: allRows }),
        run: vi.fn(runImpl || (async () => ({ success: true }))),
      })),
    })),
    batch: vi.fn(),
  };
}

// ── isD1Token ──────────────────────────────────────────────────

describe('isD1Token', () => {
  it.each([
    ['cdn_test_AAAAAAAA_xxx', true],
    ['cdn_live_BBBBBBBB_yyy', true],
    ['cdnsk_legacy', false],
    ['', false],
    [null, false],
    [123, false],
  ])('isD1Token(%j) → %s', (input, expected) => {
    expect(apiKeys.isD1Token(input)).toBe(expected);
  });
});

// ── validateD1ApiKey ────────────────────────────────────────────

describe('validateD1ApiKey', () => {
  it('returns invalid when ACCOUNTS_DB is missing', async () => {
    const r = await apiKeys.validateD1ApiKey({}, 'cdn_test_AAAAAAAA_yyy', 'read');
    expect(r.valid).toBe(false);
  });

  it('returns invalid for non-D1 prefixes', async () => {
    const r = await apiKeys.validateD1ApiKey({ ACCOUNTS_DB: makeD1Chain() }, 'cdnsk_legacy', 'read');
    expect(r.valid).toBe(false);
  });

  it('returns invalid for malformed keys (< 4 segments)', async () => {
    const r = await apiKeys.validateD1ApiKey({ ACCOUNTS_DB: makeD1Chain() }, 'cdn_test_short', 'read');
    expect(r.valid).toBe(false);
  });

  it('returns invalid when DB has no matching row', async () => {
    const r = await apiKeys.validateD1ApiKey(
      { ACCOUNTS_DB: makeD1Chain({ firstSeq: [null] }) },
      'cdn_test_PREFIXAA_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'read',
    );
    expect(r.valid).toBe(false);
  });

  it('returns invalid when row is revoked', async () => {
    const r = await apiKeys.validateD1ApiKey(
      { ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
        id: 'k1', account_id: 'a1', scopes: '["read"]', expires_at: null, revoked_at: 999,
      }] }) },
      'cdn_test_PREFIXAA_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'read',
    );
    expect(r.valid).toBe(false);
  });

  it('returns invalid when row has expired', async () => {
    const r = await apiKeys.validateD1ApiKey(
      { ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
        id: 'k1', account_id: 'a1', scopes: '["read"]',
        expires_at: Math.floor(Date.now() / 1000) - 1, revoked_at: null,
      }] }) },
      'cdn_test_PREFIXAA_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'read',
    );
    expect(r.valid).toBe(false);
  });

  it('returns invalid when scope is missing AND no write fallback', async () => {
    const r = await apiKeys.validateD1ApiKey(
      { ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
        id: 'k1', account_id: 'a1', scopes: '["read"]', expires_at: null, revoked_at: null,
      }] }) },
      'cdn_test_PREFIXAA_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'purge:write',
    );
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('scope_missing');
  });

  it('returns valid when scope present', async () => {
    const r = await apiKeys.validateD1ApiKey(
      { ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
        id: 'k1', account_id: 'a1', scopes: '["read","purge:write"]', expires_at: null, revoked_at: null,
      }] }) },
      'cdn_test_PREFIXAA_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'purge:write',
    );
    expect(r.valid).toBe(true);
    expect(r.accountId).toBe('a1');
  });

  it('"write" scope is a generic fallback that satisfies any required scope', async () => {
    const r = await apiKeys.validateD1ApiKey(
      { ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
        id: 'k1', account_id: 'a1', scopes: '["write"]', expires_at: null, revoked_at: null,
      }] }) },
      'cdn_test_PREFIXAA_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'purge:write',
    );
    expect(r.valid).toBe(true);
  });
});

// ── tokens.js validateToken dispatch ────────────────────────────

describe('tokens.js#validateToken — D1 dispatch', () => {
  it('dispatches to D1 for cdn_test_* prefix', async () => {
    const env = {
      ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
        id: 'k1', account_id: 'a1', scopes: '["purge:write"]', expires_at: null, revoked_at: null,
      }] }),
    };
    const req = makeReq({
      auth: 'Bearer cdn_test_PREFIXAA_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
    expect(await tokensModule.validateToken(env, req, 'purge:write')).toBe(true);
  });

  it('falls through to KV path for cdnsk_* prefix', async () => {
    const env = {
      // No KV → returns false; what we care about is that the D1 path
      // was NOT taken (which would have required ACCOUNTS_DB).
      RATE_KV: null,
    };
    const req = makeReq({ auth: 'Bearer cdnsk_legacy' });
    expect(await tokensModule.validateToken(env, req, 'purge:write')).toBe(false);
  });

  it('returns false for unrecognised prefix', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain(), RATE_KV: { get: vi.fn(), put: vi.fn() } };
    const req = makeReq({ auth: 'Bearer bogus_format' });
    expect(await tokensModule.validateToken(env, req, 'read')).toBe(false);
  });

  it('returns false when no Authorization header', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain() };
    const req = makeReq();
    expect(await tokensModule.validateToken(env, req, 'read')).toBe(false);
  });
});

// ── GET /api/account/api-keys ───────────────────────────────────

describe('GET /api/account/api-keys', () => {
  it('returns 503 without ACCOUNTS_DB', async () => {
    const res = await apiKeys.onRequestGet({ request: makeReq(), env: {} });
    expect(res.status).toBe(503);
  });
  it('returns 401 without session', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [null] }) };
    const res = await apiKeys.onRequestGet({ request: makeReq(), env });
    expect(res.status).toBe(401);
  });
  it('returns 403 when session has no account', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
      ...SESSION_ROW, account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null,
    }] }) };
    const res = await apiKeys.onRequestGet({ request: makeReq(), env });
    expect(res.status).toBe(403);
  });
  it('returns the account keys with scopes parsed', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({
      firstSeq: [SESSION_ROW],
      allRows: [
        { id: 'k1', name: 'Default', prefix: 'cdn_test_AAAAAAAA', scopes: '["read","write"]', created_at: 1, last_used_at: null, expires_at: null, revoked_at: null, created_by_user_id: 'u1' },
        { id: 'k2', name: 'CI', prefix: 'cdn_test_BBBBBBBB', scopes: 'not-json', created_at: 2, last_used_at: null, expires_at: null, revoked_at: 99, created_by_user_id: 'u1' },
      ],
    }) };
    const res = await apiKeys.onRequestGet({ request: makeReq(), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toHaveLength(2);
    expect(body.keys[0].scopes).toEqual(['read', 'write']);
    expect(body.keys[1].scopes).toEqual([]); // malformed JSON → empty
    expect(body.keys[1].revokedAt).toBe(99);
  });
});

// ── POST /api/account/api-keys ──────────────────────────────────

describe('POST /api/account/api-keys', () => {
  it('returns 503 without ACCOUNTS_DB', async () => {
    const res = await apiKeys.onRequestPost({ request: makeReq({ method: 'POST', body: {} }), env: {} });
    expect(res.status).toBe(503);
  });
  it('returns 401 without session', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [null] }) };
    const res = await apiKeys.onRequestPost({ request: makeReq({ method: 'POST', body: {} }), env });
    expect(res.status).toBe(401);
  });
  it('returns 403 when session has no account', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
      ...SESSION_ROW, account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null,
    }] }) };
    const res = await apiKeys.onRequestPost({ request: makeReq({ method: 'POST', body: {} }), env });
    expect(res.status).toBe(403);
  });
  it('returns 400 on bad JSON', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [SESSION_ROW] }) };
    const req = makeReq({ method: 'POST' });
    req.json = async () => { throw new Error('boom'); };
    const res = await apiKeys.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });
  it('returns 400 on missing name', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [SESSION_ROW] }) };
    const res = await apiKeys.onRequestPost({ request: makeReq({ method: 'POST', body: {} }), env });
    expect(res.status).toBe(400);
  });
  it('returns 400 on too-long name', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [SESSION_ROW] }) };
    const res = await apiKeys.onRequestPost({ request: makeReq({ method: 'POST', body: { name: 'x'.repeat(101) } }), env });
    expect(res.status).toBe(400);
  });
  it('returns 400 on invalid scope', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [SESSION_ROW] }) };
    const res = await apiKeys.onRequestPost({
      request: makeReq({ method: 'POST', body: { name: 'X', scopes: ['fake:scope'] } }),
      env,
    });
    expect(res.status).toBe(400);
  });
  it('returns 400 limit_reached when account already has 50 keys', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({
      firstSeq: [SESSION_ROW, { n: 50 }],
    }) };
    const res = await apiKeys.onRequestPost({
      request: makeReq({ method: 'POST', body: { name: 'Over limit' } }),
      env,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('limit_reached');
  });
  it('happy path — 201, returns full key once', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({
      firstSeq: [SESSION_ROW, { n: 0 }],
    }) };
    const res = await apiKeys.onRequestPost({
      request: makeReq({ method: 'POST', body: { name: 'CI', scopes: ['purge:write'] } }),
      env,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key.fullKey).toMatch(/^cdn_test_[0-9A-Za-z]{8}_[0-9A-Za-z]{40}$/);
    expect(body.key.scopes).toEqual(['purge:write']);
  });
});

// ── DELETE /api/account/api-keys ────────────────────────────────

describe('DELETE /api/account/api-keys', () => {
  it('returns 503 without ACCOUNTS_DB', async () => {
    const res = await apiKeys.onRequestDelete({ request: makeReq({ method: 'DELETE' }), env: {} });
    expect(res.status).toBe(503);
  });
  it('returns 401 without session', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [null] }) };
    const res = await apiKeys.onRequestDelete({ request: makeReq({ method: 'DELETE' }), env });
    expect(res.status).toBe(401);
  });
  it('returns 403 when session has no account', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [{
      ...SESSION_ROW, account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null,
    }] }) };
    const res = await apiKeys.onRequestDelete({ request: makeReq({ method: 'DELETE' }), env });
    expect(res.status).toBe(403);
  });
  it('returns 400 without ?id=', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [SESSION_ROW] }) };
    const res = await apiKeys.onRequestDelete({ request: makeReq({ method: 'DELETE' }), env });
    expect(res.status).toBe(400);
  });
  it('happy path — 200 + audit', async () => {
    const env = { ACCOUNTS_DB: makeD1Chain({ firstSeq: [SESSION_ROW] }) };
    const res = await apiKeys.onRequestDelete({
      request: makeReq({ method: 'DELETE', url: 'https://cloudcdn.pro/api/account/api-keys?id=k1' }),
      env,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('k1');
  });
});

describe('OPTIONS preflight', () => {
  it('returns 204', async () => {
    const res = await apiKeys.onRequestOptions();
    expect(res.status).toBe(204);
  });
});
