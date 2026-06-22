/**
 * Unit tests for the UsageMeterDO + its convenience wrappers.
 *
 * Mocks state.storage with a Map and state.blockConcurrencyWhile with
 * a passthrough — the wire surface this exercises is the routing +
 * snapshot accumulation logic, not the Cloudflare actor runtime.
 */
import { describe, it, expect, vi } from 'vitest';

const mod = await import('../../functions/api/usage_meter_do.js');

function makeState() {
  const store = new Map();
  return {
    storage: {
      get: vi.fn(async (k) => store.get(k)),
      put: vi.fn(async (k, v) => { store.set(k, v); }),
    },
    blockConcurrencyWhile: vi.fn(async (fn) => fn()),
  };
}

function jsonReq(url, method, body) {
  return {
    method,
    url,
    headers: { get: () => null },
    json: async () => body,
  };
}

describe('UsageMeterDO routing', () => {
  it('routes unknown paths to 404', async () => {
    const meter = new mod.UsageMeterDO(makeState(), {});
    const res = await meter.fetch(new Request('https://x.internal/who'));
    expect(res.status).toBe(404);
  });

  it('GET /get on a fresh actor returns units=0 for the current period', async () => {
    const meter = new mod.UsageMeterDO(makeState(), {});
    const res = await meter.fetch(new Request('https://x.internal/get'));
    const body = await res.json();
    expect(body.units).toBe(0);
    expect(body.period).toMatch(/^\d{4}-\d{2}$/);
    expect(body.lastWriteAt).toBeNull();
  });
});

describe('UsageMeterDO add', () => {
  it('400s on a non-JSON body', async () => {
    const meter = new mod.UsageMeterDO(makeState(), {});
    const req = jsonReq('https://x.internal/add', 'POST');
    req.json = async () => { throw new Error('parse'); };
    const res = await meter.fetch(req);
    expect(res.status).toBe(400);
  });

  it('400s on negative or non-numeric amount', async () => {
    const meter = new mod.UsageMeterDO(makeState(), {});
    const res = await meter.fetch(jsonReq('https://x.internal/add', 'POST', { amountUsd: -1 }));
    expect(res.status).toBe(400);

    const res2 = await meter.fetch(jsonReq('https://x.internal/add', 'POST', { amountUsd: 'not-a-number' }));
    expect(res2.status).toBe(400);
  });

  it('accumulates across multiple adds within the same period', async () => {
    const state = makeState();
    const meter = new mod.UsageMeterDO(state, {});
    let r;
    r = await meter.fetch(jsonReq('https://x.internal/add', 'POST', { amountUsd: 0.01 }));
    expect((await r.json()).units).toBeCloseTo(0.01);
    r = await meter.fetch(jsonReq('https://x.internal/add', 'POST', { amountUsd: 0.02 }));
    expect((await r.json()).units).toBeCloseTo(0.03);
    r = await meter.fetch(new Request('https://x.internal/get'));
    expect((await r.json()).units).toBeCloseTo(0.03);
  });

  it('rolls over on a new period (stored snapshot is stale)', async () => {
    const state = makeState();
    // Seed a snapshot from an obviously past period.
    state.storage.get.mockImplementation(async () => ({ units: 99, period: '1999-01', lastWriteAt: 1 }));
    const meter = new mod.UsageMeterDO(state, {});
    const r = await meter.fetch(jsonReq('https://x.internal/add', 'POST', { amountUsd: 0.5 }));
    const body = await r.json();
    // The 99 from 1999-01 must NOT roll into the current period.
    expect(body.units).toBeCloseTo(0.5);
    expect(body.period).not.toBe('1999-01');
  });

  it('GET /get returns 0 + current period when stored snapshot is stale', async () => {
    const state = makeState();
    state.storage.get.mockImplementation(async () => ({ units: 99, period: '1999-01' }));
    const meter = new mod.UsageMeterDO(state, {});
    const r = await meter.fetch(new Request('https://x.internal/get'));
    const body = await r.json();
    expect(body.units).toBe(0);
    expect(body.period).not.toBe('1999-01');
  });
});

describe('UsageMeterDO reset', () => {
  it('open reset when RESET_SECRET is unset', async () => {
    const meter = new mod.UsageMeterDO(makeState(), {});
    const r = await meter.fetch(new Request('https://x.internal/reset', { method: 'POST' }));
    const body = await r.json();
    expect(body.units).toBe(0);
  });

  it('403 when RESET_SECRET is set and the wrong header is supplied', async () => {
    const meter = new mod.UsageMeterDO(makeState(), { RESET_SECRET: 'topsecret' });
    const req = new Request('https://x.internal/reset', {
      method: 'POST',
      headers: { 'x-reset-secret': 'wrong' },
    });
    const r = await meter.fetch(req);
    expect(r.status).toBe(403);
  });

  it('accepts the matching RESET_SECRET header', async () => {
    const meter = new mod.UsageMeterDO(makeState(), { RESET_SECRET: 'topsecret' });
    const req = new Request('https://x.internal/reset', {
      method: 'POST',
      headers: { 'x-reset-secret': 'topsecret' },
    });
    const r = await meter.fetch(req);
    expect(r.status).toBe(200);
    expect((await r.json()).units).toBe(0);
  });
});

describe('addUsage / readUsage convenience wrappers', () => {
  function mockBinding({ addStatus = 200, addBody = {}, getStatus = 200, getBody = {} } = {}) {
    return {
      USAGE_METER: {
        idFromName: vi.fn((n) => `id-of-${n}`),
        get: vi.fn(() => ({
          fetch: vi.fn(async (url) => {
            const u = new URL(url);
            if (u.pathname === '/add') return new Response(JSON.stringify(addBody), { status: addStatus, headers: { 'Content-Type': 'application/json' } });
            if (u.pathname === '/get') return new Response(JSON.stringify(getBody), { status: getStatus, headers: { 'Content-Type': 'application/json' } });
            return new Response('not found', { status: 404 });
          }),
        })),
      },
    };
  }

  it('addUsage returns null when binding or accountId is missing', async () => {
    expect(await mod.addUsage({}, 'acct', 1)).toBeNull();
    expect(await mod.addUsage(mockBinding(), null, 1)).toBeNull();
  });

  it('addUsage returns parsed JSON on success', async () => {
    const env = mockBinding({ addBody: { units: 5, period: '2026-06', addedAt: 12345 } });
    const out = await mod.addUsage(env, 'acct-1', 1.5);
    expect(out.units).toBe(5);
    expect(out.period).toBe('2026-06');
    expect(env.USAGE_METER.idFromName).toHaveBeenCalledWith('acct-1');
  });

  it('addUsage returns null on DO error response', async () => {
    const env = mockBinding({ addStatus: 500, addBody: { error: 'oops' } });
    expect(await mod.addUsage(env, 'acct-1', 1.5)).toBeNull();
  });

  it('readUsage returns null when binding or accountId is missing', async () => {
    expect(await mod.readUsage({}, 'acct')).toBeNull();
    expect(await mod.readUsage(mockBinding(), null)).toBeNull();
  });

  it('readUsage returns parsed JSON on success', async () => {
    const env = mockBinding({ getBody: { units: 7, period: '2026-06', lastWriteAt: 99 } });
    const out = await mod.readUsage(env, 'acct-1');
    expect(out.units).toBe(7);
    expect(out.period).toBe('2026-06');
  });

  it('readUsage returns null on DO error response', async () => {
    const env = mockBinding({ getStatus: 503 });
    expect(await mod.readUsage(env, 'acct-1')).toBeNull();
  });
});
