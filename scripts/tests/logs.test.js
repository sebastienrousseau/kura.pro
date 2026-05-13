import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions, appendLog } = await import('../../functions/api/logs.js');

function makeKV(data = {}) {
  const store = { ...data };
  return {
    get: vi.fn(key => Promise.resolve(store[key] || null)),
    put: vi.fn((key, val) => { store[key] = val; return Promise.resolve(); }),
  };
}

function makeCtx(query = '', options = {}) {
  const h = new Headers();
  if (options.key) h.set('AccountKey', options.key);
  return {
    request: new Request(`https://cloudcdn.pro/api/logs${query}`, { headers: h }),
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'admin-key',
      RATE_KV: options.kv || makeKV(),
    },
  };
}

describe('Logs API', () => {
  describe('GET /api/logs (historical)', () => {
    it('returns 401 without AccountKey', async () => {
      const res = await onRequestGet(makeCtx());
      expect(res.status).toBe(401);
    });

    it('returns empty entries when no logs exist', async () => {
      const ctx = makeCtx('?days=1', { key: 'admin-key' });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Entries).toEqual([]);
      expect(json.Count).toBe(0);
    });

    it('defaults days to 1 when query param is absent', async () => {
      const ctx = makeCtx('', { key: 'admin-key' });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Period.Days).toBe(1);
    });

    it('returns log entries for the requested days', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const kv = makeKV({ [`logs:${today}`]: JSON.stringify([
        { level: 'error', code: 'TEST', message: 'test error', timestamp: new Date().toISOString() },
        { level: 'info', code: 'TEST', message: 'test info', timestamp: new Date().toISOString() },
      ]) });
      const ctx = makeCtx('?days=1', { key: 'admin-key', kv });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Count).toBe(2);
      expect(json.Entries[0].level).toBeTruthy();
    });

    it('filters by level', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const kv = makeKV({ [`logs:${today}`]: JSON.stringify([
        { level: 'error', code: 'ERR', message: 'bad', timestamp: new Date().toISOString() },
        { level: 'info', code: 'OK', message: 'good', timestamp: new Date().toISOString() },
      ]) });
      const ctx = makeCtx('?days=1&level=error', { key: 'admin-key', kv });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Count).toBe(1);
      expect(json.Entries[0].level).toBe('error');
    });

    it('clamps days to 1-7', async () => {
      const ctx = makeCtx('?days=100', { key: 'admin-key' });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Period.Days).toBe(7);
    });

    it('respects limit param', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const entries = Array.from({ length: 50 }, (_, i) => ({
        level: 'info', code: 'T', message: `msg ${i}`, timestamp: new Date().toISOString(),
      }));
      const kv = makeKV({ [`logs:${today}`]: JSON.stringify(entries) });
      const ctx = makeCtx('?days=1&limit=5', { key: 'admin-key', kv });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Count).toBe(5);
    });

    it('includes DateFetched', async () => {
      const ctx = makeCtx('?days=1', { key: 'admin-key' });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('GET /api/logs?tail=true (SSE)', () => {
    it('returns SSE content type', async () => {
      const ctx = makeCtx('?tail=true', { key: 'admin-key' });
      const res = await onRequestGet(ctx);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      // Cancel the stream to avoid hanging
      await res.body.cancel();
    });

    // The tail loop runs while Date.now() < deadline and polls KV every 2s.
    // We make setTimeout resolve via microtask and drive Date.now() to exit
    // the loop after a single iteration so the body (and readLogsSince) run
    // exactly once.
    async function runTailOneIteration({ raw }) {
      const today = new Date().toISOString().slice(0, 10);
      const kv = makeKV(raw === null ? {} : { [`logs:${today}`]: raw });

      const origSetTimeout = globalThis.setTimeout;
      // Resolve the 2s sleep instantly so we don't slow the suite by 2 seconds.
      globalThis.setTimeout = (cb) => { Promise.resolve().then(cb); return 0; };

      // Three real Date.now() calls happen before the while-check we want to
      // succeed: lastCursor seed, deadline calc, first while-check. The 4th
      // call (next while-check after the iteration) must return past-deadline.
      let n = 0;
      const base = 1_000_000_000_000;
      const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        n++;
        return n <= 3 ? base : base + 10 * 60 * 1000;
      });

      try {
        const ctx = makeCtx('?tail=true', { key: 'admin-key', kv });
        const res = await onRequestGet(ctx);
        // Read until the stream closes — the loop exit + writer.close() does this.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let body = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          body += decoder.decode(value, { stream: true });
        }
        return body;
      } finally {
        dateSpy.mockRestore();
        globalThis.setTimeout = origSetTimeout;
      }
    }

    it('streams connected + log + heartbeat events when KV has entries', async () => {
      const entry = { level: 'info', code: 'TEST', message: 'hello', timestamp: new Date().toISOString() };
      const body = await runTailOneIteration({ raw: JSON.stringify([entry]) });
      expect(body).toContain('event: connected');
      expect(body).toContain('event: log');
      expect(body).toContain('"code":"TEST"');
      expect(body).toContain(':heartbeat ');
    });

    it('emits heartbeat even when KV has no entries (readLogsSince null branch)', async () => {
      const body = await runTailOneIteration({ raw: null });
      expect(body).toContain('event: connected');
      expect(body).not.toContain('event: log');
      expect(body).toContain(':heartbeat ');
    });

    it('only advances lastCursor for the newest entry in a batch', async () => {
      // Two entries that both pass the readLogsSince filter (both timestamps
      // are after the seeded lastCursor), but in non-monotonic order so the
      // second one trips the false branch of `if (ts > lastCursor)`.
      const newer = { level: 'info', code: 'NEW', message: 'new', timestamp: new Date(2_000_000_000_001).toISOString() };
      const older = { level: 'info', code: 'OLD', message: 'old', timestamp: new Date(2_000_000_000_000_500).toISOString() };
      // ^ The "older" one has a higher epoch than the seed lastCursor but
      //   lower than `newer`'s timestamp after the first iteration bumps it.
      // We use timestamps well past the mocked base time so they pass the filter.
      const body = await runTailOneIteration({ raw: JSON.stringify([newer, older]) });
      expect(body).toContain('"code":"NEW"');
      expect(body).toContain('"code":"OLD"');
    });
  });

  describe('appendLog', () => {
    it('does nothing when KV is null', async () => {
      await appendLog(null, { level: 'error', message: 'test' });
      // Should not throw
    });

    it('appends entry to KV', async () => {
      const kv = makeKV();
      await appendLog(kv, { level: 'info', code: 'TEST', message: 'hello', timestamp: '2026-04-05T12:00:00Z' });
      expect(kv.put).toHaveBeenCalled();
      const stored = JSON.parse(kv.put.mock.calls[0][1]);
      expect(stored).toHaveLength(1);
      expect(stored[0].message).toBe('hello');
    });

    it('appends to existing entries', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const kv = makeKV({ [`logs:${today}`]: JSON.stringify([{ level: 'info', message: 'old' }]) });
      await appendLog(kv, { level: 'error', code: 'NEW', message: 'new', timestamp: new Date().toISOString() });
      const stored = JSON.parse(kv.put.mock.calls[0][1]);
      expect(stored).toHaveLength(2);
    });

    it('caps at 1000 entries per day', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const existing = Array.from({ length: 1000 }, (_, i) => ({ level: 'info', message: `msg ${i}` }));
      const kv = makeKV({ [`logs:${today}`]: JSON.stringify(existing) });
      await appendLog(kv, { level: 'error', message: 'overflow', timestamp: new Date().toISOString() });
      const stored = JSON.parse(kv.put.mock.calls[0][1]);
      expect(stored.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('OPTIONS', () => {
    it('returns 204', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
    });
  });

  describe('503 when RATE_KV is missing', () => {
    it('GET returns 503', async () => {
      const h = new Headers();
      h.set('AccountKey', 'admin-key');
      const ctx = {
        request: new Request('https://cloudcdn.pro/api/logs', { headers: h }),
        env: { ACCOUNT_KEY: 'admin-key', RATE_KV: null },
      };
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(503);
    });
  });

  describe('appendLog — defaults date when entry has no timestamp', () => {
    it('falls back to today\'s key when entry.timestamp is missing', async () => {
      const kv = makeKV();
      await appendLog(kv, { level: 'info', code: 'NO_TS', message: 'fallback' });
      // The key should be today (UTC) — same as new Date().toISOString().slice(0, 10).
      const today = new Date().toISOString().slice(0, 10);
      expect(kv.put).toHaveBeenCalled();
      const [keyArg] = kv.put.mock.calls[0];
      expect(keyArg).toBe(`logs:${today}`);
    });
  });
});
