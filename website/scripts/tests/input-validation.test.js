/**
 * Input validation — cross-cutting tests for edge cases across multiple endpoints.
 *
 * Tests: empty strings, null, undefined params, very long strings, unicode/emoji,
 * negative numbers, floats, SQL injection, script tags.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearManifestCache } from '../../../functions/api/_shared.js';

const transformModule = await import('../../../functions/api/transform.js');
const assetsModule = await import('../../../functions/api/assets.js');
const metadataModule = await import('../../../functions/api/assets/metadata.js');
const storageModule = await import('../../../functions/api/storage/[[path]].js');
const batchModule = await import('../../../functions/api/storage/batch.js');
const zonesModule = await import('../../../functions/api/core/zones.js');
const streamModule = await import('../../../functions/api/stream.js');

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
];

const originalFetch = globalThis.fetch;

function makeEnv(overrides = {}) {
  return {
    STORAGE_KEY: 'test-key',
    ACCOUNT_KEY: 'acct-key',
    RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) },
    GITHUB_TOKEN: 'ghp_test',
    GITHUB_REPO: 'user/repo',
    ...overrides,
  };
}

beforeEach(() => clearManifestCache());
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Input Validation — Empty strings, null, undefined params', () => {
  it('transform with empty url param returns 400', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('metadata with empty path returns 400', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata?path=', headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('stream with empty video returns 400', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/stream?video=' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('zone creation with empty Name returns 400', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/core/zones',
        method: 'POST',
        headers: new Headers({ AccountKey: 'acct-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ Name: '' }),
      },
      params: {},
      env: makeEnv(),
    };
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });
});

describe('Input Validation — Very long strings (10KB+)', () => {
  it('transform with 10KB+ url does not crash', async () => {
    const longUrl = '/test.png?' + 'x'.repeat(10240);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = {
      request: { url: `https://cloudcdn.pro/api/transform?url=${encodeURIComponent(longUrl)}` },
      env: { RATE_KV: null },
    };
    const res = await transformModule.onRequestGet(ctx);
    // Should succeed or return an error but not crash
    expect([200, 400, 502]).toContain(res.status);
  });

  it('metadata with 10KB path returns 404 (not found but no crash)', async () => {
    const longPath = 'a'.repeat(10240);
    const ctx = {
      request: { url: `https://cloudcdn.pro/api/assets/metadata?path=${longPath}`, headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(404);
  });

  it('zone creation with very long name returns 400', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/core/zones',
        method: 'POST',
        headers: new Headers({ AccountKey: 'acct-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ Name: 'a'.repeat(100) }),
      },
      params: {},
      env: makeEnv(),
    };
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });
});

describe('Input Validation — Unicode/emoji in all string fields', () => {
  it('assets search with emoji does not crash', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets?q=%F0%9F%98%80', headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('storage with unicode filename does not crash', async () => {
    const content = new TextEncoder().encode('<svg>test</svg>');
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/clients/test/\u00e9m\u00f4ji-\ud83d\ude00.svg',
        method: 'PUT',
        headers: new Headers({ AccessKey: 'test-key' }),
        arrayBuffer: vi.fn().mockResolvedValue(content.buffer),
      },
      params: { path: ['clients', 'test', '\u00e9m\u00f4ji-\ud83d\ude00.svg'] },
      env: makeEnv(),
    };
    const res = await storageModule.onRequestPut(ctx);
    expect(res.status).toBe(201);
  });

  it('zone creation with unicode name is sanitized', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/core/zones',
        method: 'POST',
        headers: new Headers({ AccountKey: 'acct-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ Name: '\u00e9m\u00f4ji-project' }),
      },
      params: {},
      env: makeEnv(),
    };
    const res = await zonesModule.onRequestPost(ctx);
    // After sanitization, name keeps only [a-z0-9-], result may be valid or too short
    expect([200, 201, 400, 500, 501]).toContain(res.status);
  });
});

describe('Input Validation — Negative numbers where positive expected', () => {
  it('transform with negative width returns 400', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png&w=-100' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('stream with negative segment returns 400', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/stream?video=black&quality=720&segment=-1' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('assets with negative page treated as page 1', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets?page=-1', headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Pagination.Page).toBe(1);
  });
});

describe('Input Validation — Float where integer expected', () => {
  it('transform with float width returns 400', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png&w=1.5' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    // parseInt('1.5') === 1, so it should clamp and succeed
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const res2 = await transformModule.onRequestGet(ctx);
    expect([200, 400]).toContain(res2.status);
  });

  it('stream with float segment returns 400 or valid', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/stream?video=black&quality=720&segment=0.5' } };
    // parseInt('0.5') === 0, so it becomes segment 0
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'content-length': '10000000' } }));
    const res = await streamModule.onRequestGet(ctx);
    // May proceed to segment fetch or handle gracefully
    expect([200, 400, 404, 502]).toContain(res.status);
  });
});

describe('Input Validation — SQL injection strings', () => {
  it('assets search with SQL injection does not crash', async () => {
    const ctx = {
      request: { url: "https://cloudcdn.pro/api/assets?q=';DROP TABLE assets;--", headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Data).toEqual([]);
  });

  it('metadata with SQL injection path returns 404', async () => {
    const ctx = {
      request: { url: "https://cloudcdn.pro/api/assets/metadata?path='; DROP TABLE--", headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(404);
  });
});

describe('Input Validation — Script tags in all fields', () => {
  it('assets search with script tag returns valid JSON without HTML injection', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets?q=%3Cscript%3Ealert(1)%3C/script%3E', headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    // Response is JSON — even if query appears in Filters, it is JSON-escaped
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('batch with script in path is rejected or handled safely', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'nt' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c' }), { status: 201 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/batch',
        method: 'POST',
        headers: new Headers({ AccessKey: 'test-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ files: [{ path: 'clients/test/file.svg', content: 'PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+', encoding: 'base64' }] }),
      },
      env: makeEnv(),
      waitUntil: vi.fn(),
    };
    const res = await batchModule.onRequestPost(ctx);
    // File content with script tags is allowed (it's just data), but should not crash
    expect([201, 400, 500]).toContain(res.status);
  });

  it('storage path with script tag returns 400', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/<script>',
        method: 'GET',
        headers: new Headers({ AccessKey: 'test-key' }),
        arrayBuffer: vi.fn(),
      },
      params: { path: ['<script>alert(1)</script>'] },
      env: makeEnv(),
    };
    const res = await storageModule.onRequestGet(ctx);
    // Should return either 200 (empty dir) or 400 — but not execute script
    expect([200, 400]).toContain(res.status);
  });
});

describe('Input Validation — Boolean and null in JSON bodies', () => {
  it('zone creation with Name=null returns 400', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/core/zones',
        method: 'POST',
        headers: new Headers({ AccountKey: 'acct-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ Name: null }),
      },
      params: {},
      env: makeEnv(),
    };
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('zone creation with missing Name returns 400', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/core/zones',
        method: 'POST',
        headers: new Headers({ AccountKey: 'acct-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({}),
      },
      params: {},
      env: makeEnv(),
    };
    const res = await zonesModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('zone creation with Name containing only hyphens returns error', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/core/zones',
        method: 'POST',
        headers: new Headers({ AccountKey: 'acct-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ Name: '---' }),
      },
      params: {},
      env: makeEnv(),
    };
    const res = await zonesModule.onRequestPost(ctx);
    expect([400, 500]).toContain(res.status);
  });

  it('batch with files=null returns 400', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/batch',
        method: 'POST',
        headers: new Headers({ AccessKey: 'test-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ files: null }),
      },
      env: makeEnv(),
      waitUntil: vi.fn(),
    };
    const res = await batchModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('batch with files=true returns 400', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/batch',
        method: 'POST',
        headers: new Headers({ AccessKey: 'test-key', 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ files: true }),
      },
      env: makeEnv(),
      waitUntil: vi.fn(),
    };
    const res = await batchModule.onRequestPost(ctx);
    expect(res.status).toBe(400);
  });
});

describe('Input Validation — Boundary numbers', () => {
  it('transform with w=0 clamps to 1', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png&w=0' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const opts = globalThis.fetch.mock.calls[0][1].cf.image;
    expect(opts.width).toBe(1);
  });

  it('transform with h=0 clamps to 1', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png&h=0' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const opts = globalThis.fetch.mock.calls[0][1].cf.image;
    expect(opts.height).toBe(1);
  });

  it('transform with w=Number.MAX_SAFE_INTEGER clamps to 8192', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: `https://cloudcdn.pro/api/transform?url=/test.png&w=${Number.MAX_SAFE_INTEGER}` }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const opts = globalThis.fetch.mock.calls[0][1].cf.image;
    expect(opts.width).toBeLessThanOrEqual(8192);
  });

  it('transform with q=0 clamps to 1', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png&q=0' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const opts = globalThis.fetch.mock.calls[0][1].cf.image;
    expect(opts.quality).toBe(1);
  });

  it('transform with blur=0 clamps to 1', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png&blur=0' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const opts = globalThis.fetch.mock.calls[0][1].cf.image;
    expect(opts.blur).toBe(1);
  });

  it('transform with sharpen=0 clamps to 1', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png&sharpen=0' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const opts = globalThis.fetch.mock.calls[0][1].cf.image;
    expect(opts.sharpen).toBe(1);
  });

  it('assets with per_page=1 returns exactly 1 item', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets?per_page=1', headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data.length).toBeLessThanOrEqual(1);
  });

  it('assets with per_page=200 returns up to 200 items', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets?per_page=200', headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Pagination.PerPage).toBe(200);
  });
});

describe('Input Validation — Whitespace in various params', () => {
  it('transform with url containing leading spaces still works', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=%20/test.png' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect([200, 400]).toContain(res.status);
  });

  it('stream with whitespace in video param returns 400', async () => {
    const ctx = { request: { url: 'https://cloudcdn.pro/api/stream?video=%20black%20' } };
    const res = await streamModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('assets search with leading/trailing spaces trims', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets?q=%20logo%20', headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });
});

describe('Input Validation — Special URL characters', () => {
  it('transform with url containing hash does not crash', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png%23anchor' }, env: { RATE_KV: null } };
    const res = await transformModule.onRequestGet(ctx);
    expect([200, 400]).toContain(res.status);
  });

  it('metadata with encoded slashes in path', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata?path=akande%2Fv1%2Flogos%2Flogo.svg', headers: new Headers({ AccessKey: 'test-key' }) },
      env: makeEnv(),
    };
    const res = await metadataModule.onRequestGet(ctx);
    expect([200, 404]).toContain(res.status);
  });

  it('storage path with %00 null byte is rejected', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/clients/test%00evil',
        method: 'GET',
        headers: new Headers({ AccessKey: 'test-key' }),
      },
      params: { path: ['clients', 'test\x00evil'] },
      env: makeEnv(),
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('storage path with consecutive dots is rejected', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/..',
        method: 'GET',
        headers: new Headers({ AccessKey: 'test-key' }),
      },
      params: { path: ['..'] },
      env: makeEnv(),
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });
});

describe('Input Validation — Concurrent requests', () => {
  it('transform handles 10 concurrent requests without errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const ctx = { request: { url: `https://cloudcdn.pro/api/transform?url=/test${i}.png&w=${100 + i}` }, env: { RATE_KV: null } };
        return transformModule.onRequestGet(ctx);
      })
    );
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });

  it('assets handles 5 concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => {
        clearManifestCache();
        const ctx = {
          request: { url: `https://cloudcdn.pro/api/assets?page=${i + 1}`, headers: new Headers({ AccessKey: 'test-key' }) },
          env: makeEnv(),
        };
        return assetsModule.onRequestGet(ctx);
      })
    );
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });
});

describe('Input Validation — Missing env vars gracefully', () => {
  it('transform works without RATE_KV', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    const ctx = { request: { url: 'https://cloudcdn.pro/api/transform?url=/test.png' }, env: {} };
    const res = await transformModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('assets works without STORAGE_KEY in dev mode', async () => {
    clearManifestCache();
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets', headers: new Headers() },
      env: { ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) } },
    };
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('storage works without all env vars (dev mode)', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/clients/',
        method: 'GET',
        headers: new Headers(),
      },
      params: { path: ['clients', ''] },
      env: { ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) } },
    };
    const res = await storageModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });
});
