import { describe, it, expect, vi, beforeEach } from 'vitest';

const { RateLimiterDO } = await import('../../functions/api/rate_limiter_do.js');

function makeState() {
  const store = new Map();
  let alarmAt = null;
  return {
    blockConcurrencyWhile: async (fn) => fn(),
    storage: {
      get: vi.fn(async (k) => store.get(k)),
      put: vi.fn(async (k, v) => { store.set(k, v); }),
      delete: vi.fn(async (k) => { store.delete(k); }),
      setAlarm: vi.fn(async (ts) => { alarmAt = ts; }),
    },
    _store: store,
    _getAlarm: () => alarmAt,
  };
}

function makeRequest({ method = 'POST', path = '/increment', body } = {}) {
  return new Request(`https://rate-limiter.internal${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

describe('RateLimiterDO', () => {
  let state;
  let env;
  let limiter;

  beforeEach(() => {
    state = makeState();
    env = {};
    limiter = new RateLimiterDO(state, env);
  });

  describe('routing', () => {
    it('returns 404 for an unknown path', async () => {
      const res = await limiter.fetch(makeRequest({ path: '/something-else', body: {} }));
      expect(res.status).toBe(404);
    });

    it('returns 404 for a non-POST method', async () => {
      const res = await limiter.fetch(makeRequest({ method: 'GET' }));
      expect(res.status).toBe(404);
    });
  });

  describe('input validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const res = await limiter.fetch(makeRequest({ body: '{not json' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid/i);
    });

    it('returns 400 when limit is missing', async () => {
      const res = await limiter.fetch(makeRequest({ body: { windowSeconds: 60 } }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when limit is non-positive', async () => {
      const res = await limiter.fetch(makeRequest({ body: { limit: 0, windowSeconds: 60 } }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when windowSeconds is missing', async () => {
      const res = await limiter.fetch(makeRequest({ body: { limit: 10 } }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when windowSeconds is non-positive', async () => {
      const res = await limiter.fetch(makeRequest({ body: { limit: 10, windowSeconds: 0 } }));
      expect(res.status).toBe(400);
    });
  });

  describe('counter semantics', () => {
    it('allows the first request and records count=1', async () => {
      const res = await limiter.fetch(makeRequest({ body: { limit: 3, windowSeconds: 60 } }));
      const json = await res.json();
      expect(json.allowed).toBe(true);
      expect(json.limit).toBe(3);
      expect(json.remaining).toBe(2);
      expect(state.storage.put).toHaveBeenCalled();
      const stored = state._store.get('window');
      expect(stored.count).toBe(1);
    });

    it('increments across successive requests until it hits the limit', async () => {
      const body = { limit: 2, windowSeconds: 60 };
      const a = await (await limiter.fetch(makeRequest({ body }))).json();
      const b = await (await limiter.fetch(makeRequest({ body }))).json();
      const c = await (await limiter.fetch(makeRequest({ body }))).json();
      expect(a.allowed).toBe(true);
      expect(a.remaining).toBe(1);
      expect(b.allowed).toBe(true);
      expect(b.remaining).toBe(0);
      expect(c.allowed).toBe(false);
      expect(c.remaining).toBe(0);
      expect(c.resetAt).toBeGreaterThan(0);
    });

    it('rolls the window over after the elapsed time exceeds windowSeconds', async () => {
      // Pre-populate stored window with an old timestamp.
      state._store.set('window', { start: Date.now() - 120_000, count: 99 });
      const res = await limiter.fetch(makeRequest({ body: { limit: 5, windowSeconds: 60 } }));
      const json = await res.json();
      expect(json.allowed).toBe(true);
      expect(json.remaining).toBe(4);
      // The new window should have count=1, not 100.
      expect(state._store.get('window').count).toBe(1);
    });

    it('schedules an alarm to clean up the counter after the window', async () => {
      await limiter.fetch(makeRequest({ body: { limit: 5, windowSeconds: 60 } }));
      expect(state.storage.setAlarm).toHaveBeenCalled();
      const alarmAt = state.storage.setAlarm.mock.calls[0][0];
      // Alarm is window-end + 1s slack.
      expect(alarmAt).toBeGreaterThan(Date.now());
      expect(alarmAt).toBeLessThan(Date.now() + 62_000);
    });

    it('returns the same resetAt within a window for consecutive requests', async () => {
      const body = { limit: 5, windowSeconds: 60 };
      const a = await (await limiter.fetch(makeRequest({ body }))).json();
      const b = await (await limiter.fetch(makeRequest({ body }))).json();
      expect(a.resetAt).toBe(b.resetAt);
    });
  });

  describe('alarm', () => {
    it('clears the stored window when fired', async () => {
      state._store.set('window', { start: Date.now() - 1000, count: 3 });
      await limiter.alarm();
      expect(state.storage.delete).toHaveBeenCalledWith('window');
    });
  });
});
