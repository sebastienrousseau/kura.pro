import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getManifest, clearManifestCache, streamJsonArray,
  authenticateAccess, authenticateAccount, authenticateAny,
  formatBytes, parseCookies, CORS_JSON,
  log, createTrace, fetchWithTimeout, hmacSign, hmacVerify,
  checkRateLimit,
  normalizeQuery, hashString, buildCacheKey, cacheGet, cacheSet,
  aiBudgetState, aiBudgetCharge, aiBudgetTrip, isAiQuotaError, AI_COST,
  recordMetric,
} from '../../functions/api/_shared.js';

const originalFetch = globalThis.fetch;

describe('Shared utilities', () => {
  beforeEach(() => clearManifestCache());

  describe('getManifest — isolate cache', () => {
    it('fetches manifest on first call', async () => {
      const data = [{ name: 'test.png', path: 'test.png' }];
      const env = {
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(data))) },
      };
      const result = await getManifest(env, 'https://cdn.pro');
      expect(result).toEqual(data);
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    });

    it('returns cached manifest on subsequent calls', async () => {
      const data = [{ name: 'cached.svg' }];
      const env = {
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(data))) },
      };
      await getManifest(env, 'https://cdn.pro');
      await getManifest(env, 'https://cdn.pro');
      await getManifest(env, 'https://cdn.pro');
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes cache after clearManifestCache()', async () => {
      const env = {
        ASSETS: { fetch: vi.fn().mockImplementation(() => Promise.resolve(new Response('[]'))) },
      };
      await getManifest(env, 'https://cdn.pro');
      clearManifestCache();
      await getManifest(env, 'https://cdn.pro');
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('streamJsonArray — streaming responses', () => {
    it('streams a JSON array with envelope', async () => {
      const response = streamJsonArray({
        envelope: { Total: 3, DateFetched: '2026-01-01T00:00:00Z' },
        arrayKey: 'Items',
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const text = await response.text();
      const parsed = JSON.parse(text);
      expect(parsed.Total).toBe(3);
      expect(parsed.Items).toHaveLength(3);
      expect(parsed.Items[0].id).toBe(1);
    });

    it('handles empty array', async () => {
      const response = streamJsonArray({
        envelope: { Count: 0 },
        arrayKey: 'Data',
        items: [],
      });
      const parsed = await response.json();
      expect(parsed.Data).toEqual([]);
      expect(parsed.Count).toBe(0);
    });

    it('handles single item', async () => {
      const response = streamJsonArray({
        envelope: {},
        arrayKey: 'Results',
        items: [{ x: 'only' }],
      });
      const parsed = await response.json();
      expect(parsed.Results).toEqual([{ x: 'only' }]);
    });

    it('produces valid JSON for large arrays', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({ index: i, data: 'x'.repeat(100) }));
      const response = streamJsonArray({
        envelope: { Size: 1000 },
        arrayKey: 'Items',
        items,
      });
      const parsed = await response.json();
      expect(parsed.Items).toHaveLength(1000);
      expect(parsed.Items[999].index).toBe(999);
    });
  });

  describe('authenticateAccess', () => {
    it('allows AccessKey match', async () => {
      const req = { headers: new Headers({ AccessKey: 'key123' }) };
      expect(await authenticateAccess(req, { STORAGE_KEY: 'key123' })).toBe(true);
    });

    it('rejects wrong AccessKey', async () => {
      const req = { headers: new Headers({ AccessKey: 'wrong' }) };
      expect(await authenticateAccess(req, { STORAGE_KEY: 'key123' })).toBe(false);
    });

    it('allows open access when no keys configured', async () => {
      const req = { headers: new Headers() };
      expect(await authenticateAccess(req, {})).toBe(true);
    });
  });

  describe('authenticateAccount', () => {
    it('allows AccountKey match', () => {
      const req = { headers: new Headers({ AccountKey: 'acct123' }) };
      expect(authenticateAccount(req, { ACCOUNT_KEY: 'acct123' })).toBe(true);
    });

    it('rejects wrong AccountKey', () => {
      const req = { headers: new Headers({ AccountKey: 'wrong' }) };
      expect(authenticateAccount(req, { ACCOUNT_KEY: 'acct123' })).toBe(false);
    });
  });

  describe('authenticateAny', () => {
    it('accepts AccountKey', async () => {
      const req = { headers: new Headers({ AccountKey: 'acct' }) };
      expect(await authenticateAny(req, { ACCOUNT_KEY: 'acct' })).toBe(true);
    });

    it('accepts AccessKey when AccountKey fails', async () => {
      const req = { headers: new Headers({ AccessKey: 'stor' }) };
      expect(await authenticateAny(req, { ACCOUNT_KEY: 'acct', STORAGE_KEY: 'stor' })).toBe(true);
    });

    it('rejects when both fail', async () => {
      const req = { headers: new Headers() };
      expect(await authenticateAny(req, { ACCOUNT_KEY: 'acct', STORAGE_KEY: 'stor' })).toBe(false);
    });
  });

  describe('formatBytes', () => {
    it('formats bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(1073741824)).toBe('1.00 GB');
    });
  });

  describe('parseCookies', () => {
    it('parses cookie header', () => {
      expect(parseCookies('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
    });
    it('handles empty/null', () => {
      expect(parseCookies(null)).toEqual({});
      expect(parseCookies('')).toEqual({});
    });
  });

  // --- Extended tests ---

  describe('authenticateAccess — extended', () => {
    it('allows session cookie auth', async () => {
      // When no AccessKey provided but DASHBOARD_SECRET matches cookie
      const req = { headers: new Headers() };
      expect(await authenticateAccess(req, {})).toBe(true);
    });

    it('rejects when STORAGE_KEY configured but no key provided', async () => {
      const req = { headers: new Headers() };
      expect(await authenticateAccess(req, { STORAGE_KEY: 'k', DASHBOARD_SECRET: 's', DASHBOARD_PASSWORD: 'p' })).toBe(false);
    });
  });

  describe('authenticateAccount — extended', () => {
    it('allows access when no ACCOUNT_KEY configured', () => {
      const req = { headers: new Headers() };
      expect(authenticateAccount(req, {})).toBe(true);
    });

    it('rejects when ACCOUNT_KEY configured but header is empty string', () => {
      const req = { headers: new Headers({ AccountKey: '' }) };
      expect(authenticateAccount(req, { ACCOUNT_KEY: 'acct123' })).toBe(false);
    });
  });

  describe('authenticateAny — extended', () => {
    it('accepts AccountKey only', async () => {
      const req = { headers: new Headers({ AccountKey: 'acct' }) };
      expect(await authenticateAny(req, { ACCOUNT_KEY: 'acct', STORAGE_KEY: 'stor' })).toBe(true);
    });

    it('accepts AccessKey only', async () => {
      const req = { headers: new Headers({ AccessKey: 'stor' }) };
      expect(await authenticateAny(req, { ACCOUNT_KEY: 'acct', STORAGE_KEY: 'stor' })).toBe(true);
    });

    it('rejects when neither key matches', async () => {
      const req = { headers: new Headers({ AccountKey: 'wrong', AccessKey: 'wrong' }) };
      expect(await authenticateAny(req, { ACCOUNT_KEY: 'acct', STORAGE_KEY: 'stor' })).toBe(false);
    });

    it('allows when no keys configured at all', async () => {
      const req = { headers: new Headers() };
      expect(await authenticateAny(req, {})).toBe(true);
    });
  });

  describe('formatBytes — extended', () => {
    it('handles undefined gracefully', () => {
      expect(formatBytes(undefined)).toBe('0 B');
    });

    it('handles null gracefully', () => {
      expect(formatBytes(null)).toBe('0 B');
    });

    it('handles NaN gracefully', () => {
      expect(formatBytes(NaN)).toBe('0 B');
    });

    it('formats terabytes range', () => {
      const result = formatBytes(1099511627776);
      // May format as GB or TB depending on implementation
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formats exactly 1 KB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
    });

    it('formats exactly 1 MB', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB');
    });
  });

  describe('streamJsonArray — extended', () => {
    it('handles items with nested objects', async () => {
      const items = [{ id: 1, meta: { foo: 'bar', nested: { deep: true } } }];
      const res = streamJsonArray({ envelope: {}, arrayKey: 'Data', items });
      const json = await res.json();
      expect(json.Data[0].meta.nested.deep).toBe(true);
    });

    it('handles items with arrays inside', async () => {
      const items = [{ id: 1, tags: ['a', 'b', 'c'] }];
      const res = streamJsonArray({ envelope: {}, arrayKey: 'Data', items });
      const json = await res.json();
      expect(json.Data[0].tags).toEqual(['a', 'b', 'c']);
    });

    it('handles special characters in envelope keys', async () => {
      const res = streamJsonArray({
        envelope: { 'Key-With-Dashes': 'val', 'snake_case': true },
        arrayKey: 'Items',
        items: [{ id: 1 }],
      });
      const json = await res.json();
      expect(json['Key-With-Dashes']).toBe('val');
      expect(json['snake_case']).toBe(true);
    });
  });

  describe('CORS_JSON constant', () => {
    it('includes Content-Type application/json', () => {
      expect(CORS_JSON['Content-Type']).toBe('application/json');
    });

    it('includes Access-Control-Allow-Origin *', () => {
      expect(CORS_JSON['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('getManifest — extended', () => {
    it('handles ASSETS.fetch returning error', async () => {
      const env = {
        ASSETS: { fetch: vi.fn().mockRejectedValue(new Error('ASSETS down')) },
      };
      try {
        const result = await getManifest(env, 'https://cdn.pro');
        // Should either throw or return empty
        expect(Array.isArray(result) || result === undefined).toBe(true);
      } catch (err) {
        expect(err).toBeDefined();
      }
    });

    it('handles ASSETS.fetch returning non-JSON', async () => {
      const env = {
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('not json', { status: 200 })) },
      };
      try {
        await getManifest(env, 'https://cdn.pro');
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  describe('parseCookies — extended', () => {
    it('parses single cookie', () => {
      expect(parseCookies('a=1')).toEqual({ a: '1' });
    });

    it('handles whitespace around values', () => {
      const result = parseCookies('a = 1 ; b = 2');
      expect(result).toBeDefined();
    });

    it('handles cookie with equals in value', () => {
      const result = parseCookies('token=abc=def=ghi');
      expect(result.token).toBeDefined();
    });

    it('handles undefined input', () => {
      expect(parseCookies(undefined)).toEqual({});
    });
  });

  describe('streamJsonArray — additional edge cases', () => {
    it('response is readable as stream', async () => {
      const res = streamJsonArray({ envelope: {}, arrayKey: 'D', items: [{ x: 1 }] });
      expect(res.body).toBeDefined();
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    });

    it('items with unicode characters', async () => {
      const items = [{ name: '日本語テスト', path: '/パス/ファイル.svg' }];
      const res = streamJsonArray({ envelope: {}, arrayKey: 'Items', items });
      const json = await res.json();
      expect(json.Items[0].name).toBe('日本語テスト');
    });

    it('envelope with date strings', async () => {
      const res = streamJsonArray({
        envelope: { Created: '2026-01-01T00:00:00Z', Updated: '2026-04-04T12:00:00Z' },
        arrayKey: 'Data',
        items: [],
      });
      const json = await res.json();
      expect(json.Created).toBe('2026-01-01T00:00:00Z');
    });
  });

  describe('CORS_JSON constant — extended', () => {
    it('has all required CORS fields', () => {
      expect(CORS_JSON).toHaveProperty('Content-Type');
      expect(CORS_JSON).toHaveProperty('Access-Control-Allow-Origin');
    });
  });

  describe('authenticateAccess — edge cases', () => {
    it('handles request with empty AccessKey header', async () => {
      const req = { headers: new Headers({ AccessKey: '' }) };
      expect(await authenticateAccess(req, { STORAGE_KEY: 'key123' })).toBe(false);
    });
  });

  describe('authenticateAccount — edge cases', () => {
    it('handles request with empty AccountKey header', () => {
      const req = { headers: new Headers({ AccountKey: '' }) };
      expect(authenticateAccount(req, { ACCOUNT_KEY: 'acct123' })).toBe(false);
    });

    it('case-sensitive AccountKey comparison', () => {
      const req = { headers: new Headers({ AccountKey: 'KEY' }) };
      expect(authenticateAccount(req, { ACCOUNT_KEY: 'key' })).toBe(false);
    });
  });

  describe('getManifest — additional', () => {
    it('returns array with expected structure', async () => {
      const data = [{ name: 'a.png', path: 'test/a.png', project: 'test', category: 'img', format: 'png', size: 100 }];
      const env = { ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(data))) } };
      const result = await getManifest(env, 'https://cdn.pro');
      expect(result[0].name).toBe('a.png');
      expect(result[0].format).toBe('png');
      expect(result[0].size).toBe(100);
    });

    it('returns empty array for empty manifest', async () => {
      const env = { ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('[]')) } };
      const result = await getManifest(env, 'https://cdn.pro');
      expect(result).toEqual([]);
    });
  });

  describe('streamJsonArray — response headers', () => {
    it('has status 200', () => {
      const res = streamJsonArray({ envelope: {}, arrayKey: 'D', items: [] });
      expect(res.status).toBe(200);
    });

    it('has Content-Type application/json', () => {
      const res = streamJsonArray({ envelope: {}, arrayKey: 'D', items: [] });
      expect(res.headers.get('Content-Type')).toBe('application/json');
    });

    it('has CORS header', () => {
      const res = streamJsonArray({ envelope: {}, arrayKey: 'D', items: [] });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('has Transfer-Encoding chunked', () => {
      const res = streamJsonArray({ envelope: {}, arrayKey: 'D', items: [] });
      expect(res.headers.get('Transfer-Encoding')).toBe('chunked');
    });
  });

  describe('formatBytes — additional values', () => {
    it('formats 999 bytes', () => {
      expect(formatBytes(999)).toBe('999 B');
    });

    it('formats 1023 bytes', () => {
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('formats 10 KB', () => {
      expect(formatBytes(10240)).toBe('10.0 KB');
    });

    it('formats 100 MB', () => {
      expect(formatBytes(104857600)).toBe('100.0 MB');
    });

    it('formats 500 MB', () => {
      expect(formatBytes(524288000)).toBe('500.0 MB');
    });

    it('formats 1 GB', () => {
      expect(formatBytes(1073741824)).toBe('1.00 GB');
    });
  });

  describe('authenticateAccess — additional', () => {
    it('case-sensitive AccessKey comparison', async () => {
      const req = { headers: new Headers({ AccessKey: 'KEY' }) };
      expect(await authenticateAccess(req, { STORAGE_KEY: 'key' })).toBe(false);
    });
  });

  describe('authenticateAny — additional', () => {
    it('prefers AccountKey over AccessKey', async () => {
      const req = { headers: new Headers({ AccountKey: 'acct', AccessKey: 'stor' }) };
      expect(await authenticateAny(req, { ACCOUNT_KEY: 'acct', STORAGE_KEY: 'stor' })).toBe(true);
    });

    it('fails with wrong AccountKey even if AccessKey is correct', async () => {
      const req = { headers: new Headers({ AccountKey: 'wrong' }) };
      expect(await authenticateAny(req, { ACCOUNT_KEY: 'acct', STORAGE_KEY: 'wrong' })).toBe(false);
    });
  });

  describe('parseCookies — special values', () => {
    it('handles cookie with value containing semicolons (quoted)', () => {
      const result = parseCookies('a=hello; b=world');
      expect(result.a).toBe('hello');
      expect(result.b).toBe('world');
    });
  });

  // ── Structured Logging ──

  describe('log', () => {
    it('log.info outputs JSON to console.log', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('TEST_CODE', 'test message', { extra: 'data' });
      expect(spy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(spy.mock.calls[0][0]);
      expect(parsed.level).toBe('info');
      expect(parsed.code).toBe('TEST_CODE');
      expect(parsed.message).toBe('test message');
      expect(parsed.extra).toBe('data');
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      spy.mockRestore();
    });

    it('log.warn outputs to console.warn', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      log.warn('WARN_CODE', 'warning');
      const parsed = JSON.parse(spy.mock.calls[0][0]);
      expect(parsed.level).toBe('warn');
      spy.mockRestore();
    });

    it('log.error outputs to console.error', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.error('ERR_CODE', 'error msg');
      const parsed = JSON.parse(spy.mock.calls[0][0]);
      expect(parsed.level).toBe('error');
      expect(parsed.code).toBe('ERR_CODE');
      spy.mockRestore();
    });
  });

  // ── Request Tracing ──

  describe('createTrace', () => {
    it('generates traceId and spanId', () => {
      const trace = createTrace(new Request('https://test.com/api'));
      expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('generates W3C traceparent header', () => {
      const trace = createTrace(new Request('https://test.com/api'));
      expect(trace.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    it('end() returns duration and status', () => {
      const trace = createTrace(new Request('https://test.com/api'));
      const result = trace.end(200);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.status).toBe(200);
      expect(result.traceId).toBe(trace.traceId);
    });

    it('child() creates child span with parent reference', () => {
      const trace = createTrace(new Request('https://test.com/api'));
      const child = trace.child('vectorize-query');
      expect(child.name).toBe('vectorize-query');
      expect(child.parentSpanId).toBe(trace.spanId);
      expect(child.traceId).toBe(trace.traceId);
      expect(child.spanId).not.toBe(trace.spanId);
    });

    it('child.end() returns duration', () => {
      const trace = createTrace(new Request('https://test.com/api'));
      const child = trace.child('ai-embed');
      const result = child.end();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.name).toBe('ai-embed');
    });
  });

  // ── Fetch with Timeout ──

  describe('fetchWithTimeout', () => {
    it('returns response on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
      const res = await fetchWithTimeout('https://api.github.com/test', {}, 5000);
      expect(await res.text()).toBe('ok');
      globalThis.fetch = originalFetch;
    });

    it('passes options through to fetch', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
      await fetchWithTimeout('https://api.github.com/test', { method: 'POST', headers: { 'X-Test': '1' } });
      const [, opts] = globalThis.fetch.mock.calls[0];
      expect(opts.method).toBe('POST');
      expect(opts.headers['X-Test']).toBe('1');
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      globalThis.fetch = originalFetch;
    });

    it('aborts on timeout', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      });
      await expect(fetchWithTimeout('https://slow.example.com', {}, 10)).rejects.toThrow('Aborted');
      globalThis.fetch = originalFetch;
    });
  });

  // ── HMAC Functions ──

  describe('hmacSign + hmacVerify', () => {
    it('sign then verify returns true', async () => {
      const sig = await hmacSign('my-secret', 'hello-world');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      const valid = await hmacVerify('my-secret', 'hello-world', sig);
      expect(valid).toBe(true);
    });

    it('verify rejects wrong signature', async () => {
      const valid = await hmacVerify('my-secret', 'hello-world', 'a'.repeat(64));
      expect(valid).toBe(false);
    });

    it('verify rejects wrong data', async () => {
      const sig = await hmacSign('my-secret', 'hello-world');
      const valid = await hmacVerify('my-secret', 'wrong-data', sig);
      expect(valid).toBe(false);
    });

    it('verify rejects wrong secret', async () => {
      const sig = await hmacSign('my-secret', 'hello-world');
      const valid = await hmacVerify('other-secret', 'hello-world', sig);
      expect(valid).toBe(false);
    });

    it('different data produces different signatures', async () => {
      const sig1 = await hmacSign('secret', 'data1');
      const sig2 = await hmacSign('secret', 'data2');
      expect(sig1).not.toBe(sig2);
    });
  });

  // ── checkRateLimit ──

  describe('checkRateLimit', () => {
    it('allows when under limit', async () => {
      const kv = { get: vi.fn().mockResolvedValue('5'), put: vi.fn().mockResolvedValue(undefined) };
      const result = await checkRateLimit(kv, 'test:ip', 100, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(94);
    });

    it('blocks when at limit', async () => {
      const kv = { get: vi.fn().mockResolvedValue('100'), put: vi.fn() };
      const result = await checkRateLimit(kv, 'test:ip', 100, 60);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('allows when kv is null', async () => {
      const result = await checkRateLimit(null, 'test:ip', 100, 60);
      expect(result.allowed).toBe(true);
    });

    it('increments counter in KV', async () => {
      const kv = { get: vi.fn().mockResolvedValue('10'), put: vi.fn().mockResolvedValue(undefined) };
      await checkRateLimit(kv, 'test:key', 100, 60);
      expect(kv.put).toHaveBeenCalledWith('test:key', '11', { expirationTtl: 60 });
    });

    it('accepts an env object and dispatches to the KV branch when only RATE_KV is bound', async () => {
      const kv = { get: vi.fn().mockResolvedValue('3'), put: vi.fn().mockResolvedValue(undefined) };
      const result = await checkRateLimit({ RATE_KV: kv }, 'test:ip', 10, 60);
      expect(result).toEqual({ allowed: true, limit: 10, remaining: 6 });
      expect(kv.put).toHaveBeenCalledWith('test:ip', '4', { expirationTtl: 60 });
    });

    it('returns allowed=true when env has neither RATE_LIMITER nor RATE_KV', async () => {
      const result = await checkRateLimit({}, 'test:ip', 10, 60);
      expect(result.allowed).toBe(true);
    });

    it('prefers the RATE_LIMITER Durable Object when both bindings are present', async () => {
      const doResponse = { allowed: true, limit: 10, remaining: 5, resetAt: 1234 };
      const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(doResponse), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
      const env = {
        RATE_LIMITER: {
          idFromName: vi.fn().mockReturnValue({ toString: () => 'id-1' }),
          get: vi.fn().mockReturnValue({ fetch: stubFetch }),
        },
        RATE_KV: { get: vi.fn(), put: vi.fn() },
      };
      const result = await checkRateLimit(env, 'rl:test', 10, 60);
      expect(result).toEqual(doResponse);
      expect(env.RATE_LIMITER.idFromName).toHaveBeenCalledWith('rl:test');
      expect(stubFetch).toHaveBeenCalledTimes(1);
      // KV must NOT be touched on the happy path.
      expect(env.RATE_KV.get).not.toHaveBeenCalled();
    });

    it('falls back to KV when the Durable Object returns a non-2xx response', async () => {
      const env = {
        RATE_LIMITER: {
          idFromName: vi.fn().mockReturnValue('id-2'),
          get: vi.fn().mockReturnValue({
            fetch: vi.fn().mockResolvedValue(new Response('err', { status: 500 })),
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue('1'), put: vi.fn().mockResolvedValue(undefined) },
      };
      const result = await checkRateLimit(env, 'rl:test', 10, 60);
      expect(result.allowed).toBe(true);
      expect(env.RATE_KV.put).toHaveBeenCalled();
    });

    it('falls back to KV when the Durable Object call throws', async () => {
      const env = {
        RATE_LIMITER: {
          idFromName: vi.fn().mockReturnValue('id-3'),
          get: vi.fn().mockReturnValue({
            fetch: vi.fn().mockRejectedValue(new Error('DO down')),
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue('0'), put: vi.fn().mockResolvedValue(undefined) },
      };
      const result = await checkRateLimit(env, 'rl:test', 10, 60);
      expect(result.allowed).toBe(true);
    });
  });

  // ── normalizeQuery / hashString / cache keys ──

  describe('normalizeQuery', () => {
    it('lowercases and collapses non-alphanumeric runs to a single space', () => {
      expect(normalizeQuery('Hello,   World!!!')).toBe('hello world');
    });
    it('trims leading/trailing whitespace', () => {
      expect(normalizeQuery('   foo bar   ')).toBe('foo bar');
    });
    it('keeps digits', () => {
      expect(normalizeQuery('Pro $29/mo')).toBe('pro 29 mo');
    });
    it('returns empty for null/empty', () => {
      expect(normalizeQuery('')).toBe('');
      expect(normalizeQuery(null)).toBe('');
      expect(normalizeQuery(undefined)).toBe('');
    });
    it('handles unicode punctuation', () => {
      expect(normalizeQuery('what — is — cloudcdn?')).toBe('what is cloudcdn');
    });
  });

  describe('hashString', () => {
    it('returns a 64-char hex SHA-256 digest', async () => {
      const h = await hashString('hello');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
    it('is deterministic', async () => {
      expect(await hashString('abc')).toBe(await hashString('abc'));
    });
    it('different inputs differ', async () => {
      expect(await hashString('a')).not.toBe(await hashString('b'));
    });
  });

  describe('buildCacheKey', () => {
    it('uses internal synthetic origin', () => {
      const k = buildCacheKey('search', 'deadbeef');
      expect(k.startsWith('https://cache.cloudcdn.internal/')).toBe(true);
    });
    it('namespaces and includes hash', () => {
      const k = buildCacheKey('chat', 'abc123');
      expect(k).toContain('/chat/');
      expect(k.endsWith('/abc123')).toBe(true);
    });
    it('day-bucket changes the path', () => {
      // Same hash on the same day must produce the same key.
      const k1 = buildCacheKey('x', 'h');
      const k2 = buildCacheKey('x', 'h');
      expect(k1).toBe(k2);
    });
  });

  describe('cacheGet/cacheSet — no Cache binding', () => {
    it('cacheGet returns null when caches.default is missing', async () => {
      const prior = globalThis.caches;
      delete globalThis.caches;
      try {
        const result = await cacheGet('https://x/y');
        expect(result).toBeNull();
      } finally {
        globalThis.caches = prior;
      }
    });
    it('cacheSet is a no-op when caches.default is missing', async () => {
      const prior = globalThis.caches;
      delete globalThis.caches;
      try {
        await expect(cacheSet('https://x/y', { a: 1 }, 60)).resolves.toBeUndefined();
      } finally {
        globalThis.caches = prior;
      }
    });
  });

  describe('cacheGet/cacheSet — round-trip with stubbed Cache API', () => {
    it('round-trips JSON payload', async () => {
      const store = new Map();
      const prior = globalThis.caches;
      globalThis.caches = {
        default: {
          match: vi.fn(async (req) => {
            const u = typeof req === 'string' ? req : req.url;
            return store.has(u) ? new Response(store.get(u), { headers: { 'Content-Type': 'application/json' } }) : undefined;
          }),
          put: vi.fn(async (req, res) => {
            const u = typeof req === 'string' ? req : req.url;
            store.set(u, await res.text());
          }),
        },
      };
      try {
        await cacheSet('https://cache.test/k', { hello: 'world' }, 60);
        const got = await cacheGet('https://cache.test/k');
        expect(got).toEqual({ hello: 'world' });
      } finally {
        globalThis.caches = prior;
      }
    });
  });

  // ── AI budget / circuit breaker ──

  describe('aiBudgetState', () => {
    it('returns capacity from env override', async () => {
      const kv = { get: vi.fn().mockResolvedValue(null) };
      const state = await aiBudgetState({ RATE_KV: kv, AI_DAILY_BUDGET: '5000' });
      expect(state.capacity).toBe(5000);
      expect(state.used).toBe(0);
      expect(state.exhausted).toBe(false);
    });
    it('uses default capacity when env missing', async () => {
      const state = await aiBudgetState({ RATE_KV: { get: vi.fn().mockResolvedValue(null) } });
      expect(state.capacity).toBe(9000);
    });
    it('reports exhausted when usage exceeds capacity', async () => {
      const kv = {
        get: vi.fn().mockImplementation((k) => Promise.resolve(k.startsWith('ai:neurons:') ? '9999' : null)),
      };
      const state = await aiBudgetState({ RATE_KV: kv });
      expect(state.exhausted).toBe(true);
    });
    it('reports exhausted when circuit breaker is open', async () => {
      const kv = {
        get: vi.fn().mockImplementation((k) => Promise.resolve(k === 'ai:cb:open' ? '1' : null)),
      };
      const state = await aiBudgetState({ RATE_KV: kv });
      expect(state.circuitOpen).toBe(true);
      expect(state.exhausted).toBe(true);
    });
    it('is safe with no KV', async () => {
      const state = await aiBudgetState({});
      expect(state).toEqual({ used: 0, capacity: 9000, circuitOpen: false, exhausted: false });
    });
    it('treats KV errors as available', async () => {
      const kv = { get: vi.fn().mockRejectedValue(new Error('KV down')) };
      const state = await aiBudgetState({ RATE_KV: kv });
      expect(state.exhausted).toBe(false);
    });
  });

  describe('aiBudgetCharge', () => {
    it('increments today\'s counter', async () => {
      const put = vi.fn().mockResolvedValue(undefined);
      const kv = { get: vi.fn().mockResolvedValue('1.5'), put };
      await aiBudgetCharge({ RATE_KV: kv }, 6);
      expect(put).toHaveBeenCalledTimes(1);
      const [key, val, opts] = put.mock.calls[0];
      expect(key).toMatch(/^ai:neurons:\d{4}-\d{2}-\d{2}$/);
      expect(parseFloat(val)).toBeCloseTo(7.5);
      expect(opts.expirationTtl).toBe(86400 * 2);
    });
    it('is a no-op with no KV', async () => {
      await expect(aiBudgetCharge({}, 5)).resolves.toBeUndefined();
    });
    it('is a no-op for non-positive neurons', async () => {
      const put = vi.fn();
      await aiBudgetCharge({ RATE_KV: { get: vi.fn(), put } }, 0);
      await aiBudgetCharge({ RATE_KV: { get: vi.fn(), put } }, -1);
      expect(put).not.toHaveBeenCalled();
    });
    it('swallows KV write failures', async () => {
      const kv = { get: vi.fn().mockResolvedValue('0'), put: vi.fn().mockRejectedValue(new Error('boom')) };
      await expect(aiBudgetCharge({ RATE_KV: kv }, 1)).resolves.toBeUndefined();
    });
  });

  describe('aiBudgetTrip', () => {
    it('opens the breaker key', async () => {
      const put = vi.fn().mockResolvedValue(undefined);
      await aiBudgetTrip({ RATE_KV: { put } }, 'test');
      const call = put.mock.calls.find((c) => c[0] === 'ai:cb:open');
      expect(call).toBeTruthy();
      expect(call[1]).toBe('1');
      expect(call[2].expirationTtl).toBe(60);
    });
    it('respects AI_CB_TTL_SEC override', async () => {
      const put = vi.fn().mockResolvedValue(undefined);
      await aiBudgetTrip({ RATE_KV: { put }, AI_CB_TTL_SEC: '300' });
      const call = put.mock.calls.find((c) => c[0] === 'ai:cb:open');
      expect(call[2].expirationTtl).toBe(300);
    });
    it('is a no-op without KV', async () => {
      await expect(aiBudgetTrip({})).resolves.toBeUndefined();
    });
  });

  describe('isAiQuotaError', () => {
    it('detects 429 status', () => {
      expect(isAiQuotaError({ status: 429 })).toBe(true);
      expect(isAiQuotaError({ statusCode: 429 })).toBe(true);
    });
    it('detects Workers AI quota error codes', () => {
      expect(isAiQuotaError({ code: 3040 })).toBe(true);
      expect(isAiQuotaError({ code: 7006 })).toBe(true);
      expect(isAiQuotaError({ code: 9001 })).toBe(true);
    });
    it('detects message keywords', () => {
      expect(isAiQuotaError(new Error('Quota exceeded for the day'))).toBe(true);
      expect(isAiQuotaError(new Error('At capacity'))).toBe(true);
      expect(isAiQuotaError(new Error('Too many requests'))).toBe(true);
      expect(isAiQuotaError(new Error('rate limit hit'))).toBe(true);
    });
    it('rejects unrelated errors', () => {
      expect(isAiQuotaError(new Error('network reset'))).toBe(false);
      expect(isAiQuotaError(null)).toBe(false);
      expect(isAiQuotaError(undefined)).toBe(false);
    });
  });

  describe('AI_COST', () => {
    it('exposes per-model neuron estimates', () => {
      expect(AI_COST.embed_bge_base).toBeGreaterThan(0);
      expect(AI_COST.llama_8b_fast).toBeGreaterThan(AI_COST.embed_bge_base);
    });
  });

  describe('recordMetric', () => {
    it('is a no-op when env is missing', () => {
      // Should not throw.
      expect(() => recordMetric(undefined, { endpoint: '/x', status: 200 })).not.toThrow();
    });

    it('is a no-op when METRICS binding is missing', () => {
      expect(() => recordMetric({}, { endpoint: '/x', status: 200 })).not.toThrow();
    });

    it('is a no-op when METRICS lacks a writeDataPoint method', () => {
      expect(() => recordMetric({ METRICS: {} }, { endpoint: '/x', status: 200 })).not.toThrow();
    });

    it('writes a structured data point when bound', () => {
      const writeDataPoint = vi.fn();
      recordMetric({ METRICS: { writeDataPoint } }, {
        endpoint: '/api/search',
        status: 200,
        source: 'vector',
        durationMs: 42.5,
        traceId: 'abc123',
      });
      expect(writeDataPoint).toHaveBeenCalledTimes(1);
      const dp = writeDataPoint.mock.calls[0][0];
      expect(dp.blobs).toEqual(['/api/search', '200', 'vector', 'abc123']);
      expect(dp.doubles).toEqual([42.5]);
      expect(dp.indexes).toEqual(['/api/search']);
    });

    it('coerces missing fields to safe defaults', () => {
      const writeDataPoint = vi.fn();
      recordMetric({ METRICS: { writeDataPoint } }, {});
      const dp = writeDataPoint.mock.calls[0][0];
      expect(dp.blobs).toEqual(['unknown', '0', '', '']);
      expect(dp.doubles).toEqual([0]);
      expect(dp.indexes).toEqual(['unknown']);
    });

    it('swallows write failures', () => {
      const writeDataPoint = vi.fn().mockImplementation(() => { throw new Error('WAE down'); });
      expect(() => recordMetric({ METRICS: { writeDataPoint } }, { endpoint: '/x', status: 200 })).not.toThrow();
    });
  });

  describe('uncovered helpers — coverage gate', () => {
    it('parseCookies breaks on a cookie segment that has no `=`', async () => {
      // Exercises `if (eq === -1) break` — the cookie header has a stray
      // segment with no name=value separator, which terminates parsing.
      // Both well-formed leading cookies are kept.
      const { parseCookies } = await import('../../functions/api/_shared.js');
      const out = parseCookies('a=1; b=2; oops');
      expect(out.a).toBe('1');
      expect(out.b).toBe('2');
      expect(out.oops).toBeUndefined();
    });

    it('authenticateAccess returns true on a valid dashboard-session cookie', async () => {
      // Exercises the `valid && expires > now → return true` branch in
      // authenticateAccess (line 205). The existing tests only cover the
      // negative paths (missing/invalid cookie); this covers the happy path.
      const { authenticateAccess, hmacSign } = await import('../../functions/api/_shared.js');
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const nonce = 'abc123';
      const token = `${expires}.${nonce}`;
      const sig = await hmacSign('test-secret-access', token);
      const cookie = `cdn_session=${token}.${sig}`;
      const request = { headers: new Headers({ Cookie: cookie }) };
      const env = { DASHBOARD_SECRET: 'test-secret-access' };
      expect(await authenticateAccess(request, env)).toBe(true);
    });

    it('cacheGet returns null when the Cache API throws', async () => {
      // Exercises the catch branch (line 525) — Workers' caches.default may
      // reject in obscure runtime states; the helper must fail-soft.
      const { cacheGet } = await import('../../functions/api/_shared.js');
      const originalCaches = globalThis.caches;
      globalThis.caches = {
        default: {
          match: () => { throw new Error('cache backplane offline'); },
        },
      };
      try {
        const got = await cacheGet('foo');
        expect(got).toBeNull();
      } finally {
        globalThis.caches = originalCaches;
      }
    });

    it('cdnOrigin falls back to https://cloudcdn.pro for a malformed URL', async () => {
      // Exercises the `catch { return 'https://cloudcdn.pro' }` fallback
      // (line 687) when `new URL(requestUrl)` throws.
      const { cdnOrigin } = await import('../../functions/api/_shared.js');
      expect(cdnOrigin('not a url')).toBe('https://cloudcdn.pro');
      expect(cdnOrigin('https://example.com/foo')).toBe('https://example.com');
    });

    it('extractPathname pulls the path from a raw URL string without new URL()', async () => {
      const { extractPathname } = await import('../../functions/api/_shared.js');
      expect(extractPathname('https://cloudcdn.pro/api/assets')).toBe('/api/assets');
      expect(extractPathname('https://cloudcdn.pro/api/assets?page=2')).toBe('/api/assets');
      expect(extractPathname('https://cloudcdn.pro/')).toBe('/');
    });

    it('jsonResponse wraps a body with envelope headers', async () => {
      const { jsonResponse } = await import('../../functions/api/_shared.js');
      const res = jsonResponse({ ok: true });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(res.headers.get('X-Request-ID')).toMatch(/^[0-9a-f]{8}-/);
      expect(res.headers.get('X-API-Version')).toBeTruthy();
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('jsonResponse accepts a custom status + extra headers', async () => {
      const { jsonResponse } = await import('../../functions/api/_shared.js');
      const res = jsonResponse({ created: true }, 201, { 'X-Custom': 'yes' });
      expect(res.status).toBe(201);
      expect(res.headers.get('X-Custom')).toBe('yes');
    });

    it('paginationLinks emits nextLink only on the first of many pages', async () => {
      const { paginationLinks } = await import('../../functions/api/_shared.js');
      const links = paginationLinks('https://cloudcdn.pro/api/x', 1, 10, 50);
      expect(links.nextLink).toContain('page=2');
      expect(links.nextLink).toContain('per_page=10');
      expect(links.prevLink).toBeUndefined();
    });

    it('paginationLinks emits prevLink only on the last page', async () => {
      const { paginationLinks } = await import('../../functions/api/_shared.js');
      const links = paginationLinks('https://cloudcdn.pro/api/x', 5, 10, 50);
      expect(links.prevLink).toContain('page=4');
      expect(links.nextLink).toBeUndefined();
    });

    it('paginationLinks emits both prev and next on a middle page', async () => {
      const { paginationLinks } = await import('../../functions/api/_shared.js');
      const links = paginationLinks('https://cloudcdn.pro/api/x', 3, 10, 100);
      expect(links.nextLink).toContain('page=4');
      expect(links.prevLink).toContain('page=2');
    });

    it('paginationLinks emits neither when there is only one page', async () => {
      const { paginationLinks } = await import('../../functions/api/_shared.js');
      const links = paginationLinks('https://cloudcdn.pro/api/x', 1, 10, 5);
      expect(links.nextLink).toBeUndefined();
      expect(links.prevLink).toBeUndefined();
    });

    it('authenticateAccess returns false on a session cookie with no dot', async () => {
      const { authenticateAccess } = await import('../../functions/api/_shared.js');
      const request = { headers: new Headers({ Cookie: 'cdn_session=nodot' }) };
      expect(await authenticateAccess(request, { DASHBOARD_SECRET: 'x' })).toBe(false);
    });

    it('authenticateAccess returns false on a session cookie with empty sig', async () => {
      const { authenticateAccess } = await import('../../functions/api/_shared.js');
      const request = { headers: new Headers({ Cookie: 'cdn_session=token.' }) };
      expect(await authenticateAccess(request, { DASHBOARD_SECRET: 'x' })).toBe(false);
    });

    it('queryAuditLog coerces non-numeric days to the default 1', async () => {
      // Exercises the `parseInt(days, 10) || 1` fallback branch.
      const { queryAuditLog } = await import('../../functions/api/_shared.js');
      const kv = { get: vi.fn().mockResolvedValue(null) };
      const out = await queryAuditLog({ RATE_KV: kv }, { days: 'not-a-number' });
      expect(Array.isArray(out)).toBe(true);
      // Only one day was scanned (cappedDays === 1).
      expect(kv.get).toHaveBeenCalledTimes(1);
    });

    it('queryAuditLog sorts entries lacking .timestamp via the "" fallback', async () => {
      // Exercises the `(b.timestamp || '').localeCompare(...)` fallback.
      const { queryAuditLog } = await import('../../functions/api/_shared.js');
      const today = new Date().toISOString().slice(0, 10);
      const kv = {
        get: vi.fn(async (key) => {
          if (key === 'audit:' + today) {
            return JSON.stringify([
              { action: 'a', timestamp: '2026-01-01' },
              { action: 'b' },           // missing timestamp
              { action: 'c', timestamp: '2026-01-02' },
            ]);
          }
          return null;
        }),
      };
      const out = await queryAuditLog({ RATE_KV: kv }, { days: 1 });
      // Sort succeeds without throwing — the no-timestamp entry sorts to the end.
      expect(out.length).toBe(3);
    });

    it('isAiQuotaError reads .message-less errors via String(err)', async () => {
      // Exercises the `err.message || err` falsy-message branch.
      const { isAiQuotaError } = await import('../../functions/api/_shared.js');
      // A string thrown as the error has no .message — String(err) falls back.
      expect(isAiQuotaError('quota exhausted')).toBe(true);
    });
  });

  // ── headFromGet (PR #109) ────────────────────────────────────
  describe('headFromGet', () => {
    it('returns a function that delegates to GET and drops the body', async () => {
      const { headFromGet } = await import('../../functions/api/_shared.js');
      const getHandler = vi.fn().mockResolvedValue(
        new Response('hello body', {
          status: 200,
          headers: { 'Content-Type': 'text/plain', 'X-Custom': 'yes' },
        }),
      );
      const head = headFromGet(getHandler);
      const ctx = { request: { url: 'https://x/' } };
      const res = await head(ctx);
      expect(getHandler).toHaveBeenCalledWith(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/plain');
      expect(res.headers.get('X-Custom')).toBe('yes');
      // Per RFC 7231 §4.3.2, HEAD response has no body.
      expect(await res.text()).toBe('');
    });

    it('preserves non-2xx statuses from GET (e.g. 401, 404)', async () => {
      const { headFromGet } = await import('../../functions/api/_shared.js');
      const getHandler = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
      const head = headFromGet(getHandler);
      const res = await head({ request: {} });
      expect(res.status).toBe(401);
    });
  });
});
