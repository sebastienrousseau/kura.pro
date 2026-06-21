/**
 * Unit tests for functions/api/auth/_lib.js — the pure helpers used by
 * every auth endpoint. D1, Turnstile, and the auth-hasher Worker are
 * tested separately via the endpoint integration tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const lib = await import('../../functions/api/auth/_lib.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('uuid + sha256Hex + token generators', () => {
  it('uuid returns a v4-shaped string', () => {
    const id = lib.uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sha256Hex matches the known digest for an empty string', async () => {
    expect(await lib.sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('sha256Hex returns 64 hex chars for any input', async () => {
    const h = await lib.sha256Hex('hello world');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateSessionToken returns a 48-char base62 string', () => {
    const t = lib.generateSessionToken();
    expect(t).toHaveLength(48);
    expect(t).toMatch(/^[0-9A-Za-z]{48}$/);
  });

  it('generateApiKey returns a prefix, body, and full key in the expected shape', () => {
    const k = lib.generateApiKey();
    expect(k.prefix).toMatch(/^cdn_test_[0-9A-Za-z]{8}$/);
    expect(k.body).toMatch(/^[0-9A-Za-z]{40}$/);
    expect(k.fullKey).toBe(`${k.prefix}_${k.body}`);
  });

  it('two generated session tokens are different', () => {
    expect(lib.generateSessionToken()).not.toBe(lib.generateSessionToken());
  });
});

describe('parseCookies', () => {
  it('returns {} when header is missing or empty', () => {
    expect(lib.parseCookies(null)).toEqual({});
    expect(lib.parseCookies('')).toEqual({});
  });

  it('parses a single cookie', () => {
    expect(lib.parseCookies('cdn_session=abc')).toEqual({ cdn_session: 'abc' });
  });

  it('parses multiple cookies with whitespace tolerance', () => {
    expect(lib.parseCookies('a=1;  b=2 ;c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('skips malformed entries without an =', () => {
    expect(lib.parseCookies('foo;bar=baz')).toEqual({ bar: 'baz' });
  });
});

describe('sessionCookieHeader + clearedSessionCookieHeader', () => {
  it('sessionCookieHeader has the expected flags', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const header = lib.sessionCookieHeader('tok123', exp);
    expect(header).toMatch(/^cdn_session=tok123/);
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toMatch(/Max-Age=\d+/);
  });

  it('clearedSessionCookieHeader sets Max-Age=0 and empty value', () => {
    const h = lib.clearedSessionCookieHeader();
    expect(h).toMatch(/^cdn_session=;/);
    expect(h).toContain('Max-Age=0');
  });
});

describe('isDisposableEmail', () => {
  it.each([
    ['user@mailinator.com', true],
    ['someone@10minutemail.com', true],
    ['legit@gmail.com', false],
    ['admin@cloudcdn.pro', false],
    ['malformed', false],
  ])('isDisposableEmail(%s) === %s', (input, expected) => {
    expect(lib.isDisposableEmail(input)).toBe(expected);
  });
});

describe('scoreSignupAttempt', () => {
  const baseReq = { cf: { threatScore: 0, asn: 12345 } };

  it('returns 0 for a clean request', () => {
    const s = lib.scoreSignupAttempt({ request: baseReq, email: 'a@gmail.com', elapsedMs: 5000, honeypot: '' });
    expect(s.score).toBe(0);
    expect(s.reasons).toHaveLength(0);
  });

  it('penalises a filled honeypot heavily', () => {
    const s = lib.scoreSignupAttempt({ request: baseReq, email: 'a@gmail.com', elapsedMs: 5000, honeypot: 'spammers-only' });
    expect(s.score).toBeGreaterThanOrEqual(100);
    expect(s.reasons).toContain('honeypot_filled');
  });

  it('penalises a submission faster than 1.5s', () => {
    const s = lib.scoreSignupAttempt({ request: baseReq, email: 'a@gmail.com', elapsedMs: 500, honeypot: '' });
    expect(s.score).toBeGreaterThanOrEqual(50);
    expect(s.reasons).toContain('submitted_too_fast');
  });

  it('penalises a disposable email', () => {
    const s = lib.scoreSignupAttempt({ request: baseReq, email: 'tmp@mailinator.com', elapsedMs: 5000, honeypot: '' });
    expect(s.score).toBeGreaterThanOrEqual(40);
    expect(s.reasons).toContain('disposable_email');
  });

  it('penalises a high cf.threatScore', () => {
    const s = lib.scoreSignupAttempt({
      request: { cf: { threatScore: 80, asn: 12345 } },
      email: 'a@gmail.com', elapsedMs: 5000, honeypot: '',
    });
    expect(s.reasons.some((r) => r.startsWith('high_threat_score'))).toBe(true);
  });

  it('softly flags a known hosting ASN', () => {
    const s = lib.scoreSignupAttempt({
      request: { cf: { threatScore: 0, asn: 14061 } }, // DigitalOcean
      email: 'a@gmail.com', elapsedMs: 5000, honeypot: '',
    });
    expect(s.reasons.some((r) => r.startsWith('hosting_asn'))).toBe(true);
  });
});

describe('verifyTurnstile', () => {
  it('fails closed when STRICT_AUTH=1 and no secret is configured', async () => {
    const ok = await lib.verifyTurnstile({ STRICT_AUTH: '1' }, 'tok', '1.2.3.4');
    expect(ok).toBe(false);
  });

  it('fails open in non-strict mode without a secret (dev convenience)', async () => {
    const ok = await lib.verifyTurnstile({}, 'tok', '1.2.3.4');
    expect(ok).toBe(true);
  });

  it('rejects an empty token when a secret IS configured', async () => {
    const ok = await lib.verifyTurnstile({ TURNSTILE_SECRET_KEY: 'sk' }, '', '1.2.3.4');
    expect(ok).toBe(false);
  });

  it('POSTs to siteverify and returns success=true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ok = await lib.verifyTurnstile({ TURNSTILE_SECRET_KEY: 'sk' }, 'tok-from-widget', '1.2.3.4');
    expect(ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('returns false when siteverify returns success=false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 })
    );
    expect(await lib.verifyTurnstile({ TURNSTILE_SECRET_KEY: 'sk' }, 'tok', '1.2.3.4')).toBe(false);
  });

  it('returns false when fetch itself rejects (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    expect(await lib.verifyTurnstile({ TURNSTILE_SECRET_KEY: 'sk' }, 'tok', '1.2.3.4')).toBe(false);
  });
});

describe('isPasswordPwned', () => {
  it('fails open (pwned=false, checked=false) when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const r = await lib.isPasswordPwned('correct-horse-battery-staple');
    expect(r.pwned).toBe(false);
    expect(r.checked).toBe(false);
  });

  it('finds a matching suffix in the HIBP range response', async () => {
    // "password" → SHA-1 = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // First 5 = 5BAA6, suffix = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9999999\nOTHER:1',
        { status: 200 }
      )
    );
    const r = await lib.isPasswordPwned('password');
    expect(r.pwned).toBe(true);
    expect(r.count).toBe(9999999);
    expect(r.checked).toBe(true);
  });

  it('returns pwned=false when no suffix matches', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('NOMATCH1:1\nNOMATCH2:2', { status: 200 })
    );
    const r = await lib.isPasswordPwned('a-rare-password-no-one-has-ever-used-2026');
    expect(r.pwned).toBe(false);
    expect(r.checked).toBe(true);
  });
});

describe('getDB / hasAccountsDB', () => {
  it('hasAccountsDB returns false without binding', () => {
    expect(lib.hasAccountsDB(undefined)).toBe(false);
    expect(lib.hasAccountsDB({})).toBe(false);
    expect(lib.hasAccountsDB({ ACCOUNTS_DB: {} })).toBe(true);
  });

  it('getDB throws when ACCOUNTS_DB is missing', () => {
    expect(() => lib.getDB({})).toThrow(/ACCOUNTS_DB binding missing/);
  });
});

describe('hashPassword / verifyPassword — binding + transport errors', () => {
  it('hashPassword throws when AUTH_HASHER binding is missing', async () => {
    await expect(lib.hashPassword({}, 'pw')).rejects.toThrow(/AUTH_HASHER binding missing/);
    await expect(lib.hashPassword(undefined, 'pw')).rejects.toThrow(/AUTH_HASHER binding missing/);
  });

  it('hashPassword throws on non-2xx response from the hasher', async () => {
    const env = { AUTH_HASHER: { fetch: vi.fn().mockResolvedValue(new Response('err', { status: 500 })) } };
    await expect(lib.hashPassword(env, 'pw')).rejects.toThrow(/auth-hasher \/hash failed/);
  });

  it('verifyPassword throws when AUTH_HASHER binding is missing', async () => {
    await expect(lib.verifyPassword({}, 'pw', '$argon2id$x')).rejects.toThrow(/AUTH_HASHER binding missing/);
  });

  it('verifyPassword returns false on non-2xx response from the hasher', async () => {
    const env = { AUTH_HASHER: { fetch: vi.fn().mockResolvedValue(new Response('err', { status: 500 })) } };
    expect(await lib.verifyPassword(env, 'pw', '$argon2id$x')).toBe(false);
  });
});

describe('revokeSession', () => {
  it('writes revoked_at = now to the sessions row', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { ACCOUNTS_DB: { prepare } };
    await lib.revokeSession(env, 'sha-hash-here');
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE sessions SET revoked_at'));
    expect(bind).toHaveBeenCalledWith(expect.any(Number), 'sha-hash-here');
    expect(run).toHaveBeenCalled();
  });
});

describe('auditEvent — D1 + legacy KV dual-write', () => {
  it('does nothing when ACCOUNTS_DB is absent (gracefully)', async () => {
    await expect(lib.auditEvent({}, { action: 'noop' })).resolves.toBeUndefined();
  });

  it('inserts a row when D1 is present, then mirrors to legacy log', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { ACCOUNTS_DB: { prepare }, RATE_KV: { get: vi.fn(), put: vi.fn() } };
    const request = { headers: new Headers({ 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'vt', 'x-trace-id': 't' }) };
    await lib.auditEvent(env, { accountId: 'a1', userId: 'u1', action: 'user.signup', request, meta: { x: 1 } });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_events'));
  });

  it('swallows D1 errors so a logging failure does not break the caller', async () => {
    const bind = vi.fn(() => ({ run: vi.fn().mockRejectedValue(new Error('d1 down')) }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { ACCOUNTS_DB: { prepare } };
    await expect(lib.auditEvent(env, { action: 'x' })).resolves.toBeUndefined();
  });
});

describe('recordSignupAttempt', () => {
  it('no-ops when D1 is absent', async () => {
    await expect(lib.recordSignupAttempt({}, { outcome: 'success' })).resolves.toBeUndefined();
  });

  it('inserts a row when D1 is present', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { ACCOUNTS_DB: { prepare } };
    await lib.recordSignupAttempt(env, { email: 'a@b.com', ip: '1.2.3.4', outcome: 'success', score: 0, meta: { reasons: [] } });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO signup_attempts'));
  });

  it('swallows D1 errors so attempt-logging cannot break signup', async () => {
    const bind = vi.fn(() => ({ run: vi.fn().mockRejectedValue(new Error('d1 down')) }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { ACCOUNTS_DB: { prepare } };
    await expect(lib.recordSignupAttempt(env, { outcome: 'success' })).resolves.toBeUndefined();
  });
});

describe('mintSession + createApiKey + getCurrentSession', () => {
  it('mintSession inserts and returns a token + expiresAt', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { ACCOUNTS_DB: { prepare } };
    const r = await lib.mintSession(env, { userId: 'u1', accountId: 'a1', ip: '1.2.3.4', userAgent: 'ua' });
    expect(r.token).toMatch(/^[0-9A-Za-z]{48}$/);
    expect(r.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sessions'));
  });

  it('createApiKey returns a key with cdn_test_ prefix and inserts a row', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { ACCOUNTS_DB: { prepare } };
    const k = await lib.createApiKey(env, { accountId: 'a1', userId: 'u1' });
    expect(k.prefix).toMatch(/^cdn_test_[0-9A-Za-z]{8}$/);
    expect(k.fullKey).toMatch(/^cdn_test_[0-9A-Za-z]{8}_[0-9A-Za-z]{40}$/);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO api_keys'));
  });

  it('getCurrentSession returns null without ACCOUNTS_DB', async () => {
    const req = { headers: new Headers({ cookie: 'cdn_session=anything' }) };
    expect(await lib.getCurrentSession({}, req)).toBeNull();
  });

  it('getCurrentSession returns null without a cookie', async () => {
    const env = { ACCOUNTS_DB: { prepare: vi.fn() } };
    const req = { headers: new Headers() };
    expect(await lib.getCurrentSession(env, req)).toBeNull();
  });

  it('getCurrentSession returns null when the row was revoked', async () => {
    const env = {
      ACCOUNTS_DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue({
              token_hash: 'h', user_id: 'u1', account_id: 'a1',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              revoked_at: 1000, // truthy = revoked
              email: 'x@y.com', name: null, email_verified_at: null,
              account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null,
            }),
            run: vi.fn(),
          })),
        })),
      },
    };
    const req = { headers: new Headers({ cookie: 'cdn_session=t' }) };
    expect(await lib.getCurrentSession(env, req)).toBeNull();
  });
});
