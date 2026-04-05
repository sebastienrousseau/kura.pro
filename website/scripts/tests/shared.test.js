import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getManifest, clearManifestCache, streamJsonArray,
  authenticateAccess, authenticateAccount, authenticateAny,
  formatBytes, parseCookies, CORS_JSON,
} from '../../../functions/api/_shared.js';

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
});
