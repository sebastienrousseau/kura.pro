/**
 * CORS consistency — verifies every endpoint returns proper CORS headers.
 *
 * Tests: OPTIONS returns 204, responses have Access-Control-Allow-Origin,
 * OPTIONS includes Allow-Methods and Allow-Headers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearManifestCache } from '../../../functions/api/_shared.js';

const zonesModule = await import('../../../functions/api/core/zones.js');
const zoneDetailModule = await import('../../../functions/api/core/zones/[[id]].js');
const statsModule = await import('../../../functions/api/core/statistics.js');
const rulesModule = await import('../../../functions/api/core/rules.js');
const storageModule = await import('../../../functions/api/storage/[[path]].js');
const batchModule = await import('../../../functions/api/storage/batch.js');
const assetsModule = await import('../../../functions/api/assets.js');
const metadataModule = await import('../../../functions/api/assets/metadata.js');
const streamModule = await import('../../../functions/api/stream.js');

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
];

const originalFetch = globalThis.fetch;

beforeEach(() => clearManifestCache());
afterEach(() => { globalThis.fetch = originalFetch; });

describe('CORS — Every OPTIONS handler returns 204', () => {
  const optionsHandlers = [
    { name: 'zones', fn: () => zonesModule.onRequestOptions() },
    { name: 'zoneDetail', fn: () => zoneDetailModule.onRequestOptions() },
    { name: 'statistics', fn: () => statsModule.onRequestOptions() },
    { name: 'rules', fn: () => rulesModule.onRequestOptions() },
    { name: 'storage', fn: () => storageModule.onRequestOptions() },
    { name: 'batch', fn: () => batchModule.onRequestOptions() },
    { name: 'assets', fn: () => assetsModule.onRequestOptions() },
    { name: 'metadata', fn: () => metadataModule.onRequestOptions() },
    { name: 'stream', fn: () => streamModule.onRequestOptions() },
  ];

  for (const { name, fn } of optionsHandlers) {
    it(`${name} OPTIONS returns 204`, async () => {
      const res = await fn();
      expect(res.status).toBe(204);
    });
  }
});

describe('CORS — Every response has Access-Control-Allow-Origin', () => {
  it('zones GET response has ACAO header', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones', method: 'GET', headers: new Headers({ AccountKey: 'acct-key' }) },
      env: {
        ACCOUNT_KEY: 'acct-key',
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) },
      },
      params: {},
    };
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('storage GET response has ACAO header', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/clients/', method: 'GET', headers: new Headers({ AccessKey: 'key' }), arrayBuffer: vi.fn() },
      params: { path: ['clients', ''] },
      env: {
        STORAGE_KEY: 'key',
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) },
      },
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('assets GET response has ACAO header', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets', headers: new Headers({ AccessKey: 'key' }) },
      env: {
        STORAGE_KEY: 'key',
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) },
      },
    };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('stream GET response has ACAO header', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/stream?video=black' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('401 error responses have ACAO header', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones', method: 'GET', headers: new Headers() },
      env: { ACCOUNT_KEY: 'acct-key', RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() }, ASSETS: { fetch: vi.fn() } },
      params: {},
    };
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('CORS — OPTIONS includes Allow-Methods and Allow-Headers', () => {
  it('zones OPTIONS has methods and headers', async () => {
    const res = await zonesModule.onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('AccountKey');
  });

  it('storage OPTIONS has methods and headers', async () => {
    const res = await storageModule.onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('AccessKey');
  });

  it('batch OPTIONS has methods and headers', async () => {
    const res = await batchModule.onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('AccessKey');
  });

  it('assets OPTIONS has methods and headers', async () => {
    const res = await assetsModule.onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('AccessKey');
  });

  it('stream OPTIONS has methods', async () => {
    const res = await streamModule.onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('all OPTIONS responses include Max-Age', async () => {
    const handlers = [
      zonesModule.onRequestOptions,
      rulesModule.onRequestOptions,
      storageModule.onRequestOptions,
      batchModule.onRequestOptions,
      assetsModule.onRequestOptions,
      metadataModule.onRequestOptions,
    ];
    for (const fn of handlers) {
      const res = await fn();
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    }
  });
});

describe('CORS — Error responses always have ACAO', () => {
  it('storage 400 (path traversal) has CORS', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/../etc/passwd', method: 'GET', headers: new Headers({ AccessKey: 'key' }) },
      params: { path: ['..', 'etc', 'passwd'] },
      env: { STORAGE_KEY: 'key', ASSETS: { fetch: vi.fn() } },
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('storage 404 has CORS', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/clients/test/missing.svg', method: 'GET', headers: new Headers({ AccessKey: 'key' }) },
      params: { path: ['clients', 'test', 'missing.svg'] },
      env: {
        STORAGE_KEY: 'key',
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('not found', { status: 404 })) },
      },
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('storage 501 has CORS', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/clients/test/file.svg', method: 'PUT', headers: new Headers({ AccessKey: 'key' }), arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)) },
      params: { path: ['clients', 'test', 'file.svg'] },
      env: { STORAGE_KEY: 'key' },
    };
    const res = await storageModule.onRequestPut(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('batch 400 has CORS', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/batch', method: 'POST', headers: new Headers({ AccessKey: 'key', 'Content-Type': 'application/json' }), json: vi.fn().mockResolvedValue({ files: [] }) },
      env: { STORAGE_KEY: 'key', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r/r' },
      waitUntil: vi.fn(),
    };
    const res = await batchModule.onRequestPost(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('metadata 400 has CORS', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata', headers: new Headers({ AccessKey: 'key' }) },
      env: { STORAGE_KEY: 'key', ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('[]', { status: 200 })) } },
    };
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('metadata 404 has CORS', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata?path=nonexistent.svg', headers: new Headers({ AccessKey: 'key' }) },
      env: { STORAGE_KEY: 'key', ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) } },
    };
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('zoneDetail 404 has CORS', async () => {
    clearManifestCache();
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones/nonexistent', method: 'GET', headers: new Headers({ AccountKey: 'acct-key' }) },
      params: { id: ['nonexistent'] },
      env: { ACCOUNT_KEY: 'acct-key', ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) } },
    };
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('statistics 401 has CORS', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/statistics', method: 'GET', headers: new Headers() },
      env: { ACCOUNT_KEY: 'key', RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } },
    };
    const res = await statsModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rules 401 has CORS', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/rules', method: 'GET', headers: new Headers() },
      env: { ACCOUNT_KEY: 'key' },
    };
    const res = await rulesModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('CORS — OPTIONS response body is empty', () => {
  const optionsHandlers = [
    ['zones', zonesModule.onRequestOptions],
    ['zoneDetail', zoneDetailModule.onRequestOptions],
    ['statistics', statsModule.onRequestOptions],
    ['rules', rulesModule.onRequestOptions],
    ['storage', storageModule.onRequestOptions],
    ['batch', batchModule.onRequestOptions],
    ['assets', assetsModule.onRequestOptions],
    ['metadata', metadataModule.onRequestOptions],
    ['stream', streamModule.onRequestOptions],
  ];

  for (const [name, fn] of optionsHandlers) {
    it(`${name} OPTIONS has no body`, async () => {
      const res = await fn();
      const text = await res.text();
      expect(text).toBe('');
    });
  }
});
