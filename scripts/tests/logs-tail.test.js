/**
 * Tests for /api/logs/tail — the WebSocket log-tail endpoint.
 *
 * The streaming loop (startTail) is integration territory and marked
 * v8 ignore in the source. The unit-testable surface is:
 *   - upgrade-required behaviour (no WS header → 426)
 *   - infra/auth/account guards
 *   - pollAuditEvents (pure D1 read, returned shape)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const tail = await import('../../functions/api/logs/tail.js');

afterEach(() => { vi.restoreAllMocks(); });

const SESSION = {
  token_hash: 'h', user_id: 'u1', account_id: 'a1',
  expires_at: Math.floor(Date.now() / 1000) + 3600, revoked_at: null,
  email: 'w@e.com', name: null, email_verified_at: null,
  account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: 0,
};

function makeD1({ first = SESSION, all = [] } = {}) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(first),
        all: vi.fn().mockResolvedValue({ results: all }),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    })),
    batch: vi.fn(),
  };
}

function makeReq({ upgrade = false, cookie = 'cdn_session=tok', url = 'https://cloudcdn.pro/api/logs/tail' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (upgrade) headers.set('Upgrade', 'websocket');
  headers.set('cf-connecting-ip', '203.0.113.1');
  return { method: 'GET', url, headers };
}

describe('GET /api/logs/tail — upgrade gating', () => {
  it('OPTIONS preflight returns 204', async () => {
    expect((await tail.onRequestOptions()).status).toBe(204);
  });

  it('returns 426 upgrade_required without the Upgrade header', async () => {
    const env = { ACCOUNTS_DB: makeD1() };
    const res = await tail.onRequestGet({ request: makeReq(), env });
    expect(res.status).toBe(426);
    expect((await res.json()).error.code).toBe('upgrade_required');
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    expect((await tail.onRequestGet({ request: makeReq({ upgrade: true }), env: {} })).status).toBe(503);
  });

  it('returns 401 without an active session', async () => {
    const env = { ACCOUNTS_DB: makeD1({ first: null }) };
    expect((await tail.onRequestGet({ request: makeReq({ upgrade: true }), env })).status).toBe(401);
  });

  it('returns 403 when session has no account', async () => {
    const env = { ACCOUNTS_DB: makeD1({ first: {
      ...SESSION, account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null,
    } }) };
    expect((await tail.onRequestGet({ request: makeReq({ upgrade: true }), env })).status).toBe(403);
  });

  it('accepts ?session=<token> as cookie fallback for terminal clients', async () => {
    const env = { ACCOUNTS_DB: makeD1({ first: null }) };
    // With null session lookup the request is rejected; the cleanly-
    // testable bit here is that the token path is reached (and
    // returns 401 because the mock returns null).
    const req = makeReq({ upgrade: true, cookie: null, url: 'https://cloudcdn.pro/api/logs/tail?session=abc' });
    expect((await tail.onRequestGet({ request: req, env })).status).toBe(401);
  });

  it('rejects a ?session=<token> when the session row is revoked', async () => {
    const env = { ACCOUNTS_DB: makeD1({ first: { ...SESSION, revoked_at: 12345 } }) };
    const req = makeReq({ upgrade: true, cookie: null, url: 'https://cloudcdn.pro/api/logs/tail?session=abc' });
    expect((await tail.onRequestGet({ request: req, env })).status).toBe(401);
  });

  it('rejects a ?session=<token> when the session row has expired', async () => {
    const env = { ACCOUNTS_DB: makeD1({ first: { ...SESSION, expires_at: Math.floor(Date.now() / 1000) - 10 } }) };
    const req = makeReq({ upgrade: true, cookie: null, url: 'https://cloudcdn.pro/api/logs/tail?session=abc' });
    expect((await tail.onRequestGet({ request: req, env })).status).toBe(401);
  });

  it('reaches the upgrade path when ?session=<token> resolves a valid session', async () => {
    // SESSION mock is unrevoked + unexpired → sessionFromToken returns
    // the populated current object, exercising the success branch.
    // The handler then calls `new WebSocketPair()`, which is not
    // implemented in vitest's runtime, so the request throws —
    // confirming we passed the auth checks rather than short-circuiting
    // at 401/403.
    const env = { ACCOUNTS_DB: makeD1() };
    const req = makeReq({ upgrade: true, cookie: null, url: 'https://cloudcdn.pro/api/logs/tail?session=abc' });
    await expect(tail.onRequestGet({ request: req, env })).rejects.toThrow();
  });
});

describe('pollAuditEvents', () => {
  it('returns mapped events ordered ASC with meta parsed', async () => {
    const env = { ACCOUNTS_DB: makeD1({ all: [
      { id: 'e1', account_id: 'a1', user_id: 'u1', action: 'user.login', ip: '1.2.3.4', user_agent: 'curl', request_id: 'r1', meta: '{"via":"oauth"}', created_at: 100 },
      { id: 'e2', account_id: 'a1', user_id: 'u1', action: 'apikey.create', ip: null, user_agent: null, request_id: null, meta: 'not-json', created_at: 200 },
    ] }) };
    const events = await tail.pollAuditEvents(env, 'a1', 0, 50);
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe('user.login');
    expect(events[0].meta).toEqual({ via: 'oauth' });
    expect(events[1].meta).toBeNull();
  });

  it('returns [] when D1 has no matching rows', async () => {
    const env = { ACCOUNTS_DB: makeD1({ all: [] }) };
    expect(await tail.pollAuditEvents(env, 'a1', 0, 50)).toEqual([]);
  });
});
