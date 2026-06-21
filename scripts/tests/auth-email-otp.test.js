/**
 * Tests for the email OTP endpoints:
 *   POST /api/auth/email/otp/send
 *   POST /api/auth/email/otp/verify
 *
 * Resend HTTPS calls are mocked via globalThis.fetch; D1 is mocked
 * via the standard chain pattern.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const lib = await import('../../functions/api/auth/_lib.js');
const emailLib = await import('../../functions/api/auth/_email.js');
const sendModule = await import('../../functions/api/auth/email/otp/send.js');
const verifyModule = await import('../../functions/api/auth/email/otp/verify.js');

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
afterEach(() => { globalThis.fetch = originalFetch; console.log = originalConsoleLog; vi.restoreAllMocks(); });

function makeD1({ first = async () => null, batch = async () => [] } = {}) {
  const bind = vi.fn(() => ({
    first: vi.fn(first),
    run: vi.fn().mockResolvedValue({ success: true }),
  }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, batch: vi.fn(batch) };
}
function makeKv() {
  const store = new Map();
  return {
    get: vi.fn(async (k) => store.get(k) || null),
    put: vi.fn(async (k, v) => { store.set(k, v); }),
    delete: vi.fn(async (k) => { store.delete(k); }),
  };
}
function makeRequest({ body, ip = '203.0.113.1' } = {}) {
  const headers = new Headers();
  headers.set('cf-connecting-ip', ip);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return {
    method: 'POST',
    url: 'https://cloudcdn.pro/api/auth/email/otp/send',
    headers,
    json: async () => body,
  };
}
function freshEnv(overrides = {}) {
  return {
    STRICT_AUTH: '1',
    ACCOUNTS_DB: makeD1(),
    RATE_KV: makeKv(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// _email.js
// ─────────────────────────────────────────────────────────────────

describe('sendTransactionalEmail', () => {
  it('throws when required fields are missing', async () => {
    await expect(emailLib.sendTransactionalEmail({}, { to: '', subject: 's', text: 't' })).rejects.toThrow();
    await expect(emailLib.sendTransactionalEmail({}, { to: 'a@b.com', subject: '', text: 't' })).rejects.toThrow();
    await expect(emailLib.sendTransactionalEmail({}, { to: 'a@b.com', subject: 's' })).rejects.toThrow();
  });

  it('returns {sent:false, error} when STRICT_AUTH=1 and no RESEND_API_KEY', async () => {
    const r = await emailLib.sendTransactionalEmail({ STRICT_AUTH: '1' }, {
      to: 'a@b.com', subject: 's', text: 't',
    });
    expect(r).toEqual({ sent: false, error: expect.stringContaining('RESEND_API_KEY') });
  });

  it('POSTs to resend.com with Bearer auth + returns id on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 're_abc' }), { status: 200 }));
    const r = await emailLib.sendTransactionalEmail({ RESEND_API_KEY: 'k', RESEND_FROM: 'From <f@x>' }, {
      to: 'a@b.com', subject: 'Hi', html: '<b>hi</b>', text: 'hi',
    });
    expect(r.sent).toBe(true);
    expect(r.id).toBe('re_abc');
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer k');
    const sent = JSON.parse(init.body);
    expect(sent.from).toBe('From <f@x>');
    expect(sent.to).toEqual(['a@b.com']);
    expect(sent.html).toBe('<b>hi</b>');
  });

  it('returns {sent:false, status} on non-2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('quota', { status: 429 }));
    const r = await emailLib.sendTransactionalEmail({ RESEND_API_KEY: 'k' }, {
      to: 'a@b.com', subject: 's', text: 't',
    });
    expect(r.sent).toBe(false);
    expect(r.status).toBe(429);
    expect(r.error).toContain('quota');
  });

  it('returns {sent:false, error: network} when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('socket reset'));
    const r = await emailLib.sendTransactionalEmail({ RESEND_API_KEY: 'k' }, {
      to: 'a@b.com', subject: 's', text: 't',
    });
    expect(r.sent).toBe(false);
    expect(r.error).toContain('network');
  });

  it('accepts to as an array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 're' }), { status: 200 }));
    await emailLib.sendTransactionalEmail({ RESEND_API_KEY: 'k' }, {
      to: ['a@b.com', 'c@d.com'], subject: 's', text: 't',
    });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).to).toEqual(['a@b.com', 'c@d.com']);
  });
});

describe('buildOtpEmail', () => {
  it('returns subject + html + text containing the code', () => {
    const { subject, html, text } = emailLib.buildOtpEmail({ code: '123456', ttlMinutes: 10 });
    expect(subject).toContain('123456');
    expect(html).toContain('123456');
    expect(text).toContain('123456');
    expect(text).toContain('10 minutes');
  });

  it('escapes HTML special characters in the rendered code', () => {
    const { html } = emailLib.buildOtpEmail({ code: '<img>' });
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<img>');
  });

  it('defaults ttlMinutes to 10', () => {
    const { text } = emailLib.buildOtpEmail({ code: '111111' });
    expect(text).toContain('10 minutes');
  });
});

// ─────────────────────────────────────────────────────────────────
// /api/auth/email/otp/send
// ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/email/otp/send', () => {
  beforeEach(() => {
    // Default fetch mock — Resend success.
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 're_x' }), { status: 200 }));
  });

  it('OPTIONS returns 204', async () => {
    expect((await sendModule.onRequestOptions()).status).toBe(204);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const env = freshEnv({ ACCOUNTS_DB: undefined });
    const res = await sendModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com' } }), env });
    expect(res.status).toBe(503);
  });

  it('returns 400 on bad JSON', async () => {
    const env = freshEnv();
    const req = makeRequest();
    req.json = async () => { throw new Error('boom'); };
    const res = await sendModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid email', async () => {
    const env = freshEnv();
    const res = await sendModule.onRequestPost({ request: makeRequest({ body: { email: 'not-an-email' } }), env });
    expect(res.status).toBe(400);
  });

  it('happy path — 200 with expiresInSeconds + inserts D1 row', async () => {
    const env = freshEnv({ RESEND_API_KEY: 'k' });
    const res = await sendModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com' } }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(true);
    expect(body.expiresInSeconds).toBe(600);
    expect(env.ACCOUNTS_DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO email_verifications')
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.anything(),
    );
  });

  it('returns 429 when per-IP rate-limit trips', async () => {
    const env = freshEnv({
      RATE_KV: { get: vi.fn().mockResolvedValue('999'), put: vi.fn() },
    });
    const res = await sendModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com' } }), env });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
  });

  it('returns 500 internal when D1 insert fails', async () => {
    const env = freshEnv({
      RESEND_API_KEY: 'k',
      ACCOUNTS_DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ run: vi.fn().mockRejectedValue(new Error('d1')) })),
        })),
      },
    });
    const res = await sendModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com' } }), env });
    expect(res.status).toBe(500);
  });

  it('returns 200 even if Resend errors (account-enumeration defence)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('quota', { status: 429 }));
    const env = freshEnv({ RESEND_API_KEY: 'k' });
    const res = await sendModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com' } }), env });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────
// /api/auth/email/otp/verify
// ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/email/otp/verify', () => {
  it('OPTIONS returns 204', async () => {
    expect((await verifyModule.onRequestOptions()).status).toBe(204);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const env = freshEnv({ ACCOUNTS_DB: undefined });
    const res = await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: '123456' } }), env });
    expect(res.status).toBe(503);
  });

  it('returns 400 on bad JSON', async () => {
    const env = freshEnv();
    const req = makeRequest();
    req.json = async () => { throw new Error('boom'); };
    const res = await verifyModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('returns 400 invalid_input on bad email or non-6-digit code', async () => {
    const env = freshEnv();
    expect((await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'x', code: '123456' } }), env })).status).toBe(400);
    expect((await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: '12' } }), env })).status).toBe(400);
    expect((await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: 'abcdef' } }), env })).status).toBe(400);
  });

  it('returns 429 when per-IP rate-limit trips', async () => {
    const env = freshEnv({
      RATE_KV: { get: vi.fn().mockResolvedValue('999'), put: vi.fn() },
    });
    const res = await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: '123456' } }), env });
    expect(res.status).toBe(429);
  });

  it('returns 400 invalid_code when no matching row exists', async () => {
    const env = freshEnv({ ACCOUNTS_DB: makeD1({ first: async () => null }) });
    const res = await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: '123456' } }), env });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_code');
  });

  it('returns 400 when the row has already been consumed', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          id: 'r1', code_hash: 'h', attempts: 0,
          expires_at: Math.floor(Date.now() / 1000) + 100,
          consumed_at: 12345,
        }),
      }),
    });
    const res = await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: '123456' } }), env });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the row has expired', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          id: 'r1', code_hash: 'h', attempts: 0,
          expires_at: Math.floor(Date.now() / 1000) - 1,
          consumed_at: null,
        }),
      }),
    });
    const res = await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: '123456' } }), env });
    expect(res.status).toBe(400);
  });

  it('returns 400 when attempts have been exhausted', async () => {
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          id: 'r1', code_hash: 'h', attempts: 5,
          expires_at: Math.floor(Date.now() / 1000) + 100,
          consumed_at: null,
        }),
      }),
    });
    const res = await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: '123456' } }), env });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the code is wrong; bumps attempts counter', async () => {
    const updateCalls = [];
    const env = freshEnv({
      ACCOUNTS_DB: {
        prepare: vi.fn((sql) => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => ({
              id: 'r1', code_hash: 'definitely-not-the-right-hash', attempts: 0,
              expires_at: Math.floor(Date.now() / 1000) + 100,
              consumed_at: null,
            })),
            run: vi.fn(async () => {
              if (sql.includes('attempts = attempts + 1')) updateCalls.push(true);
              return { success: true };
            }),
          })),
        })),
        batch: vi.fn(),
      },
    });
    const res = await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: '123456' } }), env });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_code');
    expect(updateCalls.length).toBe(1);
  });

  it('happy path — 200 + marks row consumed + updates users.email_verified_at', async () => {
    // Compute the expected hash so the row matches.
    const correctCode = '654321';
    const correctHash = await lib.sha256Hex(`a@b.com:${correctCode}`);
    const env = freshEnv({
      ACCOUNTS_DB: makeD1({
        first: async () => ({
          id: 'r1', code_hash: correctHash, attempts: 0,
          expires_at: Math.floor(Date.now() / 1000) + 100,
          consumed_at: null,
        }),
      }),
    });
    const res = await verifyModule.onRequestPost({ request: makeRequest({ body: { email: 'a@b.com', code: correctCode } }), env });
    expect(res.status).toBe(200);
    expect((await res.json()).verified).toBe(true);
    expect(env.ACCOUNTS_DB.batch).toHaveBeenCalledOnce();
  });
});
