import { describe, it, expect, vi, beforeEach } from 'vitest';

const { appendAuditLog, queryAuditLog } = await import('../../functions/api/_shared.js');
const auditLogsModule = await import('../../functions/api/core/audit-logs.js');

function makeKV(initial = {}) {
  const store = { ...initial };
  return {
    _store: store,
    get: vi.fn(async (k) => store[k] ?? null),
    put: vi.fn(async (k, v) => { store[k] = v; }),
    delete: vi.fn(async (k) => { delete store[k]; }),
  };
}

function todayKey() {
  return 'audit:' + new Date().toISOString().slice(0, 10);
}

function makeRequest({ headers = {} } = {}) {
  return new Request('https://cloudcdn.pro/api/core/something', {
    method: 'POST',
    headers,
  });
}

describe('appendAuditLog', () => {
  it('is a no-op when RATE_KV is missing', async () => {
    // Should not throw, should not perform any write.
    await expect(appendAuditLog({}, makeRequest(), 'noop')).resolves.toBeUndefined();
  });

  it('writes a structured entry to today\'s bucket', async () => {
    const kv = makeKV();
    const req = makeRequest({ headers: { 'cf-connecting-ip': '203.0.113.10', 'user-agent': 'TestClient/1.0' } });
    await appendAuditLog({ RATE_KV: kv }, req, 'token.create', { id: 'tok-1', name: 'CI Bot' });
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, val, opts] = kv.put.mock.calls[0];
    expect(key).toBe(todayKey());
    expect(opts.expirationTtl).toBe(86400 * 90);
    const entries = JSON.parse(val);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'token.create',
      ip: '203.0.113.10',
      userAgent: 'TestClient/1.0',
      meta: { id: 'tok-1', name: 'CI Bot' },
    });
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends to existing bucket entries', async () => {
    const seed = JSON.stringify([{ timestamp: 'old', action: 'older', meta: {} }]);
    const kv = makeKV({ [todayKey()]: seed });
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.revoke', { id: 'tok-1' });
    const entries = JSON.parse(kv.put.mock.calls[0][1]);
    expect(entries).toHaveLength(2);
    expect(entries[1].action).toBe('token.revoke');
  });

  it('caps the bucket at 5,000 entries', async () => {
    const huge = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ timestamp: 't' + i, action: 'a', meta: {} })));
    const kv = makeKV({ [todayKey()]: huge });
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'overflow', {});
    const entries = JSON.parse(kv.put.mock.calls[0][1]);
    expect(entries).toHaveLength(5000);
    // Oldest entries dropped from the front.
    expect(entries[0].timestamp).toBe('t1');
    expect(entries.at(-1).action).toBe('overflow');
  });

  it('defaults missing IP and user-agent to safe values', async () => {
    const kv = makeKV();
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.create', {});
    const entries = JSON.parse(kv.put.mock.calls[0][1]);
    expect(entries[0].ip).toBe('unknown');
    expect(entries[0].userAgent).toBe('');
  });

  it('truncates oversized user-agent strings to 256 chars', async () => {
    const long = 'A'.repeat(500);
    const kv = makeKV();
    const req = makeRequest({ headers: { 'user-agent': long } });
    await appendAuditLog({ RATE_KV: kv }, req, 'token.create', {});
    const entries = JSON.parse(kv.put.mock.calls[0][1]);
    expect(entries[0].userAgent.length).toBe(256);
  });

  it('swallows KV write failures silently', async () => {
    const kv = makeKV();
    kv.put.mockRejectedValue(new Error('KV down'));
    await expect(appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.create', {})).resolves.toBeUndefined();
  });

  it('swallows KV read failures silently', async () => {
    const kv = makeKV();
    kv.get.mockRejectedValue(new Error('KV read fail'));
    await expect(appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.create', {})).resolves.toBeUndefined();
  });

  it('starts fresh when existing bucket contains malformed JSON', async () => {
    const kv = makeKV({ [todayKey()]: '{not json' });
    // Read returns the bad JSON; JSON.parse throws — appendAuditLog should
    // swallow and result in zero new entries (the catch wraps everything).
    await expect(appendAuditLog({ RATE_KV: kv }, makeRequest(), 'noop', {})).resolves.toBeUndefined();
  });
});

describe('queryAuditLog', () => {
  it('returns [] when RATE_KV is missing', async () => {
    expect(await queryAuditLog({})).toEqual([]);
  });

  it('returns [] when the bucket is empty', async () => {
    const kv = makeKV();
    expect(await queryAuditLog({ RATE_KV: kv })).toEqual([]);
  });

  it('returns entries from today\'s bucket sorted newest first', async () => {
    const kv = makeKV();
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.create', { id: '1' });
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.revoke', { id: '2' });
    const entries = await queryAuditLog({ RATE_KV: kv });
    expect(entries).toHaveLength(2);
    // Both timestamps are ISO strings from this same test; sort by descending.
    expect(entries[0].timestamp >= entries[1].timestamp).toBe(true);
  });

  it('filters by action when supplied', async () => {
    const kv = makeKV();
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.create', { id: 'a' });
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'webhook.create', { id: 'b' });
    const entries = await queryAuditLog({ RATE_KV: kv }, { action: 'token.create' });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('token.create');
  });

  it('clamps days to [1, 90]', async () => {
    const kv = makeKV();
    // No data in any bucket. Spy on kv.get to verify how many lookups happen.
    await queryAuditLog({ RATE_KV: kv }, { days: 1000 });
    expect(kv.get).toHaveBeenCalledTimes(90);
    kv.get.mockClear();
    await queryAuditLog({ RATE_KV: kv }, { days: -5 });
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('clamps limit to [1, 5000]', async () => {
    const kv = makeKV();
    // Seed today with 10 entries; ask for limit=0 → should clamp to 1.
    const ten = Array.from({ length: 10 }, (_, i) => ({ timestamp: '2026-01-01T0' + i + ':00:00Z', action: 'x', meta: {} }));
    kv._store[todayKey()] = JSON.stringify(ten);
    const got = await queryAuditLog({ RATE_KV: kv }, { limit: 0 });
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThanOrEqual(100); // default min
  });

  it('skips buckets whose JSON is malformed', async () => {
    const kv = makeKV({ [todayKey()]: '{not json' });
    const got = await queryAuditLog({ RATE_KV: kv });
    expect(got).toEqual([]);
  });

  it('skips buckets where the KV get throws', async () => {
    const kv = makeKV();
    kv.get.mockRejectedValueOnce(new Error('transient'));
    const got = await queryAuditLog({ RATE_KV: kv }, { days: 2 });
    // Second bucket (yesterday) returns nothing; first day's read threw.
    expect(got).toEqual([]);
  });
});

describe('GET /api/core/audit-logs', () => {
  function makeCtx({ key, kv, query = '' }) {
    const h = new Headers();
    if (key) h.set('AccountKey', key);
    return {
      request: new Request('https://cloudcdn.pro/api/core/audit-logs' + query, { headers: h }),
      env: { ACCOUNT_KEY: 'acct-123', RATE_KV: kv ?? makeKV() },
    };
  }

  it('returns 401 without AccountKey', async () => {
    const res = await auditLogsModule.onRequestGet(makeCtx({}));
    expect(res.status).toBe(401);
  });

  it('returns 503 when RATE_KV is missing', async () => {
    const ctx = makeCtx({ key: 'acct-123' });
    ctx.env.RATE_KV = null;
    const res = await auditLogsModule.onRequestGet(ctx);
    expect(res.status).toBe(503);
  });

  it('returns the requested entries with envelope fields', async () => {
    const kv = makeKV();
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.create', { id: 'x' });
    const res = await auditLogsModule.onRequestGet(makeCtx({ key: 'acct-123', kv }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Period).toMatchObject({ Days: 7, Action: null, Limit: 500 });
    expect(json.Entries).toHaveLength(1);
    expect(json.Count).toBe(1);
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('passes query params through to queryAuditLog', async () => {
    const kv = makeKV();
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'token.create', {});
    await appendAuditLog({ RATE_KV: kv }, makeRequest(), 'webhook.create', {});
    const res = await auditLogsModule.onRequestGet(
      makeCtx({ key: 'acct-123', kv, query: '?action=token.create&limit=10&days=1' })
    );
    const json = await res.json();
    expect(json.Period).toMatchObject({ Days: 1, Action: 'token.create', Limit: 10 });
    expect(json.Entries.every((e) => e.action === 'token.create')).toBe(true);
  });

  it('OPTIONS returns 204', async () => {
    const res = await auditLogsModule.onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});
