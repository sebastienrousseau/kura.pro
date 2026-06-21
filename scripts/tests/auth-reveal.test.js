/**
 * Tests for POST /api/auth/signup/reveal — the one-shot API-key
 * handoff from signup → onboarding.
 *
 * Covers the happy path, all failure modes (no session, no cookie,
 * tampered HMAC, expired payload, user-id mismatch) and the cookie-
 * clearing on success.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const lib = await import('../../functions/api/auth/_lib.js');
const revealModule = await import('../../functions/api/auth/signup/reveal.js');

afterEach(() => { vi.restoreAllMocks(); });

function makeD1({ first = async () => null } = {}) {
  const bind = vi.fn(() => ({ first: vi.fn(first), run: vi.fn().mockResolvedValue({ success: true }) }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare };
}

function makeRequest({ cookie, method = 'POST' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('cf-connecting-ip', '203.0.113.1');
  return { method, url: 'https://cloudcdn.pro/api/auth/signup/reveal', headers };
}

function freshEnv(sessionRow, overrides = {}) {
  return {
    DASHBOARD_SECRET: 'test-secret-for-hmac',
    ACCOUNTS_DB: makeD1({ first: async () => sessionRow }),
    ...overrides,
  };
}

const VALID_SESSION_ROW = {
  token_hash: 'hash', user_id: 'user-1', account_id: 'acct-1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  revoked_at: null,
  email: 'who@example.com', name: null, email_verified_at: null,
  account_id_full: 'acct-1', account_name: 'Test', plan: 'free', monthly_cap_usd: 0,
};

describe('POST /api/auth/signup/reveal', () => {
  it('OPTIONS preflight returns 204', async () => {
    const res = await revealModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('returns 503 when ACCOUNTS_DB binding is missing', async () => {
    const res = await revealModule.onRequestPost({ request: makeRequest(), env: { DASHBOARD_SECRET: 's' } });
    expect(res.status).toBe(503);
  });

  it('returns 401 with no active session', async () => {
    const env = freshEnv(null);
    const res = await revealModule.onRequestPost({ request: makeRequest({ cookie: 'cdn_session=anything' }), env });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
  });

  it('returns 404 when no reveal cookie is present', async () => {
    const env = freshEnv(VALID_SESSION_ROW);
    const res = await revealModule.onRequestPost({ request: makeRequest({ cookie: 'cdn_session=tok' }), env });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  it('returns 404 on a tampered HMAC signature', async () => {
    const env = freshEnv(VALID_SESSION_ROW);
    const goodSigned = await lib.signRevealPayload(env, {
      userId: 'user-1', accountId: 'acct-1', apiKeyId: 'k', apiKeyPrefix: 'cdn_test_AAAAAAAA',
      apiKeyFullKey: 'cdn_test_AAAAAAAA_xxx', apiKeyScopes: ['read'],
    });
    // Flip one character in the signature.
    const tampered = goodSigned.slice(0, -1) + (goodSigned.slice(-1) === '0' ? '1' : '0');
    const res = await revealModule.onRequestPost({
      request: makeRequest({ cookie: `cdn_session=tok; cdn_signup_reveal=${tampered}` }),
      env,
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 on an expired payload', async () => {
    const env = freshEnv(VALID_SESSION_ROW);
    // Manually craft an expired payload + valid signature.
    const expiredPayload = {
      userId: 'user-1', accountId: 'acct-1', apiKeyId: 'k', apiKeyPrefix: 'p',
      apiKeyFullKey: 'cdn_test_x', apiKeyScopes: ['read'],
      expires: Math.floor(Date.now() / 1000) - 60,
    };
    const payloadB64 = btoa(JSON.stringify(expiredPayload))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // Sign with the same secret using the lib's own HMAC helper.
    const { hmacSign } = await import('../../functions/api/_shared.js');
    const sig = await hmacSign('test-secret-for-hmac', payloadB64);
    const signed = `${payloadB64}.${sig}`;
    const res = await revealModule.onRequestPost({
      request: makeRequest({ cookie: `cdn_session=tok; cdn_signup_reveal=${signed}` }),
      env,
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the payload user-id does not match the current session user', async () => {
    const env = freshEnv(VALID_SESSION_ROW);
    const signed = await lib.signRevealPayload(env, {
      userId: 'someone-else', accountId: 'acct-1', apiKeyId: 'k', apiKeyPrefix: 'p',
      apiKeyFullKey: 'cdn_test_x', apiKeyScopes: ['read'],
    });
    const res = await revealModule.onRequestPost({
      request: makeRequest({ cookie: `cdn_session=tok; cdn_signup_reveal=${signed}` }),
      env,
    });
    expect(res.status).toBe(404);
  });

  it('happy path — returns the API key, clears the cookie', async () => {
    const env = freshEnv(VALID_SESSION_ROW);
    const signed = await lib.signRevealPayload(env, {
      userId: 'user-1', accountId: 'acct-1', apiKeyId: 'key-id-123',
      apiKeyPrefix: 'cdn_test_PREFIXAA',
      apiKeyFullKey: 'cdn_test_PREFIXAA_thefullsecretvaluehere1234567890123456',
      apiKeyScopes: ['read', 'write'],
    });
    const res = await revealModule.onRequestPost({
      request: makeRequest({ cookie: `cdn_session=tok; cdn_signup_reveal=${signed}` }),
      env,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('who@example.com');
    expect(body.account.id).toBe('acct-1');
    expect(body.apiKey.fullKey).toBe('cdn_test_PREFIXAA_thefullsecretvaluehere1234567890123456');
    expect(body.apiKey.prefix).toBe('cdn_test_PREFIXAA');
    expect(body.apiKey.scopes).toEqual(['read', 'write']);
    expect(body.apiKey.revealed_once).toBe(true);
    // Cleared cookie header is set on the response.
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('cdn_signup_reveal=');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('Path=/api/auth/signup');
  });
});

describe('signRevealPayload / verifyRevealPayload — round-trip', () => {
  const env = { DASHBOARD_SECRET: 'round-trip-secret' };

  it('round-trips a payload intact', async () => {
    const signed = await lib.signRevealPayload(env, {
      userId: 'u1', accountId: 'a1', apiKeyId: 'k1', apiKeyPrefix: 'p',
      apiKeyFullKey: 'cdn_test_x_y', apiKeyScopes: ['read'],
    });
    const verified = await lib.verifyRevealPayload(env, signed);
    expect(verified).not.toBeNull();
    expect(verified.userId).toBe('u1');
    expect(verified.apiKeyFullKey).toBe('cdn_test_x_y');
  });

  it('rejects a payload signed with a different secret', async () => {
    const signed = await lib.signRevealPayload({ DASHBOARD_SECRET: 'one' }, {
      userId: 'u1', accountId: 'a1', apiKeyId: 'k1', apiKeyPrefix: 'p',
      apiKeyFullKey: 'x', apiKeyScopes: [],
    });
    const verified = await lib.verifyRevealPayload({ DASHBOARD_SECRET: 'two' }, signed);
    expect(verified).toBeNull();
  });

  it('rejects garbage input gracefully', async () => {
    expect(await lib.verifyRevealPayload(env, '')).toBeNull();
    expect(await lib.verifyRevealPayload(env, 'no-dot')).toBeNull();
    expect(await lib.verifyRevealPayload(env, '.justdot')).toBeNull();
    expect(await lib.verifyRevealPayload(env, null)).toBeNull();
  });
});
