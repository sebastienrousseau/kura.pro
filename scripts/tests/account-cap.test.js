/**
 * Tests for the bill-predictability surface:
 *   GET   /api/account/cap     — read current cap
 *   PATCH /api/account/cap     — set cap
 *   functions/api/account/_quota.js  — enforcement helpers
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const capModule = await import('../../functions/api/account/cap.js');
const quotaModule = await import('../../functions/api/account/_quota.js');

afterEach(() => { vi.restoreAllMocks(); });

function makeD1({ firstSeq = [], runImpl } = {}) {
  let n = 0;
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => firstSeq[n++] ?? null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn(runImpl || (async () => ({ success: true }))),
      })),
    })),
    batch: vi.fn(),
  };
}

function makeReq({ method = 'GET', body, cookie = 'cdn_session=tok' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('cf-connecting-ip', '203.0.113.1');
  headers.set('user-agent', 'vitest');
  return { method, url: 'https://cloudcdn.pro/api/account/cap', headers, json: async () => body };
}

const SESSION_WITH_ACCOUNT = (cap = 0) => ({
  token_hash: 'h', user_id: 'u1', account_id: 'a1',
  expires_at: Math.floor(Date.now() / 1000) + 3600, revoked_at: null,
  email: 'w@e.com', name: null, email_verified_at: null,
  account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: cap,
});

// ── _quota helpers ──────────────────────────────────────────────

describe('currentBillingPeriod + secondsUntilNextMonth', () => {
  it('formats current month as YYYY-MM', () => {
    const period = quotaModule.currentBillingPeriod(Date.UTC(2026, 5, 15));
    expect(period).toBe('2026-06');
  });

  it('handles single-digit months with zero-padding', () => {
    expect(quotaModule.currentBillingPeriod(Date.UTC(2026, 0, 1))).toBe('2026-01');
    expect(quotaModule.currentBillingPeriod(Date.UTC(2026, 8, 15))).toBe('2026-09');
  });

  it('secondsUntilNextMonth counts down to next UTC 1st', () => {
    // 2026-06-15 00:00:00 UTC → 2026-07-01 00:00:00 UTC is 16 days.
    const s = quotaModule.secondsUntilNextMonth(Date.UTC(2026, 5, 15));
    expect(s).toBe(16 * 86400);
  });
});

describe('currentMonthUsageUsd', () => {
  it('returns 0 with no env or accountId', async () => {
    expect(await quotaModule.currentMonthUsageUsd(null, 'a1')).toBe(0);
    expect(await quotaModule.currentMonthUsageUsd({}, '')).toBe(0);
  });

  it('returns cached value from RATE_KV when present', async () => {
    const env = { RATE_KV: { get: vi.fn().mockResolvedValue('12.5'), put: vi.fn() } };
    expect(await quotaModule.currentMonthUsageUsd(env, 'a1')).toBe(12.5);
  });

  it('returns 0 when RATE_KV is empty and no AE token configured', async () => {
    const env = { RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } };
    expect(await quotaModule.currentMonthUsageUsd(env, 'a1')).toBe(0);
  });

  it('returns 0 when RATE_KV throws (fall-open)', async () => {
    const env = { RATE_KV: { get: vi.fn().mockRejectedValue(new Error('down')) } };
    expect(await quotaModule.currentMonthUsageUsd(env, 'a1')).toBe(0);
  });
});

describe('buildCapResponse + enforceCap', () => {
  it('returns null when account has no id', async () => {
    expect(await quotaModule.enforceCap({}, null)).toBeNull();
    expect(await quotaModule.enforceCap({}, {})).toBeNull();
  });

  it('returns null when cap is NaN', async () => {
    expect(await quotaModule.enforceCap({}, { id: 'a1', monthlyCapUsd: 'oops' })).toBeNull();
  });

  it('returns null when cap is 0 AND usage is 0 (degrade-only, no usage yet)', async () => {
    const env = { RATE_KV: { get: vi.fn().mockResolvedValue('0') } };
    expect(await quotaModule.enforceCap(env, { id: 'a1', monthlyCapUsd: 0 })).toBeNull();
  });

  it('returns 402 when cap is 0 AND usage > 0 (degrade-only, any spend triggers)', async () => {
    const env = { RATE_KV: { get: vi.fn().mockResolvedValue('0.01') } };
    const res = await quotaModule.enforceCap(env, { id: 'a1', monthlyCapUsd: 0 });
    expect(res).not.toBeNull();
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('spend_cap_reached');
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  it('returns null when cap > 0 AND usage < cap', async () => {
    const env = { RATE_KV: { get: vi.fn().mockResolvedValue('5') } };
    expect(await quotaModule.enforceCap(env, { id: 'a1', monthlyCapUsd: 10 })).toBeNull();
  });

  it('returns 402 when cap > 0 AND usage >= cap', async () => {
    const env = { RATE_KV: { get: vi.fn().mockResolvedValue('10') } };
    const res = await quotaModule.enforceCap(env, { id: 'a1', monthlyCapUsd: 10 });
    expect(res.status).toBe(402);
  });

  it('buildCapResponse exposes usage and cap in body + Retry-After header', () => {
    const res = quotaModule.buildCapResponse({ id: 'a1', monthlyCapUsd: 50 }, 42);
    expect(res.status).toBe(402);
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
  });
});

// ── GET /api/account/cap ────────────────────────────────────────

describe('GET /api/account/cap', () => {
  it('returns 503 without ACCOUNTS_DB', async () => {
    expect((await capModule.onRequestGet({ request: makeReq(), env: {} })).status).toBe(503);
  });
  it('returns 401 without session', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [null] }) };
    expect((await capModule.onRequestGet({ request: makeReq(), env })).status).toBe(401);
  });
  it('returns 403 with session but no account', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [{ ...SESSION_WITH_ACCOUNT(), account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null }] }) };
    expect((await capModule.onRequestGet({ request: makeReq(), env })).status).toBe(403);
  });
  it('returns degrade_only mode when cap is 0', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT(0)] }) };
    const res = await capModule.onRequestGet({ request: makeReq(), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.monthlyCapUsd).toBe(0);
    expect(body.capMode).toBe('degrade_only');
    expect(body.capDescription).toMatch(/never be billed/);
  });
  it('returns hard_cap_with_opt_in_overage when cap > 0', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT(50)] }) };
    const res = await capModule.onRequestGet({ request: makeReq(), env });
    const body = await res.json();
    expect(body.monthlyCapUsd).toBe(50);
    expect(body.capMode).toBe('hard_cap_with_opt_in_overage');
  });
});

// ── PATCH /api/account/cap ──────────────────────────────────────

describe('PATCH /api/account/cap', () => {
  it('returns 503 without ACCOUNTS_DB', async () => {
    expect((await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH' }), env: {} })).status).toBe(503);
  });
  it('returns 401 without session', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [null] }) };
    expect((await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH' }), env })).status).toBe(401);
  });
  it('returns 403 with session but no account', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [{ ...SESSION_WITH_ACCOUNT(), account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null }] }) };
    expect((await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH' }), env })).status).toBe(403);
  });
  it('returns 400 on bad JSON', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT()] }) };
    const req = makeReq({ method: 'PATCH' });
    req.json = async () => { throw new Error('boom'); };
    expect((await capModule.onRequestPatch({ request: req, env })).status).toBe(400);
  });
  it('returns 400 on non-integer cap', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT()] }) };
    const res = await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH', body: { monthlyCapUsd: 'fifty' } }), env });
    expect(res.status).toBe(400);
  });
  it('returns 400 on negative cap', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT()] }) };
    const res = await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH', body: { monthlyCapUsd: -1 } }), env });
    expect(res.status).toBe(400);
  });
  it('returns 400 when cap exceeds the sanity upper bound', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT()] }) };
    const res = await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH', body: { monthlyCapUsd: 9_999_999 } }), env });
    expect(res.status).toBe(400);
  });
  it('returns 500 internal when D1 update throws', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT()], runImpl: async () => { throw new Error('d1 down'); } }) };
    const res = await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH', body: { monthlyCapUsd: 25 } }), env });
    expect(res.status).toBe(500);
  });
  it('happy path — updates cap, returns previous + new', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT(10)] }) };
    const res = await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH', body: { monthlyCapUsd: 75 } }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.monthlyCapUsd).toBe(75);
    expect(body.previousCapUsd).toBe(10);
    expect(body.capMode).toBe('hard_cap_with_opt_in_overage');
  });
  it('setting cap to 0 flips back to degrade_only mode', async () => {
    const env = { ACCOUNTS_DB: makeD1({ firstSeq: [SESSION_WITH_ACCOUNT(50)] }) };
    const res = await capModule.onRequestPatch({ request: makeReq({ method: 'PATCH', body: { monthlyCapUsd: 0 } }), env });
    const body = await res.json();
    expect(body.capMode).toBe('degrade_only');
  });
});

describe('OPTIONS preflight', () => {
  it('returns 204', async () => {
    expect((await capModule.onRequestOptions()).status).toBe(204);
  });
});
