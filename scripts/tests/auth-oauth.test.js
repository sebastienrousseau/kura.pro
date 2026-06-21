/**
 * OAuth tests covering:
 *   - functions/api/auth/_oauth.js — pure helpers + provider config
 *   - functions/api/auth/oauth/[provider]/begin.js — state mint + redirect
 *   - functions/api/auth/oauth/[provider]/callback.js — state validate,
 *     code exchange, userinfo fetch, user find-or-create, session mint
 *
 * D1, KV, and the OAuth provider HTTP endpoints (token + userinfo) are
 * mocked. Three providers tested: google, github, apple.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const oauth = await import('../../functions/api/auth/_oauth.js');
const beginModule = await import('../../functions/api/auth/oauth/[provider]/begin.js');
const callbackModule = await import('../../functions/api/auth/oauth/[provider]/callback.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

// ── Mocks ──────────────────────────────────────────────────────

function makeKv() {
  const store = new Map();
  return {
    get: vi.fn(async (k) => store.get(k) || null),
    put: vi.fn(async (k, v, _opts) => { store.set(k, v); }),
    delete: vi.fn(async (k) => { store.delete(k); }),
    _store: store,
  };
}

function makeD1({ first = async () => null, batch = async () => [] } = {}) {
  const bind = vi.fn(() => ({
    first: vi.fn(first),
    run: vi.fn().mockResolvedValue({ success: true }),
  }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, batch: vi.fn(batch) };
}

function makeRequest({ method = 'GET', url = 'https://cloudcdn.pro/api/auth/oauth/google/begin', body, ip = '203.0.113.1', userAgent = 'vitest' } = {}) {
  const headers = new Headers();
  headers.set('cf-connecting-ip', ip);
  headers.set('user-agent', userAgent);
  if (body) headers.set('content-type', 'application/x-www-form-urlencoded');
  return {
    method, url, headers,
    formData: async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(body || {})) fd.set(k, v);
      return fd;
    },
  };
}

function googleEnv(overrides = {}) {
  return {
    LAUNCH_PUBLIC: '1',
    GOOGLE_OAUTH_CLIENT_ID: 'google-cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
    ACCOUNTS_DB: makeD1(),
    RATE_KV: makeKv(),
    ...overrides,
  };
}
function githubEnv(overrides = {}) {
  return {
    LAUNCH_PUBLIC: '1',
    GITHUB_OAUTH_CLIENT_ID: 'gh-cid',
    GITHUB_OAUTH_CLIENT_SECRET: 'gh-secret',
    ACCOUNTS_DB: makeD1(),
    RATE_KV: makeKv(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// _oauth.js pure helpers
// ─────────────────────────────────────────────────────────────────

describe('PROVIDERS + providerConfigured', () => {
  it('lists exactly the three Phase 0 providers', () => {
    expect(Object.keys(oauth.PROVIDERS).sort()).toEqual(['apple', 'github', 'google']);
  });

  it('providerConfigured returns false without credentials', () => {
    expect(oauth.providerConfigured({}, 'google')).toBe(false);
    expect(oauth.providerConfigured({ GOOGLE_OAUTH_CLIENT_ID: 'x' }, 'google')).toBe(false);
    expect(oauth.providerConfigured({ GOOGLE_OAUTH_CLIENT_ID: 'x', GOOGLE_OAUTH_CLIENT_SECRET: 'y' }, 'google')).toBe(true);
  });

  it('providerConfigured for apple requires the JWT triple', () => {
    const partial = { APPLE_OAUTH_CLIENT_ID: 'a' };
    expect(oauth.providerConfigured(partial, 'apple')).toBe(false);
    const full = {
      APPLE_OAUTH_CLIENT_ID: 'a',
      APPLE_OAUTH_TEAM_ID: 't',
      APPLE_OAUTH_KEY_ID: 'k',
      APPLE_OAUTH_PRIVATE_KEY: 'pem',
    };
    expect(oauth.providerConfigured(full, 'apple')).toBe(true);
  });

  it('providerConfigured returns false for unknown provider', () => {
    expect(oauth.providerConfigured({}, 'discord')).toBe(false);
  });
});

describe('state issue / consume', () => {
  it('issueState writes to KV with 10-min TTL', async () => {
    const env = { RATE_KV: makeKv() };
    const state = await oauth.issueState(env, 'google');
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(env.RATE_KV.put).toHaveBeenCalledWith(
      `oauth:state:${state}`,
      expect.stringContaining('"provider":"google"'),
      expect.objectContaining({ expirationTtl: 600 }),
    );
  });

  it('consumeState reads + deletes the row', async () => {
    const env = { RATE_KV: makeKv() };
    const state = await oauth.issueState(env, 'github');
    const record = await oauth.consumeState(env, state);
    expect(record).toEqual({ provider: 'github', createdAt: expect.any(Number) });
    expect(env.RATE_KV.delete).toHaveBeenCalledWith(`oauth:state:${state}`);
    // Second consume → null
    expect(await oauth.consumeState(env, state)).toBeNull();
  });

  it('consumeState returns null for missing or undefined state', async () => {
    const env = { RATE_KV: makeKv() };
    expect(await oauth.consumeState(env, undefined)).toBeNull();
    expect(await oauth.consumeState(env, 'unknown')).toBeNull();
  });

  it('issueState throws without RATE_KV binding', async () => {
    await expect(oauth.issueState({}, 'google')).rejects.toThrow(/RATE_KV/);
  });
});

describe('buildAuthorizationUrl', () => {
  it('builds a valid Google authorisation URL', () => {
    const env = { GOOGLE_OAUTH_CLIENT_ID: 'google-cid' };
    const url = oauth.buildAuthorizationUrl(env, 'google', {
      state: 'abc123',
      redirectUri: 'https://cloudcdn.pro/api/auth/oauth/google/callback',
    });
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
    expect(url).toContain('client_id=google-cid');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fcloudcdn.pro%2Fapi%2Fauth%2Foauth%2Fgoogle%2Fcallback');
    expect(url).toContain('response_type=code');
    expect(url).toContain('state=abc123');
    expect(url).toContain('prompt=select_account');
    expect(url).toContain('scope=openid+email+profile');
  });

  it('builds a valid Apple authorisation URL with response_mode=form_post', () => {
    const env = { APPLE_OAUTH_CLIENT_ID: 'apple-cid' };
    const url = oauth.buildAuthorizationUrl(env, 'apple', {
      state: 's',
      redirectUri: 'https://cloudcdn.pro/api/auth/oauth/apple/callback',
    });
    expect(url).toContain('https://appleid.apple.com/auth/authorize?');
    expect(url).toContain('response_mode=form_post');
    expect(url).toContain('scope=name+email');
  });

  it('throws for unknown provider', () => {
    expect(() => oauth.buildAuthorizationUrl({}, 'discord', { state: 's', redirectUri: 'r' }))
      .toThrow(/unknown provider/);
  });
});

describe('decodeJwtPayload', () => {
  it('decodes a valid JWT payload', () => {
    // Header: {"alg":"none","typ":"JWT"}, Payload: {"sub":"abc","email":"e@x"}
    const header = btoa('{"alg":"none","typ":"JWT"}').replace(/=/g, '');
    const payload = btoa('{"sub":"abc","email":"e@x"}').replace(/=/g, '');
    const decoded = oauth.decodeJwtPayload(`${header}.${payload}.sig`);
    expect(decoded).toEqual({ sub: 'abc', email: 'e@x' });
  });
  it('throws on malformed input', () => {
    expect(() => oauth.decodeJwtPayload('not-a-jwt')).toThrow();
  });
});

describe('buildRedirectUri', () => {
  it('returns the canonical callback URL for the host', () => {
    const req = { url: 'https://cloudcdn.pro/api/auth/oauth/github/begin' };
    expect(oauth.buildRedirectUri(req, 'github')).toBe('https://cloudcdn.pro/api/auth/oauth/github/callback');
  });
});

// ─────────────────────────────────────────────────────────────────
// begin.js
// ─────────────────────────────────────────────────────────────────

describe('GET /api/auth/oauth/[provider]/begin', () => {
  it('OPTIONS preflight returns 204', async () => {
    const res = await beginModule.onRequestOptions();
    expect(res.status).toBe(204);
  });

  it('returns 503 when LAUNCH_PUBLIC != 1', async () => {
    const env = googleEnv({ LAUNCH_PUBLIC: '0' });
    const res = await beginModule.onRequestGet({ request: makeRequest(), env, params: { provider: 'google' } });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('launch_gated');
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const env = googleEnv({ ACCOUNTS_DB: undefined });
    const res = await beginModule.onRequestGet({ request: makeRequest(), env, params: { provider: 'google' } });
    expect(res.status).toBe(503);
  });

  it('returns 404 for unknown providers', async () => {
    const env = googleEnv();
    const res = await beginModule.onRequestGet({ request: makeRequest(), env, params: { provider: 'discord' } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('unknown_provider');
  });

  it('returns 503 when provider credentials are not configured', async () => {
    const env = { LAUNCH_PUBLIC: '1', ACCOUNTS_DB: makeD1(), RATE_KV: makeKv() };
    const res = await beginModule.onRequestGet({ request: makeRequest(), env, params: { provider: 'google' } });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('provider_not_configured');
  });

  it('happy path — 302 redirect with state in URL + KV', async () => {
    const env = googleEnv();
    const res = await beginModule.onRequestGet({ request: makeRequest(), env, params: { provider: 'google' } });
    expect(res.status).toBe(302);
    const loc = res.headers.get('Location');
    expect(loc).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
    const u = new URL(loc);
    const state = u.searchParams.get('state');
    expect(state).toBeTruthy();
    // KV entry was written
    expect(env.RATE_KV.put).toHaveBeenCalledWith(
      `oauth:state:${state}`,
      expect.any(String),
      expect.objectContaining({ expirationTtl: 600 }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// callback.js
// ─────────────────────────────────────────────────────────────────

describe('GET /api/auth/oauth/[provider]/callback', () => {
  beforeEach(() => {
    // Default fetch mock: Google token exchange + userinfo for a new user.
    globalThis.fetch = vi.fn(async (urlOrReq, init) => {
      const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
      if (u === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'at-google', token_type: 'Bearer' }), { status: 200 });
      }
      if (u === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return new Response(JSON.stringify({
          sub: 'google-user-42', email: 'new@example.com', email_verified: true, name: 'New User',
        }), { status: 200 });
      }
      if (u === 'https://github.com/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'at-gh', token_type: 'Bearer' }), { status: 200 });
      }
      if (u === 'https://api.github.com/user') {
        return new Response(JSON.stringify({ id: 9001, login: 'ghuser', name: 'GH User', email: null }), { status: 200 });
      }
      if (u === 'https://api.github.com/user/emails') {
        return new Response(JSON.stringify([
          { email: 'noreply@github.com', primary: false, verified: true },
          { email: 'gh@example.com', primary: true, verified: true },
        ]), { status: 200 });
      }
      return new Response('unstubbed: ' + u, { status: 599 });
    });
  });

  function callbackRequest({ provider = 'google', code = 'auth-code', state }) {
    return makeRequest({
      method: 'GET',
      url: `https://cloudcdn.pro/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`,
    });
  }

  it('returns 503 when LAUNCH_PUBLIC != 1', async () => {
    const env = googleEnv({ LAUNCH_PUBLIC: '0' });
    const res = await callbackModule.onRequestGet({
      request: callbackRequest({ state: 's' }), env, params: { provider: 'google' },
    });
    expect(res.status).toBe(503);
  });

  it('returns 400 invalid_state when state is missing from KV (CSRF / replay)', async () => {
    const env = googleEnv();
    const res = await callbackModule.onRequestGet({
      request: callbackRequest({ state: 'never-issued' }), env, params: { provider: 'google' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_state');
  });

  it('returns 400 when state was issued for a different provider', async () => {
    const env = googleEnv();
    const state = await oauth.issueState(env, 'github');
    const res = await callbackModule.onRequestGet({
      request: callbackRequest({ state, provider: 'google' }), env, params: { provider: 'google' },
    });
    expect(res.status).toBe(400);
  });

  it('redirects to /sign-up#oauth_error=... when provider returned an error', async () => {
    const env = googleEnv();
    const req = makeRequest({
      method: 'GET',
      url: 'https://cloudcdn.pro/api/auth/oauth/google/callback?error=access_denied',
    });
    const res = await callbackModule.onRequestGet({ request: req, env, params: { provider: 'google' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/sign-up#oauth_error=access_denied');
  });

  it('returns 400 when code or state is absent', async () => {
    const env = googleEnv();
    const req = makeRequest({
      method: 'GET',
      url: 'https://cloudcdn.pro/api/auth/oauth/google/callback',
    });
    const res = await callbackModule.onRequestGet({ request: req, env, params: { provider: 'google' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_callback');
  });

  it('Google happy path — new user → 302 to /onboarding with session + reveal cookies', async () => {
    const env = googleEnv({
      DASHBOARD_SECRET: 'reveal-secret', // for signRevealPayload
      ACCOUNTS_DB: makeD1({
        first: async () => null, // user not found → create new
      }),
    });
    const state = await oauth.issueState(env, 'google');
    const res = await callbackModule.onRequestGet({
      request: callbackRequest({ state }), env, params: { provider: 'google' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/onboarding');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('cdn_session=');
    expect(setCookie).toContain('cdn_signup_reveal=');
    expect(setCookie).toContain('cdn_logged_in=');
  });

  it('Google returning-user path — finds by oauth_identity → 302 to /dashboard/, no reveal cookie', async () => {
    let firstCallCount = 0;
    const env = googleEnv({
      DASHBOARD_SECRET: 'reveal-secret',
      ACCOUNTS_DB: makeD1({
        first: async () => {
          firstCallCount++;
          // 1st: oauth_identities lookup → found
          if (firstCallCount === 1) return { user_id: 'existing-user-id' };
          // 2nd: users lookup → returns the user
          if (firstCallCount === 2) return { id: 'existing-user-id', email: 'existing@example.com', name: 'X', email_verified_at: 1 };
          // 3rd: accounts lookup → returns the account
          return { id: 'a1', name: 'Existing', plan: 'free', monthly_cap_usd: 0 };
        },
      }),
    });
    const state = await oauth.issueState(env, 'google');
    const res = await callbackModule.onRequestGet({
      request: callbackRequest({ state }), env, params: { provider: 'google' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard/');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('cdn_session=');
    expect(setCookie).not.toContain('cdn_signup_reveal=');
  });

  it('GitHub happy path — fetches /user/emails to find primary verified email', async () => {
    const env = githubEnv({
      DASHBOARD_SECRET: 'reveal-secret',
      ACCOUNTS_DB: makeD1({ first: async () => null }),
    });
    const state = await oauth.issueState(env, 'github');
    const req = makeRequest({
      method: 'GET',
      url: `https://cloudcdn.pro/api/auth/oauth/github/callback?code=auth-code&state=${state}`,
    });
    const res = await callbackModule.onRequestGet({ request: req, env, params: { provider: 'github' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/onboarding');
    // Verify the /user/emails call happened (we tested the no-email branch path).
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.github.com/user/emails',
      expect.anything(),
    );
  });

  it('returns 502 provider_error when token exchange fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 }));
    const env = googleEnv();
    const state = await oauth.issueState(env, 'google');
    const res = await callbackModule.onRequestGet({
      request: callbackRequest({ state }), env, params: { provider: 'google' },
    });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('provider_error');
  });

  it('returns 400 no_email when the provider does not return an email', async () => {
    globalThis.fetch = vi.fn(async (urlOrReq) => {
      const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
      if (u === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
      }
      if (u === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return new Response(JSON.stringify({ sub: 'g42', name: 'NoEmail User' }), { status: 200 });
      }
      return new Response('?', { status: 599 });
    });
    const env = googleEnv();
    const state = await oauth.issueState(env, 'google');
    const res = await callbackModule.onRequestGet({
      request: callbackRequest({ state }), env, params: { provider: 'google' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('no_email');
  });

  it('Apple POST callback (form_post) is accepted', async () => {
    // Mock just enough of the Apple token + id_token flow.
    const idTokenPayload = btoa(JSON.stringify({
      sub: 'apple-user-1', email: 'apple@example.com', email_verified: true,
    })).replace(/=/g, '');
    const idToken = `header.${idTokenPayload}.sig`;
    globalThis.fetch = vi.fn(async (urlOrReq) => {
      const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
      if (u === 'https://appleid.apple.com/auth/token') {
        return new Response(JSON.stringify({ access_token: 'a', id_token: idToken }), { status: 200 });
      }
      return new Response('?', { status: 599 });
    });

    // Apple is fiddly to fully mock because mintAppleClientSecret tries
    // to import the PKCS8 private key. Provide a real (test) P-256 key
    // via Web Crypto so the signing path succeeds.
    const { privateKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'],
    );
    const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
    const pemBody = btoa(String.fromCharCode(...new Uint8Array(exported)));
    const pem = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----`;

    const env = {
      LAUNCH_PUBLIC: '1',
      DASHBOARD_SECRET: 'reveal-secret',
      APPLE_OAUTH_CLIENT_ID: 'com.example.cloudcdn',
      APPLE_OAUTH_TEAM_ID: 'TEAM',
      APPLE_OAUTH_KEY_ID: 'KEY',
      APPLE_OAUTH_PRIVATE_KEY: pem,
      ACCOUNTS_DB: makeD1({ first: async () => null }),
      RATE_KV: makeKv(),
    };
    const state = await oauth.issueState(env, 'apple');

    const req = makeRequest({
      method: 'POST',
      url: 'https://cloudcdn.pro/api/auth/oauth/apple/callback',
      body: { code: 'auth-code', state },
    });
    const res = await callbackModule.onRequestPost({ request: req, env, params: { provider: 'apple' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/onboarding');
  });
});

// ─────────────────────────────────────────────────────────────────
// findOrCreateUserFromOAuth — branches
// ─────────────────────────────────────────────────────────────────

describe('findOrCreateUserFromOAuth', () => {
  it('throws when no email is provided (we require a recoverable channel)', async () => {
    const env = { ACCOUNTS_DB: makeD1() };
    await expect(oauth.findOrCreateUserFromOAuth(env, {
      provider: 'github', providerUserId: '9001', email: null, name: 'x',
    })).rejects.toThrow(/no email/);
  });

  it('links a new oauth_identity to an existing email-matched user', async () => {
    let n = 0;
    const env = {
      ACCOUNTS_DB: makeD1({
        first: async () => {
          n++;
          if (n === 1) return null; // oauth_identities lookup → none
          if (n === 2) return { id: 'u1', email: 'same@ex.com', name: 'Same', email_verified_at: 1 };
          if (n === 3) return { id: 'a1', name: 'A', plan: 'free', monthly_cap_usd: 0 };
          return null;
        },
      }),
    };
    const r = await oauth.findOrCreateUserFromOAuth(env, {
      provider: 'github', providerUserId: '9001', email: 'same@ex.com', name: 'Same',
    });
    expect(r.created).toBe(false);
    expect(r.user.id).toBe('u1');
    expect(r.account.id).toBe('a1');
  });

  it('creates everything from scratch when no match is found', async () => {
    const env = { ACCOUNTS_DB: makeD1({ first: async () => null }) };
    const r = await oauth.findOrCreateUserFromOAuth(env, {
      provider: 'google', providerUserId: 'g42', email: 'brand-new@ex.com', name: 'Brand New',
    });
    expect(r.created).toBe(true);
    expect(r.user.email).toBe('brand-new@ex.com');
    expect(r.account.plan).toBe('free');
  });
});
