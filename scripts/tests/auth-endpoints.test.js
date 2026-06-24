/**
 * Integration tests for the public auth endpoints under /api/auth/*.
 *
 * D1 (ACCOUNTS_DB) and the auth-hasher Worker (AUTH_HASHER) are mocked.
 * Cloudflare-side primitives like Turnstile siteverify and HIBP are
 * mocked at globalThis.fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signupModule = await import('../../functions/api/auth/signup.js');
const sessionModule = await import('../../functions/api/auth/session.js');
const loginModule = await import('../../functions/api/auth/password/login.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

// ── D1 mock factory ──
// Returns an object with the same .prepare().bind().first/.run/.all/.batch
// chain D1 exposes. Per-test, override the resolver functions to
// produce the rows the endpoint expects.
function makeD1({ first = async () => null, run = async () => ({ success: true }), all = async () => ({ results: [] }), batch = async () => [] } = {}) {
  const prepare = vi.fn((_sql) => {
    const stmt = {
      bind: vi.fn(() => stmt),
      first: vi.fn(first),
      run: vi.fn(run),
      all: vi.fn(all),
    };
    return stmt;
  });
  return { prepare, batch: vi.fn(batch) };
}

// ── auth-hasher mock ──
function makeHasher({ hashOk = true, hashValue = '$argon2id$v=19$dummy', verifyValid = true } = {}) {
  return {
    fetch: vi.fn(async (url) => {
      const path = new URL(url).pathname;
      if (path === '/hash') {
        return hashOk
          ? new Response(JSON.stringify({ hash: hashValue }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          : new Response(JSON.stringify({ error: 'fail' }), { status: 500 });
      }
      if (path === '/verify') {
        return new Response(JSON.stringify({ valid: verifyValid }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }),
  };
}

function makeRequest({ method = 'POST', url = 'https://cloudcdn.pro/api/auth/signup', body, cookie, ip = '203.0.113.1', userAgent = 'vitest/1.0', cf = {} } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  headers.set('cf-connecting-ip', ip);
  headers.set('user-agent', userAgent);
  if (cookie) headers.set('cookie', cookie);
  return {
    method, url, headers,
    cf: { threatScore: 0, asn: 0, country: 'US', ...cf },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function freshEnv(overrides = {}) {
  return {
    LAUNCH_PUBLIC: '1',
    STRICT_AUTH: '0',
    ACCOUNTS_DB: makeD1(),
    AUTH_HASHER: makeHasher(),
    RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue() },
    ...overrides,
  };
}

// Default fetch mock — siteverify ok, HIBP returns no breaches.
function defaultExternalMocks() {
  globalThis.fetch = vi.fn(async (url) => {
    const u = typeof url === 'string' ? url : url.url;
    if (u.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (u.startsWith('https://api.pwnedpasswords.com/range/')) {
      return new Response('OTHERSUFFIX:1', { status: 200 });
    }
    return new Response('not stubbed: ' + u, { status: 599 });
  });
}

// ─────────────────────────────────────────────────────────────────
// signup.js
// ─────────────────────────────────────────────────────────────────
describe('POST /api/auth/signup', () => {
  beforeEach(() => defaultExternalMocks());

  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await signupModule.onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  function validBody(overrides = {}) {
    return {
      email: 'newuser@example.com',
      password: 'correct-horse-battery-staple-2026',
      consents: { tos: true, marketing: false },
      turnstile: 'mock-turnstile-token',
      ts_elapsed_ms: 5000,
      company_website: '',
      ...overrides,
    };
  }

  it('returns 503 when LAUNCH_PUBLIC != "1"', async () => {
    const env = freshEnv({ LAUNCH_PUBLIC: '0' });
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe('launch_gated');
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const env = freshEnv({ ACCOUNTS_DB: undefined });
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe('infra_missing');
  });

  it('returns 400 on malformed JSON body', async () => {
    const env = freshEnv();
    const req = makeRequest({ body: undefined });
    req.json = async () => { throw new Error('parse'); };
    const res = await signupModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
  });

  it('returns 400 on missing/invalid email', async () => {
    const env = freshEnv();
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody({ email: 'not-an-email' }) }), env });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
  });

  it('returns 400 when password is shorter than 12 chars', async () => {
    const env = freshEnv();
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody({ password: 'short' }) }), env });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
  });

  it('returns 400 when ToS consent is missing', async () => {
    const env = freshEnv();
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody({ consents: { tos: false } }) }), env });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
  });

  it('returns 400 bot_detected when honeypot is filled', async () => {
    const env = freshEnv();
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody({ company_website: 'spam' }) }), env });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bot_detected');
  });

  it('returns 400 turnstile_failed when siteverify rejects', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = typeof url === 'string' ? url : url.url;
      if (u.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
        return new Response(JSON.stringify({ success: false }), { status: 200 });
      }
      return new Response('OTHER:1', { status: 200 });
    });
    const env = freshEnv({ TURNSTILE_SECRET_KEY: 'sk' });
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('turnstile_failed');
  });

  it('returns 409 email_exists when a user with that email is already present', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({ first: async () => ({ id: 'existing-user-id' }) }),
    });
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('email_exists');
  });

  it('happy path — 201 with API key, account, session cookie', async () => {
    const env = freshEnv();
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.email).toBe('newuser@example.com');
    expect(json.account.plan).toBe('free');
    expect(json.account.monthlyCapUsd).toBe(0);
    expect(json.apiKey.prefix).toMatch(/^cdn_test_[0-9A-Za-z]{8}$/);
    // The full key is never returned in the JSON body any more — it lives
    // only in the cdn_signup_reveal cookie, fetched by /onboarding via
    // POST /api/auth/signup/reveal.
    expect(json.apiKey.fullKey).toBeUndefined();
    expect(json.apiKey.reveal_via).toBe('POST /api/auth/signup/reveal');
    expect(json.redirectTo).toBe('/onboarding');
    // Session cookie + reveal cookie both present
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('cdn_session=');
    expect(setCookie).toContain('cdn_signup_reveal=');
    expect(setCookie).toContain('Path=/api/auth/signup');
    expect(env.AUTH_HASHER.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/hash'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  // PR #116 — post-success audit/attempt writes fan out via waitUntil
  // so the response doesn't wait for D1 round-trips. Verify the waitUntil
  // path is taken when the Pages Functions context exposes it.
  it('happy path with waitUntil — schedules post-success writes off the response path', async () => {
    const env = freshEnv();
    const waitUntil = vi.fn((p) => p); // record + pass through so awaiters work
    const res = await signupModule.onRequestPost({
      request: makeRequest({ body: validBody({ email: 'wu@example.com' }) }),
      env,
      waitUntil,
    });
    expect(res.status).toBe(201);
    // waitUntil was called exactly once with a Promise — the
    // Promise.all of the three post-success writes.
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    // Let the background promise settle so the test runner doesn't
    // flag dangling state.
    await waitUntil.mock.calls[0][0];
  });

  it('marketing consent path inserts the additional consents row', async () => {
    const env = freshEnv();
    const res = await signupModule.onRequestPost({
      request: makeRequest({ body: validBody({ consents: { tos: true, marketing: true } }) }),
      env,
    });
    expect(res.status).toBe(201);
    // batch() was called with > 5 statements (users + password + accounts +
    // memberships + ToS consent + marketing consent)
    const lastBatch = env.ACCOUNTS_DB.batch.mock.calls.at(-1)[0];
    expect(lastBatch.length).toBeGreaterThanOrEqual(6);
  });

  it('returns 409 email_exists when batch insert hits UNIQUE constraint race', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null), run: vi.fn() })),
        })),
        batch: vi.fn().mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: users.email')),
      },
    });
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('email_exists');
  });

  // PR #111 — per-email signup rate limit defends against enumeration.
  it('returns 429 rate_limited when the per-email signup cap is hit (enumeration defense)', async () => {
    // RATE_KV returns '3' for the per-email signup counter — at the cap.
    const env = freshEnv({
      RATE_KV: { get: vi.fn(async (k) => k.startsWith('signup-email:') ? '3' : null), put: vi.fn() },
    });
    const res = await signupModule.onRequestPost({
      request: makeRequest({ body: validBody({ email: 'probe@example.com' }) }),
      env,
    });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
  });

  it('returns 500 internal when batch insert hits a non-UNIQUE error', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null), run: vi.fn() })),
        })),
        batch: vi.fn().mockRejectedValue(new Error('D1_ERROR: database is locked')),
      },
    });
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('internal');
  });

  it('returns 500 internal when hashPassword fails', async () => {
    const env = freshEnv({
      AUTH_HASHER: { fetch: vi.fn().mockResolvedValue(new Response('err', { status: 500 })) },
    });
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('internal');
  });

  it('returns 429 rate_limited when the per-IP limit trips', async () => {
    const env = freshEnv({
      RATE_KV: { get: vi.fn().mockResolvedValue('999'), put: vi.fn() },
    });
    const res = await signupModule.onRequestPost({ request: makeRequest({ body: validBody() }), env });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
  });

  it('rejects a known-pwned password when HIBP reports count >= 5', async () => {
    // Real round-trip: compute the SHA-1 of a candidate password and
    // mock the HIBP range endpoint to return the exact suffix with a
    // high count. Tests the actual reject-on-pwned branch.
    const password = 'correct-horse-battery-staple-2026';
    const enc = new TextEncoder().encode(password);
    const sha1 = await crypto.subtle.digest('SHA-1', enc);
    const hex = [...new Uint8Array(sha1)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);

    globalThis.fetch = vi.fn(async (urlOrReq) => {
      const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
      if (u.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (u === `https://api.pwnedpasswords.com/range/${prefix}`) {
        return new Response(`${suffix}:9999999`, { status: 200 });
      }
      return new Response('OTHER:1', { status: 200 });
    });
    const env = freshEnv();
    const res = await signupModule.onRequestPost({
      request: makeRequest({ body: validBody({ password }) }),
      env,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('pwned_password');
  });

});

// ─────────────────────────────────────────────────────────────────
// session.js
// ─────────────────────────────────────────────────────────────────
describe('GET/DELETE /api/auth/session', () => {
  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await sessionModule.onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('DELETE revokes the active session and emits an audit event', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run, first: vi.fn().mockResolvedValue({
      token_hash: 'h', user_id: 'u1', account_id: 'a1',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      revoked_at: null,
      email: 'who@example.com', name: null, email_verified_at: null,
      account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: 0,
    }) }));
    const prepare = vi.fn(() => ({ bind }));
    const env = freshEnv({ ACCOUNTS_DB: { prepare } });
    const res = await sessionModule.onRequestDelete({
      request: makeRequest({ method: 'DELETE', cookie: 'cdn_session=token' }),
      env,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).authenticated).toBe(false);
    // Cleared cookies present
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    // revokeSession was invoked (UPDATE sessions...)
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE sessions SET revoked_at'));
  });

  it('GET returns authenticated:false without a session cookie', async () => {
    const env = freshEnv();
    const res = await sessionModule.onRequestGet({ request: makeRequest({ method: 'GET' }), env });
    expect(res.status).toBe(200);
    expect((await res.json()).authenticated).toBe(false);
  });

  it('GET returns authenticated:true with a valid session row', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          token_hash: 'sha-hash',
          user_id: 'u1',
          account_id: 'a1',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          revoked_at: null,
          email: 'who@example.com',
          name: null,
          email_verified_at: null,
          account_id_full: 'a1',
          account_name: 'Test Account',
          plan: 'free',
          monthly_cap_usd: 0,
        }),
      }),
    });
    const res = await sessionModule.onRequestGet({
      request: makeRequest({ method: 'GET', cookie: 'cdn_session=anything' }),
      env,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authenticated).toBe(true);
    expect(json.user.email).toBe('who@example.com');
    expect(json.account.plan).toBe('free');
  });

  it('GET returns authenticated:false when the session has expired', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          token_hash: 'sha-hash',
          user_id: 'u1',
          account_id: null,
          expires_at: Math.floor(Date.now() / 1000) - 100,
          revoked_at: null,
          email: 'who@example.com',
          name: null,
          email_verified_at: null,
          account_id_full: null,
          account_name: null,
          plan: null,
          monthly_cap_usd: null,
        }),
      }),
    });
    const res = await sessionModule.onRequestGet({
      request: makeRequest({ method: 'GET', cookie: 'cdn_session=anything' }),
      env,
    });
    expect((await res.json()).authenticated).toBe(false);
  });

  it('DELETE always returns 200 with cleared cookies, even without an active session', async () => {
    const env = freshEnv();
    const res = await sessionModule.onRequestDelete({ request: makeRequest({ method: 'DELETE' }), env });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('cdn_session=');
    expect(setCookie).toContain('Max-Age=0');
  });
});

// ─────────────────────────────────────────────────────────────────
// password/login.js
// ─────────────────────────────────────────────────────────────────
describe('POST /api/auth/password/login', () => {
  it('returns 503 when bindings are missing', async () => {
    const env = freshEnv({ ACCOUNTS_DB: undefined });
    const res = await loginModule.onRequestPost({
      request: makeRequest({ body: { email: 'a@b.com', password: 'p' } }),
      env,
    });
    expect(res.status).toBe(503);
  });

  it('returns 400 on malformed JSON', async () => {
    const env = freshEnv();
    const req = makeRequest({ body: undefined });
    req.json = async () => { throw new Error('parse'); };
    const res = await loginModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('returns 401 for an unknown email (still burns the hasher to mask timing)', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({ first: async () => null }),
    });
    const res = await loginModule.onRequestPost({
      request: makeRequest({ body: { email: 'nobody@example.com', password: 'whatever-12chars' } }),
      env,
    });
    expect(res.status).toBe(401);
    expect(env.AUTH_HASHER.fetch).toHaveBeenCalled();
  });

  it('returns 401 when the password is wrong', async () => {
    let callCount = 0;
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => {
          callCount++;
          if (callCount === 1) {
            return { user_id: 'u1', email: 'who@example.com', name: null, email_verified_at: null, hashed_password: '$argon2id$...' };
          }
          return null;
        },
      }),
      AUTH_HASHER: makeHasher({ verifyValid: false }),
    });
    const res = await loginModule.onRequestPost({
      request: makeRequest({ body: { email: 'who@example.com', password: 'wrong-12-characters' } }),
      env,
    });
    expect(res.status).toBe(401);
  });

  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await loginModule.onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('returns 429 when the rate-limit trips', async () => {
    const env = freshEnv({
      RATE_KV: { get: vi.fn().mockResolvedValue('99'), put: vi.fn() },
    });
    const res = await loginModule.onRequestPost({
      request: makeRequest({ body: { email: 'a@b.com', password: 'p' } }),
      env,
    });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
  });

  it('happy path — 200 with session cookie + account info', async () => {
    let callCount = 0;
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => {
          callCount++;
          if (callCount === 1) {
            return { user_id: 'u1', email: 'who@example.com', name: null, email_verified_at: null, hashed_password: '$argon2id$...' };
          }
          if (callCount === 2) {
            return { id: 'a1', name: 'Account One', plan: 'free', monthly_cap_usd: 0 };
          }
          return null;
        },
      }),
      AUTH_HASHER: makeHasher({ verifyValid: true }),
    });
    const res = await loginModule.onRequestPost({
      request: makeRequest({ body: { email: 'who@example.com', password: 'correct-12-characters' } }),
      env,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe('who@example.com');
    expect(json.account.id).toBe('a1');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('cdn_session=');
  });

  // PR #110 — per-email lockout for distributed credential stuffing.
  // Independent of source IP: 5 failed attempts on a single email within
  // any 15-min window locks the account regardless of where the attempts
  // originated.
  it('returns 429 after the per-email failure cap is hit (distributed stuffing defense)', async () => {
    // Mock RATE_KV to return a count at the cap, simulating prior
    // failed attempts from other IPs.
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          user_id: 'u1', email: 'victim@example.com', name: null,
          email_verified_at: null, hashed_password: '$argon2id$mock',
        }),
      }),
      AUTH_HASHER: makeHasher({ verifyValid: false }),
      // login-fail:* key returns a count >= 5 → checkRateLimit !allowed
      RATE_KV: { get: vi.fn(async (k) => k.startsWith('login-fail:') ? '5' : null), put: vi.fn() },
    });
    const res = await loginModule.onRequestPost({
      request: makeRequest({ body: { email: 'victim@example.com', password: 'wrong-12chars' } }),
      env,
    });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
  });

  it('still returns 401 invalid_credentials on the first few failures (under cap)', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          user_id: 'u1', email: 'who@example.com', name: null,
          email_verified_at: null, hashed_password: '$argon2id$mock',
        }),
      }),
      AUTH_HASHER: makeHasher({ verifyValid: false }),
      // RATE_KV returns '2' for login-fail keys — well under cap of 5
      RATE_KV: { get: vi.fn(async (k) => k.startsWith('login-fail:') ? '2' : null), put: vi.fn() },
    });
    const res = await loginModule.onRequestPost({
      request: makeRequest({ body: { email: 'who@example.com', password: 'wrong-12chars' } }),
      env,
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_credentials');
  });
});
