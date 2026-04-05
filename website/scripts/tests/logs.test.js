import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions, appendLog } = await import('../../../functions/api/logs.js');

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
});
