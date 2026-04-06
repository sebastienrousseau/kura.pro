/**
 * Error response consistency — verifies all error responses follow the standard format.
 *
 * Tests: HttpCode + Message fields, 401 mentions authentication,
 * 429 is rate limit, messages are 150+ chars, and JSON is valid.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearManifestCache, errorResponse } from '../../functions/api/_shared.js';

const zonesModule = await import('../../functions/api/core/zones.js');
const zoneDetailModule = await import('../../functions/api/core/zones/[[id]].js');
const statsModule = await import('../../functions/api/core/statistics.js');
const rulesModule = await import('../../functions/api/core/rules.js');
const storageModule = await import('../../functions/api/storage/[[path]].js');
const batchModule = await import('../../functions/api/storage/batch.js');
const assetsModule = await import('../../functions/api/assets.js');
const metadataModule = await import('../../functions/api/assets/metadata.js');
const transformModule = await import('../../functions/api/transform.js');

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
];

const originalFetch = globalThis.fetch;

function env(overrides = {}) {
  return {
    ACCOUNT_KEY: 'acct-key-123',
    STORAGE_KEY: 'stor-key-456',
    RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) },
    ...overrides,
  };
}

beforeEach(() => clearManifestCache());
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Error Format — Every 400 response has HttpCode + Message', () => {
  it('storage path traversal returns HttpCode and Message', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/../etc/passwd', method: 'GET', headers: new Headers({ AccessKey: 'stor-key-456' }), arrayBuffer: vi.fn() },
      params: { path: ['..', '..', 'etc', 'passwd'] },
      env: env(),
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.HttpCode).toBe(400);
    expect(typeof json.Message).toBe('string');
  });

  it('zone creation with short name returns HttpCode and Message', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/core/zones',
        method: 'POST',
        headers: new Headers({ AccountKey: 'acct-key-123', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ Name: 'x' }),
      },
      params: {},
      env: env({ GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' }),
    };
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.HttpCode).toBe(400);
    expect(typeof json.Message).toBe('string');
  });

  it('metadata without path returns HttpCode and Message', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata', headers: new Headers({ AccessKey: 'stor-key-456' }) },
      env: env(),
    };
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.HttpCode).toBe(400);
    expect(typeof json.Message).toBe('string');
  });

  it('batch with empty files returns HttpCode and Message', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/batch',
        method: 'POST',
        headers: new Headers({ AccessKey: 'stor-key-456', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ files: [] }),
      },
      env: env({ GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r' }),
      waitUntil: vi.fn(),
    };
    const res = await batchModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.HttpCode).toBe(400);
    expect(typeof json.Message).toBe('string');
  });
});

describe('Error Format — Every 401 response mentions authentication', () => {
  it('storage 401 mentions authentication', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/clients/', method: 'GET', headers: new Headers(), arrayBuffer: vi.fn() },
      params: { path: ['clients', ''] },
      env: env(),
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.Message.toLowerCase()).toContain('authenticat');
  });

  it('zones 401 mentions authentication', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones', method: 'GET', headers: new Headers() },
      env: env(),
      params: {},
    };
    const res = await zonesModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.Message.toLowerCase()).toContain('authenticat');
  });

  it('assets 401 mentions authentication', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets', headers: new Headers() },
      env: env(),
    };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.Message.toLowerCase()).toContain('authenticat');
  });
});

describe('Error Format — Every 429 response is rate limit', () => {
  it('errorResponse helper produces 429 with Retry-After', () => {
    const res = errorResponse(429, 'TooManyRequests', 'Rate limit exceeded for this endpoint. Maximum requests per minute per IP address reached. Wait before retrying. This limit protects the service from abuse.', { retryAfter: '60', limit: 100 });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('transform 429 has rate limit error', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' },
      env: { RATE_KV: { get: vi.fn().mockResolvedValue('50000'), put: vi.fn() } },
    };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('limit_reached');
  });
});

describe('Error Format — Messages are 150+ characters', () => {
  it('storage 401 message is 150+ chars', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/clients/', method: 'GET', headers: new Headers(), arrayBuffer: vi.fn() },
      params: { path: ['clients', ''] },
      env: env(),
    };
    const res = await storageModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Message.length).toBeGreaterThanOrEqual(150);
  });

  it('zones 401 message is 150+ chars', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones', method: 'GET', headers: new Headers() },
      env: env(),
      params: {},
    };
    const res = await zonesModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Message.length).toBeGreaterThanOrEqual(150);
  });

  it('metadata 400 message is 150+ chars', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata', headers: new Headers({ AccessKey: 'stor-key-456' }) },
      env: env(),
    };
    const res = await metadataModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Message.length).toBeGreaterThanOrEqual(150);
  });
});

describe('Error Format — JSON is valid in all error responses', () => {
  it('errorResponse helper produces valid JSON', async () => {
    const res = errorResponse(400, 'BadRequest', 'Test message that is quite long and explains the error in detail so that the developer reading it can understand what went wrong and how to fix the issue at hand.');
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
    const json = JSON.parse(text);
    expect(json.HttpCode).toBe(400);
    expect(json.error.code).toBe('BadRequest');
    expect(json.requestId).toBeTruthy();
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('storage 413 returns valid JSON', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/clients/test/huge.bin',
        method: 'PUT',
        headers: new Headers({ AccessKey: 'stor-key-456', 'Content-Length': String(30 * 1024 * 1024) }),
        arrayBuffer: vi.fn(),
      },
      params: { path: ['clients', 'test', 'huge.bin'] },
      env: env(),
    };
    const res = await storageModule.onRequestPut(ctx);
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe('Error Format — Additional error scenarios', () => {
  it('storage 400 (path traversal) returns valid JSON', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/../', method: 'GET', headers: new Headers({ AccessKey: 'stor-key-456' }) },
      params: { path: ['..'] },
      env: env(),
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('batch 413 returns valid JSON', async () => {
    const hugeContent = 'A'.repeat(35_000_000);
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/batch',
        method: 'POST',
        headers: new Headers({ AccessKey: 'stor-key-456', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ files: [{ path: 'clients/test/huge.bin', content: hugeContent, encoding: 'base64' }] }),
      },
      env: env({ GITHUB_TOKEN: 'tok', GITHUB_REPO: 'r/r' }),
      waitUntil: vi.fn(),
    };
    const res = await batchModule.onRequestPost(ctx);
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('storage 501 returns valid JSON', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/clients/test/file.svg',
        method: 'PUT',
        headers: new Headers({ AccessKey: 'stor-key-456' }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      },
      params: { path: ['clients', 'test', 'file.svg'] },
      env: env({ GITHUB_TOKEN: undefined, GITHUB_REPO: undefined }),
    };
    const res = await storageModule.onRequestPut(ctx);
    expect(res.status).toBe(501);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('batch 501 returns valid JSON', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/batch',
        method: 'POST',
        headers: new Headers({ AccessKey: 'stor-key-456', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ files: [{ path: 'clients/test/file.svg', content: 'dGVzdA==', encoding: 'base64' }] }),
      },
      env: env({ GITHUB_TOKEN: undefined, GITHUB_REPO: undefined }),
      waitUntil: vi.fn(),
    };
    const res = await batchModule.onRequestPost(ctx);
    expect(res.status).toBe(501);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('metadata 404 returns valid JSON', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata?path=nonexistent.svg', headers: new Headers({ AccessKey: 'stor-key-456' }) },
      env: env(),
    };
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('zoneDetail 400 (missing ID) returns valid JSON', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones/', method: 'GET', headers: new Headers({ AccountKey: 'acct-key-123' }) },
      params: { id: [] },
      env: env(),
    };
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('zoneDetail 404 returns valid JSON', async () => {
    clearManifestCache();
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones/nonexistent', method: 'GET', headers: new Headers({ AccountKey: 'acct-key-123' }) },
      params: { id: ['nonexistent'] },
      env: env(),
    };
    const res = await zoneDetailModule.onRequestGet(ctx);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('errorResponse includes requestId (UUID format)', async () => {
    const res = errorResponse(500, 'InternalError', 'Something went wrong internally. The server encountered an unexpected condition that prevented it from fulfilling the request. This is typically a transient error.');
    const json = JSON.parse(await res.text());
    expect(json.requestId).toMatch(/^[0-9a-f]{8}-/);
  });

  it('errorResponse includes ISO timestamp', async () => {
    const res = errorResponse(400, 'BadRequest', 'The request parameters are invalid or missing. Review the API documentation for required parameters, acceptable value ranges, and correct data types for this endpoint.');
    const json = JSON.parse(await res.text());
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('errorResponse includes apiVersion', async () => {
    const res = errorResponse(400, 'BadRequest', 'The request parameters are invalid or missing. Review the API documentation for required parameters, acceptable value ranges, and correct data types for this endpoint.');
    const json = JSON.parse(await res.text());
    expect(json.apiVersion).toBeDefined();
  });

  it('errorResponse with extra metadata includes it', () => {
    const res = errorResponse(429, 'RateLimit', 'Too many requests. Rate limit exceeded for this endpoint. Maximum requests per minute per IP address reached. Wait before retrying.', { retryAfter: '30', limit: 50 });
    expect(res.headers.get('Retry-After')).toBe('30');
  });
});
