/**
 * Tests for the D1-backed passkey auth endpoints under
 * /api/auth/passkey/{register,auth}/{begin,complete}.
 *
 * `verifyAssertion` (full WebAuthn signature verification) is mocked at
 * the module level so we don't need real attestation bytes — we test the
 * dispatch paths around it (challenge, lookups, response shape).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// IMPORTANT: vi.mock is hoisted; mock the source module the passkey
// _lib re-exports verifyAssertion from.
vi.mock('../../functions/api/passkeys/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Default mock — tests can override per-it via vi.mocked(...).
    verifyAssertion: vi.fn(async () => ({ valid: true, alg: 'ES256' })),
  };
});

const passkeysSourceModule = await import('../../functions/api/passkeys/index.js');
const passkeyLib = await import('../../functions/api/auth/passkey/_lib.js');
const registerBeginModule = await import('../../functions/api/auth/passkey/register/begin.js');
const registerCompleteModule = await import('../../functions/api/auth/passkey/register/complete.js');
const authBeginModule = await import('../../functions/api/auth/passkey/auth/begin.js');
const authCompleteModule = await import('../../functions/api/auth/passkey/auth/complete.js');

afterEach(() => { vi.clearAllMocks(); });

// ── Test helpers ─────────────────────────────────────────────────

function makeD1({ first = async () => null, all = async () => ({ results: [] }), batch = async () => [] } = {}) {
  const bind = vi.fn(() => ({
    first: vi.fn(first),
    all: vi.fn(all),
    run: vi.fn().mockResolvedValue({ success: true }),
  }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, batch: vi.fn(batch) };
}

function makeRequest({ method = 'POST', url = 'https://cloudcdn.pro/api/auth/passkey/register/begin', body, cookie } = {}) {
  const headers = new Headers();
  headers.set('cf-connecting-ip', '203.0.113.1');
  headers.set('user-agent', 'vitest');
  if (cookie) headers.set('cookie', cookie);
  if (body) headers.set('content-type', 'application/json');
  return {
    method, url, headers,
    cf: { country: 'US' },
    json: async () => (body === undefined ? {} : body),
  };
}

function freshEnv(overrides = {}) {
  return {
    LAUNCH_PUBLIC: '1',
    DASHBOARD_SECRET: 'passkey-test-secret',
    ACCOUNTS_DB: makeD1(),
    RATE_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    ...overrides,
  };
}

// ── _lib.js direct ───────────────────────────────────────────────

describe('passkey _lib — direct unit tests', () => {
  it('rpId + expectedOrigin extract from request URL', () => {
    const req = { url: 'https://cloudcdn.pro/api/auth/passkey/x' };
    expect(passkeyLib.rpId(req)).toBe('cloudcdn.pro');
    expect(passkeyLib.expectedOrigin(req)).toBe('https://cloudcdn.pro');
  });

  it('challengeSecret precedence honours PASSKEY_CHALLENGE_SECRET first', () => {
    expect(passkeyLib.challengeSecret({ PASSKEY_CHALLENGE_SECRET: 'p', DASHBOARD_SECRET: 'd' })).toBe('p');
    expect(passkeyLib.challengeSecret({ DASHBOARD_SECRET: 'd' })).toBe('d');
    expect(passkeyLib.challengeSecret({ DASHBOARD_PASSWORD: 'pw' })).toBe('pw');
    expect(passkeyLib.challengeSecret({})).toBe('cdn-dev-only-secret');
  });

  it('getCredentialDescriptorsByEmail returns empty when email is missing', async () => {
    const env = { ACCOUNTS_DB: makeD1() };
    expect(await passkeyLib.getCredentialDescriptorsByEmail(env, '')).toEqual({ user: null, descriptors: [] });
  });

  it('getCredentialDescriptorsByEmail returns empty when user is unknown', async () => {
    const env = { ACCOUNTS_DB: makeD1({ first: async () => null }) };
    const r = await passkeyLib.getCredentialDescriptorsByEmail(env, 'unknown@ex.com');
    expect(r.user).toBeNull();
    expect(r.descriptors).toEqual([]);
  });

  it('getCredentialDescriptorsByEmail returns descriptor list when user has passkeys', async () => {
    let n = 0;
    const fakeCredentialId = new Uint8Array([1, 2, 3, 4]);
    const env = {
      ACCOUNTS_DB: makeD1({
        first: async () => { n++; return n === 1 ? { id: 'u1' } : null; },
        all: async () => ({ results: [
          { credential_id: fakeCredentialId.buffer, transports: 'internal,hybrid' },
          { credential_id: fakeCredentialId.buffer, transports: null },
        ] }),
      }),
    };
    const r = await passkeyLib.getCredentialDescriptorsByEmail(env, 'known@ex.com');
    expect(r.user).toEqual({ id: 'u1' });
    expect(r.descriptors).toHaveLength(2);
    expect(r.descriptors[0]).toEqual({ type: 'public-key', id: expect.any(String), transports: ['internal', 'hybrid'] });
    expect(r.descriptors[1].transports).toBeUndefined();
  });

  it('getPasskeyByCredentialId returns null on empty input', async () => {
    expect(await passkeyLib.getPasskeyByCredentialId({ ACCOUNTS_DB: makeD1() }, '')).toBeNull();
  });

  it('getPasskeyByCredentialId returns null when not found', async () => {
    expect(await passkeyLib.getPasskeyByCredentialId({ ACCOUNTS_DB: makeD1({ first: async () => null }) }, 'AAAA')).toBeNull();
  });

  it('getPasskeyByCredentialId hydrates the row + decodes public_key', async () => {
    const pk = new Uint8Array([10, 20, 30]);
    const cid = new Uint8Array([5, 6, 7]);
    const env = {
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          id: 'p1', user_id: 'u1', public_key: pk.buffer, sign_count: 3, name: 'Mac',
          email: 'u@ex.com', user_name: 'U',
        }),
      }),
    };
    const r = await passkeyLib.getPasskeyByCredentialId(env, passkeyLib.bufferToBase64url(cid));
    expect(r.userId).toBe('u1');
    expect(r.publicKey).toBe(passkeyLib.bufferToBase64url(pk));
    expect(r.signCount).toBe(3);
    expect(r.user.email).toBe('u@ex.com');
  });

  it('getPasskeyByCredentialId returns null public_key when DB has null blob', async () => {
    const cid = new Uint8Array([5, 6, 7]);
    const env = {
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          id: 'p1', user_id: 'u1', public_key: null, sign_count: null, name: null,
          email: 'u@ex.com', user_name: null,
        }),
      }),
    };
    const r = await passkeyLib.getPasskeyByCredentialId(env, passkeyLib.bufferToBase64url(cid));
    expect(r.publicKey).toBeNull();
    expect(r.signCount).toBe(0);
  });

  it('insertPasskey runs the INSERT and returns an id', async () => {
    const env = { ACCOUNTS_DB: makeD1() };
    const r = await passkeyLib.insertPasskey(env, {
      userId: 'u1', credentialIdB64: 'AAAA', publicKeyB64: 'BBBB', name: 'k', transports: 'internal',
    });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.ACCOUNTS_DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO passkeys'));
  });

  it('bumpPasskeyUsage swallows D1 errors and returns {ok:false}', async () => {
    const env = {
      ACCOUNTS_DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ run: vi.fn().mockRejectedValue(new Error('d1 down')) })),
        })),
      },
    };
    const r = await passkeyLib.bumpPasskeyUsage(env, 'AAAA', 5);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('d1 down');
  });

  it('bumpPasskeyUsage reports ok on success', async () => {
    const env = { ACCOUNTS_DB: makeD1() };
    const r = await passkeyLib.bumpPasskeyUsage(env, 'AAAA', 5);
    expect(r.ok).toBe(true);
  });
});

// ── register/begin ──────────────────────────────────────────────

describe('POST /api/auth/passkey/register/begin', () => {
  it('OPTIONS preflight returns 204', async () => {
    const res = await registerBeginModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('returns 503 when launch is gated', async () => {
    const env = freshEnv({ LAUNCH_PUBLIC: '0' });
    const res = await registerBeginModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com' } }), env });
    expect(res.status).toBe(503);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const env = freshEnv({ ACCOUNTS_DB: undefined });
    const res = await registerBeginModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com' } }), env });
    expect(res.status).toBe(503);
  });

  it('returns 400 on bad JSON body', async () => {
    const env = freshEnv();
    const req = makeRequest();
    req.json = async () => { throw new Error('boom'); };
    const res = await registerBeginModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('returns 400 invalid_input on missing/bad email (signup path)', async () => {
    const env = freshEnv();
    const res = await registerBeginModule.onRequestPost({
      request: makeRequest({ body: { email: 'not-an-email' } }), env,
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 email_exists when the email already has an account', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({ first: async () => ({ id: 'existing-user' }) }),
    });
    const res = await registerBeginModule.onRequestPost({
      request: makeRequest({ body: { email: 'already@here.com' } }), env,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('email_exists');
  });

  it('signup path — happy: returns PublicKeyCredentialCreationOptions', async () => {
    const env = freshEnv();
    const res = await registerBeginModule.onRequestPost({
      request: makeRequest({ body: { email: 'new@example.com' } }), env,
    });
    expect(res.status).toBe(200);
    const opts = await res.json();
    expect(opts.rp.id).toBe('cloudcdn.pro');
    expect(opts.user.name).toBe('new@example.com');
    expect(opts.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(opts.pubKeyCredParams).toEqual(expect.arrayContaining([
      expect.objectContaining({ alg: -7 }),
    ]));
    expect(opts.excludeCredentials).toEqual([]);
  });

  it('add-device path — uses session user, populates excludeCredentials', async () => {
    let n = 0;
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => {
          n++;
          // 1st: getCurrentSession → returns session row
          if (n === 1) {
            return {
              token_hash: 'h', user_id: 'u1', account_id: 'a1',
              expires_at: Math.floor(Date.now() / 1000) + 3600, revoked_at: null,
              email: 'session@ex.com', name: 'X', email_verified_at: null,
              account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: 0,
            };
          }
          // 2nd: user lookup by email
          if (n === 2) return { id: 'u1' };
          return null;
        },
        all: async () => ({ results: [
          { credential_id: new Uint8Array([1, 2]).buffer, transports: null },
        ] }),
      }),
    });
    const res = await registerBeginModule.onRequestPost({
      request: makeRequest({ cookie: 'cdn_session=tok' }), env,
    });
    expect(res.status).toBe(200);
    const opts = await res.json();
    expect(opts.user.name).toBe('session@ex.com');
    expect(opts.excludeCredentials.length).toBe(1);
  });
});

// ── register/complete ───────────────────────────────────────────

describe('POST /api/auth/passkey/register/complete', () => {
  it('OPTIONS preflight returns 204', async () => {
    const res = await registerCompleteModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('returns 503 when launch is gated', async () => {
    const env = freshEnv({ LAUNCH_PUBLIC: '0' });
    const res = await registerCompleteModule.onRequestPost({ request: makeRequest({ body: {} }), env });
    expect(res.status).toBe(503);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const env = freshEnv({ ACCOUNTS_DB: undefined });
    const res = await registerCompleteModule.onRequestPost({ request: makeRequest({ body: {} }), env });
    expect(res.status).toBe(503);
  });

  it('returns 400 on bad JSON', async () => {
    const env = freshEnv();
    const req = makeRequest();
    req.json = async () => { throw new Error('boom'); };
    const res = await registerCompleteModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('returns 400 invalid_input when required fields are missing', async () => {
    const env = freshEnv();
    const res = await registerCompleteModule.onRequestPost({
      request: makeRequest({ body: { credentialId: 'x' } }), env,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 invalid_challenge when the HMAC fails', async () => {
    const env = freshEnv();
    const res = await registerCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'AAAA', publicKey: 'BBBB', challenge: 'tampered.signed.token', email: 'a@b.com',
      } }), env,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_challenge');
  });

  it('signup path — happy: 201 + cookies + audit events', async () => {
    const env = freshEnv();
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'register');
    const res = await registerCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'AAAAAAAA', publicKey: 'BBBBBBBB', challenge, email: 'new-passkey@ex.com',
        name: 'Mac', transports: 'internal',
      } }), env,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('new-passkey@ex.com');
    expect(body.account.plan).toBe('free');
    expect(body.apiKey.reveal_via).toBe('POST /api/auth/signup/reveal');
    expect(body.redirectTo).toBe('/onboarding');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('cdn_session=');
    expect(setCookie).toContain('cdn_signup_reveal=');
  });

  it('signup path — 409 when email already exists (pre-batch check)', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({ first: async () => ({ id: 'existing' }) }),
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'register');
    const res = await registerCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'A', publicKey: 'B', challenge, email: 'taken@ex.com',
      } }), env,
    });
    expect(res.status).toBe(409);
  });

  it('signup path — 409 when batch insert hits UNIQUE race', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: {
        prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null), run: vi.fn(), all: vi.fn().mockResolvedValue({ results: [] }) })) })),
        batch: vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed')),
      },
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'register');
    const res = await registerCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'A', publicKey: 'B', challenge, email: 'race@ex.com',
      } }), env,
    });
    expect(res.status).toBe(409);
  });

  it('signup path — 500 on non-UNIQUE batch failure', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: {
        prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null), run: vi.fn(), all: vi.fn().mockResolvedValue({ results: [] }) })) })),
        batch: vi.fn().mockRejectedValue(new Error('database is locked')),
      },
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'register');
    const res = await registerCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'A', publicKey: 'B', challenge, email: 'err@ex.com',
      } }), env,
    });
    expect(res.status).toBe(500);
  });

  it('signup path — 400 when email is missing', async () => {
    const env = freshEnv();
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'register');
    const res = await registerCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'A', publicKey: 'B', challenge, /* no email */
      } }), env,
    });
    expect(res.status).toBe(400);
  });

  it('add-device path — session present, returns 200 ok + audit event', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          token_hash: 'h', user_id: 'u1', account_id: 'a1',
          expires_at: Math.floor(Date.now() / 1000) + 3600, revoked_at: null,
          email: 'session@ex.com', name: 'X', email_verified_at: null,
          account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: 0,
        }),
      }),
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'register');
    const res = await registerCompleteModule.onRequestPost({
      request: makeRequest({
        cookie: 'cdn_session=tok',
        body: { credentialId: 'AAAAAAAA', publicKey: 'BBBBBBBB', challenge, name: 'YubiKey' },
      }),
      env,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('add-device');
  });
});

// ── auth/begin ───────────────────────────────────────────────────

describe('POST /api/auth/passkey/auth/begin', () => {
  it('OPTIONS returns 204', async () => {
    const res = await authBeginModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const env = freshEnv({ ACCOUNTS_DB: undefined });
    const res = await authBeginModule.onRequestPost({ request: makeRequest({ body: {} }), env });
    expect(res.status).toBe(503);
  });

  it('no email → empty allowCredentials (discoverable flow)', async () => {
    const env = freshEnv();
    const res = await authBeginModule.onRequestPost({ request: makeRequest({ body: {} }), env });
    expect(res.status).toBe(200);
    const opts = await res.json();
    expect(opts.allowCredentials).toEqual([]);
    expect(opts.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('unknown email → empty allowCredentials (no enumeration leak)', async () => {
    const env = freshEnv({ ACCOUNTS_DB: makeD1({ first: async () => null }) });
    const res = await authBeginModule.onRequestPost({ request: makeRequest({ body: { email: 'nobody@ex.com' } }), env });
    expect(res.status).toBe(200);
    expect((await res.json()).allowCredentials).toEqual([]);
  });

  it('known email → allowCredentials populated', async () => {
    let n = 0;
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => { n++; return n === 1 ? { id: 'u1' } : null; },
        all: async () => ({ results: [
          { credential_id: new Uint8Array([1, 2, 3]).buffer, transports: 'internal' },
        ] }),
      }),
    });
    const res = await authBeginModule.onRequestPost({ request: makeRequest({ body: { email: 'known@ex.com' } }), env });
    const opts = await res.json();
    expect(opts.allowCredentials).toHaveLength(1);
  });

  it('tolerates a malformed body without crashing', async () => {
    const env = freshEnv();
    const req = makeRequest();
    req.json = async () => { throw new Error('not json'); };
    const res = await authBeginModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
  });
});

// ── auth/complete ───────────────────────────────────────────────

describe('POST /api/auth/passkey/auth/complete', () => {
  it('OPTIONS returns 204', async () => {
    const res = await authCompleteModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const env = freshEnv({ ACCOUNTS_DB: undefined });
    const res = await authCompleteModule.onRequestPost({ request: makeRequest({ body: {} }), env });
    expect(res.status).toBe(503);
  });

  it('returns 400 on bad JSON', async () => {
    const env = freshEnv();
    const req = makeRequest();
    req.json = async () => { throw new Error('boom'); };
    const res = await authCompleteModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('returns 400 when credentialId or challenge is missing', async () => {
    const env = freshEnv();
    const res = await authCompleteModule.onRequestPost({ request: makeRequest({ body: { credentialId: 'x' } }), env });
    expect(res.status).toBe(400);
  });

  it('returns 400 invalid_challenge when HMAC fails', async () => {
    const env = freshEnv();
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: { credentialId: 'A', challenge: 'bad.token' } }), env,
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 unknown_credential when the credential is not in the DB', async () => {
    const env = freshEnv({ ACCOUNTS_DB: makeD1({ first: async () => null }) });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'auth');
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: { credentialId: 'AAAA', challenge } }), env,
    });
    expect(res.status).toBe(401);
  });

  it('happy path — verifies assertion, mints session, returns user+account', async () => {
    // Mock verifyAssertion to a valid result (already the default).
    let n = 0;
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => {
          n++;
          // 1st: getPasskeyByCredentialId
          if (n === 1) return {
            id: 'p1', user_id: 'u1', public_key: new Uint8Array([1]).buffer, sign_count: 0, name: 'k',
            email: 'p@ex.com', user_name: 'P',
          };
          // 2nd: accounts lookup
          if (n === 2) return { id: 'a1', name: 'A', plan: 'free', monthly_cap_usd: 0 };
          return null;
        },
      }),
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'auth');
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'AAAA', challenge,
        authenticatorData: 'auth-data-b64', signature: 'sig-b64', clientDataJSON: 'cdj-b64',
      } }),
      env,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('p@ex.com');
    expect(body.account.id).toBe('a1');
    expect(body.verification).toBe('ES256');
    expect(res.headers.get('set-cookie')).toContain('cdn_session=');
    expect(res.headers.get('X-Passkey-Verification')).toBe('ES256');
  });

  it('strict mode — 401 when verifyAssertion fails', async () => {
    vi.mocked(passkeysSourceModule.verifyAssertion).mockResolvedValueOnce({ valid: false, reason: 'origin mismatch' });
    const env = freshEnv({
      PASSKEY_STRICT_VERIFY: '1',
      ACCOUNTS_DB: makeD1({
        first: async () => ({ id: 'p1', user_id: 'u1', public_key: new Uint8Array([1]).buffer, sign_count: 0, name: 'k', email: 'p@ex.com', user_name: 'P' }),
      }),
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'auth');
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'AAAA', challenge,
        authenticatorData: 'a', signature: 's', clientDataJSON: 'c',
      } }),
      env,
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_assertion');
  });

  it('loose mode — accepts when verifyAssertion fails, surfaces reason via header', async () => {
    vi.mocked(passkeysSourceModule.verifyAssertion).mockResolvedValueOnce({ valid: false, reason: 'sig mismatch' });
    let n = 0;
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => {
          n++;
          if (n === 1) return { id: 'p1', user_id: 'u1', public_key: new Uint8Array([1]).buffer, sign_count: 5, name: 'k', email: 'p@ex.com', user_name: 'P' };
          return null;
        },
      }),
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'auth');
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'AAAA', challenge,
        authenticatorData: 'a', signature: 's', clientDataJSON: 'c',
      } }),
      env,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Passkey-Verification')).toBe('loose');
    expect(res.headers.get('X-Passkey-Verification-Reason')).toBe('sig mismatch');
  });

  it('legacy-spki fallback — accepts old credentials with reason header', async () => {
    vi.mocked(passkeysSourceModule.verifyAssertion).mockResolvedValueOnce({
      valid: false, reason: 'stored publicKey is not SPKI - legacy attestation object',
    });
    let n = 0;
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => {
          n++;
          if (n === 1) return { id: 'p1', user_id: 'u1', public_key: new Uint8Array([1]).buffer, sign_count: 0, name: 'k', email: 'p@ex.com', user_name: 'P' };
          return null;
        },
      }),
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'auth');
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'AAAA', challenge,
        authenticatorData: 'a', signature: 's', clientDataJSON: 'c',
      } }),
      env,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Passkey-Verification')).toBe('legacy-spki');
  });

  it('strict mode — 401 when assertion fields are absent (legacy bare-credentialId request)', async () => {
    const env = freshEnv({
      PASSKEY_STRICT_VERIFY: '1',
      ACCOUNTS_DB: makeD1({
        first: async () => ({ id: 'p1', user_id: 'u1', public_key: new Uint8Array([1]).buffer, sign_count: 0, name: 'k', email: 'p@ex.com', user_name: 'P' }),
      }),
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'auth');
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: { credentialId: 'AAAA', challenge } }), env,
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('missing_assertion');
  });

  it('legacy bare-credentialId in loose mode — accepted with verification=legacy', async () => {
    let n = 0;
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => {
          n++;
          if (n === 1) return { id: 'p1', user_id: 'u1', public_key: new Uint8Array([1]).buffer, sign_count: 0, name: 'k', email: 'p@ex.com', user_name: 'P' };
          return null;
        },
      }),
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'auth');
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: { credentialId: 'AAAA', challenge } }), env,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Passkey-Verification')).toBe('legacy');
  });

  it('surfaces sign-counter save failure via response header', async () => {
    let n = 0;
    let updateCallCount = 0;
    const env = freshEnv({
      ACCOUNTS_DB: {
        prepare: vi.fn((sql) => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => {
              n++;
              if (n === 1) return { id: 'p1', user_id: 'u1', public_key: new Uint8Array([1]).buffer, sign_count: 0, name: 'k', email: 'p@ex.com', user_name: 'P' };
              if (n === 2) return { id: 'a1', name: 'A', plan: 'free', monthly_cap_usd: 0 };
              return null;
            }),
            run: vi.fn(async () => {
              if (sql.includes('UPDATE passkeys SET sign_count')) {
                updateCallCount++;
                throw new Error('quota');
              }
              return { success: true };
            }),
          })),
        })),
        batch: vi.fn(),
      },
    });
    const challenge = await passkeysSourceModule.issueChallenge(env.DASHBOARD_SECRET, 'auth');
    const res = await authCompleteModule.onRequestPost({
      request: makeRequest({ body: {
        credentialId: 'AAAA', challenge,
        authenticatorData: 'a', signature: 's', clientDataJSON: 'c',
      } }),
      env,
    });
    expect(res.status).toBe(200);
    expect(updateCallCount).toBe(1);
    expect(res.headers.get('X-Passkey-Counter-Save')).toContain('failed');
  });
});
