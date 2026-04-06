/**
 * ISO 8601 contract — verifies all date fields match ISO 8601 pattern
 * and timestamps are within 5 seconds of current time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearManifestCache } from '../../functions/api/_shared.js';

const zonesModule = await import('../../functions/api/core/zones.js');
const zoneDetailModule = await import('../../functions/api/core/zones/[[id]].js');
const rulesModule = await import('../../functions/api/core/rules.js');
const storageModule = await import('../../functions/api/storage/[[path]].js');
const assetsModule = await import('../../functions/api/assets.js');
const metadataModule = await import('../../functions/api/assets/metadata.js');

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.svg', path: 'akande/v1/banners/banner.svg', project: 'akande', category: 'banners', format: 'svg', size: 5600 },
];

const originalFetch = globalThis.fetch;

function makeEnv(overrides = {}) {
  return {
    RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })) },
    ...overrides,
  };
}

beforeEach(() => clearManifestCache());
afterEach(() => { globalThis.fetch = originalFetch; });

function assertRecentTimestamp(isoStr) {
  const now = Date.now();
  const ts = new Date(isoStr).getTime();
  expect(Math.abs(now - ts)).toBeLessThan(5000);
}

describe('ISO 8601 — zones DateCreated', () => {
  it('zone entries have ISO 8601 DateCreated within 5s of now', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones', method: 'GET', headers: new Headers({ AccountKey: 'key' }) },
      env: makeEnv({ ACCOUNT_KEY: 'key' }),
      params: {},
    };
    const res = await zonesModule.onRequestGet(ctx);
    const zones = await res.json();
    for (const zone of zones) {
      expect(zone.DateCreated).toMatch(ISO_REGEX);
      assertRecentTimestamp(zone.DateCreated);
    }
  });
});

describe('ISO 8601 — zone detail DateCreated', () => {
  it('zone detail has ISO 8601 DateCreated within 5s of now', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones/akande', method: 'GET', headers: new Headers({ AccountKey: 'key' }) },
      env: makeEnv({ ACCOUNT_KEY: 'key' }),
      params: { id: ['akande'] },
    };
    const res = await zoneDetailModule.onRequestGet(ctx);
    const zone = await res.json();
    expect(zone.DateCreated).toMatch(ISO_REGEX);
    assertRecentTimestamp(zone.DateCreated);
  });
});

describe('ISO 8601 — rules DateFetched', () => {
  it('rules response has ISO 8601 DateFetched within 5s of now', async () => {
    const env = makeEnv({ ACCOUNT_KEY: 'key' });
    env.ASSETS.fetch = vi.fn().mockResolvedValue(new Response('/* rules */', { status: 200 }));
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/rules', method: 'GET', headers: new Headers({ AccountKey: 'key' }) },
      env,
      params: {},
    };
    const res = await rulesModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(ISO_REGEX);
    assertRecentTimestamp(json.DateFetched);
  });
});

describe('ISO 8601 — storage list DateCreated and LastChanged', () => {
  it('directory listing entries have ISO dates', async () => {
    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/clients/',
        method: 'GET',
        headers: new Headers({ AccessKey: 'key' }),
        arrayBuffer: vi.fn(),
      },
      params: { path: ['clients', ''] },
      env: makeEnv({ STORAGE_KEY: 'key' }),
    };
    const res = await storageModule.onRequestGet(ctx);
    const entries = await res.json();
    for (const entry of entries) {
      expect(entry.DateCreated).toMatch(ISO_REGEX);
      expect(entry.LastChanged).toMatch(ISO_REGEX);
    }
  });
});

describe('ISO 8601 — assets DateFetched', () => {
  it('assets response has ISO 8601 DateFetched within 5s of now', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets', headers: new Headers({ AccessKey: 'key' }) },
      env: makeEnv({ STORAGE_KEY: 'key' }),
    };
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(ISO_REGEX);
    assertRecentTimestamp(json.DateFetched);
  });
});

describe('ISO 8601 — metadata DateFetched', () => {
  it('metadata response has ISO 8601 DateFetched within 5s of now', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata?path=akande/v1/logos/logo.svg', headers: new Headers({ AccessKey: 'key' }) },
      env: makeEnv({ STORAGE_KEY: 'key' }),
    };
    const res = await metadataModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(ISO_REGEX);
    assertRecentTimestamp(json.DateFetched);
  });
});

describe('ISO 8601 — upload DateCreated', () => {
  it('upload response has ISO 8601 DateCreated within 5s of now', async () => {
    const content = new TextEncoder().encode('<svg>test</svg>');
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 201 }));

    const ctx = {
      request: {
        url: 'https://cloudcdn.pro/api/storage/clients/test/logo.svg',
        method: 'PUT',
        headers: new Headers({ AccessKey: 'key' }),
        arrayBuffer: vi.fn().mockResolvedValue(content.buffer),
      },
      params: { path: ['clients', 'test', 'logo.svg'] },
      env: makeEnv({ STORAGE_KEY: 'key', GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'user/repo' }),
    };
    const res = await storageModule.onRequestPut(ctx);
    const json = await res.json();
    expect(json.DateCreated).toMatch(ISO_REGEX);
    assertRecentTimestamp(json.DateCreated);
  });
});

describe('ISO 8601 — errorResponse timestamp', () => {
  it('shared errorResponse produces ISO 8601 timestamp', async () => {
    const { errorResponse } = await import('../../functions/api/_shared.js');
    const res = errorResponse(400, 'Test', 'A test error message that is long enough to meet the minimum character requirement and provides useful context about what went wrong.');
    const json = await res.json();
    expect(json.timestamp).toMatch(ISO_REGEX);
    assertRecentTimestamp(json.timestamp);
  });
});

describe('ISO 8601 — extended date checks', () => {
  it('zone list entries DateCreated parseable as Date', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones', method: 'GET', headers: new Headers({ AccountKey: 'key' }) },
      env: makeEnv({ ACCOUNT_KEY: 'key' }),
      params: {},
    };
    const res = await zonesModule.onRequestGet(ctx);
    const zones = await res.json();
    for (const zone of zones) {
      const d = new Date(zone.DateCreated);
      expect(d.getTime()).not.toBeNaN();
    }
  });

  it('storage entries LastChanged is parseable Date', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/storage/clients/', method: 'GET', headers: new Headers({ AccessKey: 'key' }) },
      params: { path: ['clients', ''] },
      env: makeEnv({ STORAGE_KEY: 'key' }),
    };
    const res = await storageModule.onRequestGet(ctx);
    const entries = await res.json();
    for (const entry of entries) {
      const d = new Date(entry.LastChanged);
      expect(d.getTime()).not.toBeNaN();
    }
  });

  it('metadata DateFetched is parseable Date', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets/metadata?path=akande/v1/logos/logo.svg', headers: new Headers({ AccessKey: 'key' }) },
      env: makeEnv({ STORAGE_KEY: 'key' }),
    };
    const res = await metadataModule.onRequestGet(ctx);
    const json = await res.json();
    const d = new Date(json.DateFetched);
    expect(d.getTime()).not.toBeNaN();
    expect(d.getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  it('assets DateFetched ends with Z (UTC)', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/assets', headers: new Headers({ AccessKey: 'key' }) },
      env: makeEnv({ STORAGE_KEY: 'key' }),
    };
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(/Z$/);
  });

  it('zone detail DateCreated ends with Z (UTC)', async () => {
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/core/zones/akande', method: 'GET', headers: new Headers({ AccountKey: 'key' }) },
      env: makeEnv({ ACCOUNT_KEY: 'key' }),
      params: { id: ['akande'] },
    };
    const res = await zoneDetailModule.onRequestGet(ctx);
    const zone = await res.json();
    expect(zone.DateCreated).toMatch(/Z$/);
  });
});
