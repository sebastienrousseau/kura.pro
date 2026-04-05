import { describe, it, expect, vi, beforeEach } from 'vitest';

const { trackRequest, onRequestGet, onRequestPost } = await import(
  '../../../functions/api/analytics.js'
);

function makeKV(data = {}) {
  const store = {};
  return {
    get: vi.fn().mockImplementation((key) => {
      // Check explicit store first (set by put)
      if (store[key] !== undefined) return Promise.resolve(store[key]);
      // Then check seed data patterns
      for (const [pattern, val] of Object.entries(data)) {
        if (key.includes(pattern))
          return Promise.resolve(
            typeof val === 'string' ? val : JSON.stringify(val)
          );
      }
      return Promise.resolve(null);
    }),
    put: vi.fn().mockImplementation((key, val) => {
      store[key] = val;
      return Promise.resolve();
    }),
    _store: store,
  };
}

function makeRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  return {
    url: `https://kura.pro${url}`,
    headers,
    cf: options.cf || {},
    json: options.json ? async () => options.json : undefined,
  };
}

function makeResponse(status = 200, headers = {}) {
  const h = new Headers(headers);
  return { status, headers: h };
}

/* ───── trackRequest() ───── */

describe('trackRequest', () => {
  it('increments hits, bandwidth, top assets, geo, and cache counters', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/img/logo.svg', {
      cf: { country: 'US', cacheStatus: 'HIT' },
    });
    const response = makeResponse(200, { 'content-length': '5000' });

    await trackRequest(env, request, response);

    // Should have called put for hits, bandwidth, top, geo, cache
    expect(kv.put).toHaveBeenCalled();
    const putKeys = kv.put.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.includes('analytics:hits:'))).toBe(true);
    expect(putKeys.some((k) => k.includes('analytics:bandwidth:'))).toBe(true);
    expect(putKeys.some((k) => k.includes('analytics:top:'))).toBe(true);
    expect(putKeys.some((k) => k.includes('analytics:geo:'))).toBe(true);
    expect(putKeys.some((k) => k.includes('analytics:cache:'))).toBe(true);
  });

  it('tracks errors for 4xx status codes', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/missing.png');
    const response = makeResponse(404, { 'content-length': '0' });

    await trackRequest(env, request, response);

    const putKeys = kv.put.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.includes('analytics:errors:'))).toBe(true);
  });

  it('tracks errors for 5xx status codes', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/broken');
    const response = makeResponse(500, { 'content-length': '0' });

    await trackRequest(env, request, response);

    const putKeys = kv.put.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.includes('analytics:errors:'))).toBe(true);
  });

  it('does not track errors for 2xx status codes', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/ok');
    const response = makeResponse(200, { 'content-length': '100' });

    await trackRequest(env, request, response);

    const putKeys = kv.put.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.includes('analytics:errors:'))).toBe(false);
  });

  it('handles missing KV gracefully (no-op)', async () => {
    const env = { RATE_KV: undefined };
    const request = makeRequest('/test');
    const response = makeResponse(200);

    // Should not throw
    await trackRequest(env, request, response);
  });

  it('uses request.cf.country over cf-ipcountry header', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/test', {
      cf: { country: 'DE' },
      headers: { 'cf-ipcountry': 'FR' },
    });
    const response = makeResponse(200, { 'content-length': '0' });

    await trackRequest(env, request, response);

    // Find the geo put call and verify DE was used
    const geoPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:geo:'));
    expect(geoPut).toBeDefined();
    const geoData = JSON.parse(geoPut[1]);
    expect(geoData['DE']).toBe(1);
    expect(geoData['FR']).toBeUndefined();
  });

  it('falls back to cf-ipcountry header when request.cf.country is missing', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/test', {
      cf: {},
      headers: { 'cf-ipcountry': 'JP' },
    });
    const response = makeResponse(200, { 'content-length': '0' });

    await trackRequest(env, request, response);

    const geoPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:geo:'));
    const geoData = JSON.parse(geoPut[1]);
    expect(geoData['JP']).toBe(1);
  });

  it('uses XX when no country info is available', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/test', { cf: {} });
    const response = makeResponse(200, { 'content-length': '0' });

    await trackRequest(env, request, response);

    const geoPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:geo:'));
    const geoData = JSON.parse(geoPut[1]);
    expect(geoData['XX']).toBe(1);
  });

  it('records cache HIT correctly', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/test', { cf: { cacheStatus: 'HIT' } });
    const response = makeResponse(200, { 'content-length': '0' });

    await trackRequest(env, request, response);

    const cachePut = kv.put.mock.calls.find((c) => c[0].includes('analytics:cache:'));
    const cacheData = JSON.parse(cachePut[1]);
    expect(cacheData['hit']).toBe(1);
  });

  it('records cache MISS correctly', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/test', { cf: { cacheStatus: 'MISS' } });
    const response = makeResponse(200, { 'content-length': '0' });

    await trackRequest(env, request, response);

    const cachePut = kv.put.mock.calls.find((c) => c[0].includes('analytics:cache:'));
    const cacheData = JSON.parse(cachePut[1]);
    expect(cacheData['miss']).toBe(1);
  });
});

/* ───── GET /api/analytics ───── */

describe('GET /api/analytics', () => {
  it('returns daily breakdown with correct JSON structure', async () => {
    const kv = makeKV({
      hits: '42',
      bandwidth: '102400',
      top: { '/logo.svg': 10 },
      geo: { US: 20 },
      cache: { hit: 30, miss: 10 },
    });
    const ctx = {
      request: makeRequest('/api/analytics?days=1', {
        headers: { 'x-api-key': 'secret' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'secret' },
    };

    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);

    const json = JSON.parse(await res.text());
    expect(json.days).toBe(1);
    expect(json.data).toHaveLength(1);

    const day = json.data[0];
    expect(day).toHaveProperty('date');
    expect(day).toHaveProperty('hits');
    expect(day).toHaveProperty('bandwidth');
    expect(day.bandwidth).toHaveProperty('bytes');
    expect(day.bandwidth).toHaveProperty('human');
    expect(day).toHaveProperty('top_assets');
    expect(day).toHaveProperty('geo');
    expect(day).toHaveProperty('cache');
    expect(day.cache).toHaveProperty('ratio');
  });

  it('respects days parameter clamped to 1-30', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=3', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };

    const res = await onRequestGet(ctx);
    const json = JSON.parse(await res.text());
    expect(json.days).toBe(3);
    expect(json.data).toHaveLength(3);
  });

  it('clamps days above 30 to 30', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=100', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };

    const res = await onRequestGet(ctx);
    const json = JSON.parse(await res.text());
    expect(json.days).toBe(30);
  });

  it('clamps days below 1 to 1', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=0', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };

    const res = await onRequestGet(ctx);
    const json = JSON.parse(await res.text());
    expect(json.days).toBe(1);
  });

  it('defaults to 7 days when no parameter given', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };

    const res = await onRequestGet(ctx);
    const json = JSON.parse(await res.text());
    expect(json.days).toBe(7);
  });

  it('returns 401 when ANALYTICS_KEY is set but wrong key provided', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics', {
        headers: { 'x-api-key': 'wrong-key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'correct-key' },
    };

    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    const json = JSON.parse(await res.text());
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when ANALYTICS_KEY is set but no key provided', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics'),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'secret' },
    };

    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it('allows access when ANALYTICS_KEY is not set', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=1'),
      env: { RATE_KV: kv },
    };

    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('returns zero values for dates with no data', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=1', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };

    const res = await onRequestGet(ctx);
    const json = JSON.parse(await res.text());
    const day = json.data[0];
    expect(day.hits).toBe(0);
    expect(day.bandwidth.bytes).toBe(0);
    expect(day.bandwidth.human).toBe('0 B');
    expect(day.top_assets).toEqual({});
    expect(day.geo).toEqual({});
    expect(day.cache.ratio).toBe('N/A');
  });
});

/* ───── POST /api/analytics ───── */

describe('POST /api/analytics', () => {
  it('records a hit from request body', async () => {
    const kv = makeKV();
    const ctx = {
      request: {
        json: async () => ({
          path: '/img/hero.webp',
          bytes: 2048,
          country: 'GB',
          cache: 'HIT',
        }),
      },
      env: { RATE_KV: kv },
    };

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    const json = JSON.parse(await res.text());
    expect(json.ok).toBe(true);

    // Verify KV was written to
    expect(kv.put).toHaveBeenCalled();
    const putKeys = kv.put.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.includes('analytics:hits:'))).toBe(true);
    expect(putKeys.some((k) => k.includes('analytics:bandwidth:'))).toBe(true);
  });

  it('uses defaults for missing body fields', async () => {
    const kv = makeKV();
    const ctx = {
      request: { json: async () => ({}) },
      env: { RATE_KV: kv },
    };

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);

    // Geo should default to XX
    const geoPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:geo:'));
    const geoData = JSON.parse(geoPut[1]);
    expect(geoData['XX']).toBe(1);

    // Cache should default to miss
    const cachePut = kv.put.mock.calls.find((c) => c[0].includes('analytics:cache:'));
    const cacheData = JSON.parse(cachePut[1]);
    expect(cacheData['miss']).toBe(1);
  });

  it('handles invalid JSON body', async () => {
    const ctx = {
      request: {
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      },
      env: { RATE_KV: makeKV() },
    };

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    const json = JSON.parse(await res.text());
    expect(json.error).toBeDefined();
  });

  it('records with all fields provided', async () => {
    const kv = makeKV();
    const ctx = {
      request: {
        json: async () => ({
          path: '/stocks/images/hero.webp',
          bytes: 50000,
          country: 'DE',
          cache: 'HIT',
          status: 200,
        }),
      },
      env: { RATE_KV: kv },
    };
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    const json = JSON.parse(await res.text());
    expect(json.ok).toBe(true);
    const geoPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:geo:'));
    const geoData = JSON.parse(geoPut[1]);
    expect(geoData['DE']).toBe(1);
  });
});

/* ───── trackRequest extended ───── */

describe('trackRequest — extended', () => {
  it('trackRequest with 200 status (no error tracking)', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/ok.png', { cf: { country: 'US' } });
    const response = makeResponse(200, { 'content-length': '100' });
    await trackRequest(env, request, response);
    const putKeys = kv.put.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.includes('analytics:errors:'))).toBe(false);
  });

  it('trackRequest with 404 status (error tracked)', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/missing.png', { cf: { country: 'US' } });
    const response = makeResponse(404, { 'content-length': '0' });
    await trackRequest(env, request, response);
    const putKeys = kv.put.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.includes('analytics:errors:'))).toBe(true);
  });

  it('trackRequest with 500 status (error tracked)', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/error', { cf: { country: 'US' } });
    const response = makeResponse(500, { 'content-length': '0' });
    await trackRequest(env, request, response);
    const putKeys = kv.put.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.includes('analytics:errors:'))).toBe(true);
  });

  it('trackRequest with cf.country present uses it', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/test', { cf: { country: 'FR' } });
    const response = makeResponse(200, { 'content-length': '0' });
    await trackRequest(env, request, response);
    const geoPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:geo:'));
    const geoData = JSON.parse(geoPut[1]);
    expect(geoData['FR']).toBe(1);
  });

  it('trackRequest with content-length header records bandwidth', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/big.webp', { cf: { country: 'US' } });
    const response = makeResponse(200, { 'content-length': '50000' });
    await trackRequest(env, request, response);
    const bwPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:bandwidth:'));
    expect(bwPut).toBeDefined();
    expect(parseInt(bwPut[1])).toBe(50000);
  });

  it('trackRequest with no content-length defaults to 0', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/small.svg', { cf: { country: 'US' } });
    const response = makeResponse(200);
    await trackRequest(env, request, response);
    const bwPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:bandwidth:'));
    expect(bwPut).toBeDefined();
    expect(parseInt(bwPut[1])).toBe(0);
  });

  it('trackRequest with pathname passed directly', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/direct/path.png', { cf: { country: 'US' } });
    const response = makeResponse(200, { 'content-length': '100' });
    await trackRequest(env, request, response, '/direct/path.png');
    const topPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:top:'));
    expect(topPut).toBeDefined();
    const topData = JSON.parse(topPut[1]);
    expect(topData['/direct/path.png']).toBe(1);
  });

  it('incrementCounter from 0 (null)', async () => {
    const kv = makeKV();
    const env = { RATE_KV: kv };
    const request = makeRequest('/fresh.svg', { cf: { country: 'US' } });
    const response = makeResponse(200, { 'content-length': '100' });
    await trackRequest(env, request, response);
    const hitsPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:hits:'));
    expect(hitsPut).toBeDefined();
    expect(parseInt(hitsPut[1])).toBe(1);
  });

  it('incrementCounter from existing value', async () => {
    const kv = makeKV({ hits: '41' });
    const env = { RATE_KV: kv };
    const request = makeRequest('/test', { cf: { country: 'US' } });
    const response = makeResponse(200, { 'content-length': '0' });
    await trackRequest(env, request, response);
    const hitsPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:hits:'));
    expect(hitsPut).toBeDefined();
    expect(parseInt(hitsPut[1])).toBe(42);
  });

  it('records geo with multiple countries in existing data', async () => {
    const kv = makeKV({ geo: { US: 5, GB: 3 } });
    const env = { RATE_KV: kv };
    const request = makeRequest('/test', { cf: { country: 'US' } });
    const response = makeResponse(200, { 'content-length': '0' });
    await trackRequest(env, request, response);
    const geoPut = kv.put.mock.calls.find((c) => c[0].includes('analytics:geo:'));
    const geoData = JSON.parse(geoPut[1]);
    expect(geoData['US']).toBe(6);
    expect(geoData['GB']).toBe(3);
  });
});

/* ───── GET /api/analytics extended ───── */

describe('GET /api/analytics — extended', () => {
  it('returns 30 days of data when days=30', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=30', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };
    const res = await onRequestGet(ctx);
    const json = JSON.parse(await res.text());
    expect(json.days).toBe(30);
    expect(json.data).toHaveLength(30);
  });

  it('returns correct CORS headers', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=1', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns correct Content-Type', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=1', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };
    const res = await onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('returns 1 day of data when days=1', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics?days=1', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };
    const res = await onRequestGet(ctx);
    const json = JSON.parse(await res.text());
    expect(json.days).toBe(1);
    expect(json.data).toHaveLength(1);
  });

  it('401 response has valid JSON', async () => {
    const kv = makeKV({});
    const ctx = {
      request: makeRequest('/api/analytics', {
        headers: { 'x-api-key': 'wrong' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'correct' },
    };
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('calculates cache ratio when both hit and miss are present', async () => {
    const kv = makeKV({
      hits: '100',
      cache: { hit: 75, miss: 25 },
    });
    const ctx = {
      request: makeRequest('/api/analytics?days=1', {
        headers: { 'x-api-key': 'key' },
      }),
      env: { RATE_KV: kv, ANALYTICS_KEY: 'key' },
    };
    const res = await onRequestGet(ctx);
    const json = JSON.parse(await res.text());
    expect(json.data[0].cache.ratio).not.toBe('N/A');
  });
});
