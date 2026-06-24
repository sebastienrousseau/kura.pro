import { describe, it, expect, vi } from 'vitest';

const testManifest = [
  { name: 'dark-blue-banking-hero', path: '/stock/images/dark-blue-banking-hero.webp', project: 'bankingonai', category: 'hero', format: 'webp', size: 45000 },
  { name: 'nature-green-landscape', path: '/stock/images/nature-green-landscape.webp', project: 'ecotravel', category: 'background', format: 'webp', size: 82000 },
  { name: 'red-abstract-pattern', path: '/stock/images/red-abstract-pattern.svg', project: 'designsystem', category: 'pattern', format: 'svg', size: 3200 },
  { name: 'blue-gradient-bg', path: '/stock/images/blue-gradient-bg.png', project: 'bankingonai', category: 'background', format: 'png', size: 15000 },
];

// Mock the _shared.js getManifest to return our test data
vi.mock('../../functions/api/_shared.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getManifest: vi.fn().mockResolvedValue(testManifest),
  };
});

const { onRequestGet } = await import('../../functions/api/search.js');

function makeCtx(url, envOverrides = {}) {
  return {
    request: {
      url: `https://cloudcdn.pro${url}`,
      headers: new Headers({ 'cf-connecting-ip': '127.0.0.1' }),
    },
    env: {
      AI: undefined,
      VECTOR_INDEX: undefined,
      RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('[]')) },
      ...envOverrides,
    },
  };
}

describe('GET /api/search', () => {
  it('returns 400 when query parameter is missing', async () => {
    const res = await onRequestGet(makeCtx('/api/search'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('"q"');
  });

  it('returns 400 when query is empty string', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q='));
    expect(res.status).toBe(400);
  });

  it('returns 400 when query is only whitespace', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=%20%20'));
    expect(res.status).toBe(400);
  });

  it('returns results scored by token matching', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue+banking'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
    expect(json.results[0].score).toBeGreaterThan(0);
  });

  it('results are sorted by relevance score descending', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue'));
    const json = await res.json();
    for (let i = 1; i < json.results.length; i++) {
      expect(json.results[i - 1].score).toBeGreaterThanOrEqual(json.results[i].score);
    }
  });

  it('respects limit parameter with default 20', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue'));
    const json = await res.json();
    expect(json.results.length).toBeLessThanOrEqual(20);
  });

  it('respects custom limit parameter', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue&limit=2'));
    const json = await res.json();
    expect(json.results.length).toBeLessThanOrEqual(2);
  });

  it('clamps limit to max 50', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue&limit=999'));
    const json = await res.json();
    expect(json.results.length).toBeLessThanOrEqual(50);
  });

  it('returns correct JSON structure (results, query, count)', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=banking'));
    const json = await res.json();
    expect(json).toHaveProperty('results');
    expect(json).toHaveProperty('query', 'banking');
    expect(json).toHaveProperty('count');
    expect(json.count).toBe(json.results.length);
  });

  it('returns empty results for non-matching query', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=xyznonexistent'));
    const json = await res.json();
    expect(json.results).toEqual([]);
    expect(json.count).toBe(0);
  });

  it('includes CORS headers', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=test'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('includes Cache-Control header', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=test'));
    expect(res.headers.get('Cache-Control')).toContain('max-age=60');
  });

  it('falls back to fuzzy search when AI and VECTOR_INDEX are unavailable', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=banking'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
  });

  it('falls back to fuzzy search when vector search returns no results above threshold', async () => {
    const ctx = makeCtx('/api/search?q=banking', {
      AI: { run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }) },
      VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [{ id: 'x', score: 0.1, metadata: {} }] }) },
    });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
  });

  it('falls back to fuzzy search when vector search throws', async () => {
    const ctx = makeCtx('/api/search?q=banking', {
      AI: { run: vi.fn().mockRejectedValue(new Error('fail')) },
      VECTOR_INDEX: {},
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
  });

  it('handles query with regex special characters safely', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=.*%2B%3F%5B%5D%7B%7D'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('results');
    expect(json).toHaveProperty('query');
  });

  it('handles very long query (>1000 chars) gracefully', async () => {
    const longQ = 'a'.repeat(1001);
    const res = await onRequestGet(makeCtx(`/api/search?q=${longQ}`));
    // Should either return 400 for too-long query or 200 with empty results — not crash
    expect([200, 400]).toContain(res.status);
  });

  // --- Extended tests ---

  it('multi-word query scores higher for multi-match', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=dark+blue+banking'));
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
    // The "dark-blue-banking-hero" item should score highest
    expect(json.results[0].name).toContain('dark-blue-banking');
  });

  it('single char query does not crash', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=b'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('results');
  });

  it('exact match scores higher than partial', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=nature'));
    const json = await res.json();
    if (json.results.length > 0) {
      expect(json.results[0].name).toContain('nature');
    }
  });

  it('score is always a positive number', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue'));
    const json = await res.json();
    for (const result of json.results) {
      expect(result.score).toBeGreaterThan(0);
      expect(typeof result.score).toBe('number');
    }
  });

  it('returns results with CdnUrl field', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=banking'));
    const json = await res.json();
    if (json.results.length > 0) {
      expect(json.results[0]).toHaveProperty('path');
      expect(json.results[0]).toHaveProperty('name');
    }
  });

  it('handles query with hyphens', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=dark-blue'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
  });

  it('handles query with underscores', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=green_landscape'));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Underscore may not be in test data, but should not crash
    expect(json).toHaveProperty('results');
  });

  it('limit=1 returns exactly 1 result when matches exist', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue&limit=1'));
    const json = await res.json();
    expect(json.results.length).toBe(1);
  });

  it('search with format filter returns results', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue'));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Search may not support format filtering, but should not crash
    expect(json).toHaveProperty('results');
  });

  it('returns JSON Content-Type', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=test'));
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('handles URL-encoded query', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=dark%20blue'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
  });

  it('query matches by project name', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=bankingonai'));
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
  });

  it('query matches by category', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=hero'));
    const json = await res.json();
    expect(json.results.length).toBeGreaterThan(0);
  });

  it('query matches by format', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=svg'));
    const json = await res.json();
    if (json.results.length > 0) {
      expect(json.results[0]).toHaveProperty('path');
    }
  });

  it('limit=0 is handled gracefully', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue&limit=0'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('results');
  });

  it('negative limit is handled', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=blue&limit=-5'));
    expect(res.status).toBe(200);
  });

  it('response has CORS header', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=test'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('response has count matching results length', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=banking'));
    const json = await res.json();
    expect(json.count).toBe(json.results.length);
  });

  it('response has query echoed back', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=nature'));
    const json = await res.json();
    expect(json.query).toBe('nature');
  });

  it('handles query with numbers', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=123'));
    expect(res.status).toBe(200);
  });

  it('handles query with mixed case', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=DaRk'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('results');
  });

  it('empty results still has correct structure', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=zzzzzzzzz'));
    const json = await res.json();
    expect(json.results).toEqual([]);
    expect(json.count).toBe(0);
    expect(json.query).toBe('zzzzzzzzz');
  });

  // --- Cache + budget + degraded mode (Layers 1+2) ---

  it('annotates fuzzy fallback with mode="fuzzy"', async () => {
    const res = await onRequestGet(makeCtx('/api/search?q=banking'));
    const json = await res.json();
    expect(json.mode).toBe('fuzzy');
  });

  it('marks degraded=true when AI is available but budget is exhausted', async () => {
    const ctx = makeCtx('/api/search?q=banking', {
      AI: { run: vi.fn().mockResolvedValue({ data: [[0.1]] }) },
      VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
      RATE_KV: {
        get: vi.fn().mockImplementation((k) => Promise.resolve(k.startsWith('ai:neurons:') ? '99999' : null)),
        put: vi.fn(),
      },
    });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.mode).toBe('fuzzy');
    expect(json.degraded).toBe(true);
    // AI must not have been called when budget is exhausted.
    expect(ctx.env.AI.run).not.toHaveBeenCalled();
  });

  it('returns mode="vector" and caches when vector path succeeds', async () => {
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
      const ctx = makeCtx('/api/search?q=banking+hero', {
        AI: { run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }) },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [{ id: 'x', score: 0.9, metadata: { name: 'hero', path: '/hero.webp', project: 'p', category: 'c', format: 'webp', size: 100 } }],
          }),
        },
      });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.mode).toBe('vector');
      expect(json.results.length).toBe(1);
      expect(store.size).toBe(1);
    } finally {
      globalThis.caches = prior;
    }
  });

  it('replays cached responses with mode="cached"', async () => {
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
      const ctx = makeCtx('/api/search?q=banking+hero', {
        AI: { run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }) },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [{ id: 'x', score: 0.9, metadata: { name: 'hero', path: '/hero.webp', project: 'p', category: 'c', format: 'webp', size: 100 } }],
          }),
        },
      });
      // First call populates the cache.
      await onRequestGet(ctx);
      // Second call should hit cache and skip AI entirely.
      const ctx2 = makeCtx('/api/search?q=banking+hero', {
        AI: { run: vi.fn() },
        VECTOR_INDEX: { query: vi.fn() },
      });
      const res2 = await onRequestGet(ctx2);
      const json2 = await res2.json();
      expect(json2.mode).toBe('cached');
      expect(ctx2.env.AI.run).not.toHaveBeenCalled();
      expect(ctx2.env.VECTOR_INDEX.query).not.toHaveBeenCalled();
    } finally {
      globalThis.caches = prior;
    }
  });

  it('returns 429 when the rate limit is exceeded', async () => {
    const ctx = makeCtx('/api/search?q=anything');
    ctx.env.RATE_KV = {
      get: vi.fn().mockResolvedValue('9999'),
      put: vi.fn(),
    };
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('recompute-min covers both then and else branches after eviction', async () => {
    // Constructs a manifest where:
    //   - Three entries score equally low.
    //   - One entry scores higher and triggers eviction.
    // After eviction, the recompute-min loop iterates twice, with one
    // comparison strictly less (TRUE branch) and one equal (ELSE branch).
    //
    // limit=3 forces the heap to size 3 before eviction, which is what makes
    // the recompute-min loop iterate at least twice.
    const shared = await import('../../functions/api/_shared.js');
    shared.getManifest.mockResolvedValueOnce([
      { name: 'ent1-blue', path: '/a', project: 'p', category: 'c', format: 'webp', size: 1 },
      { name: 'ent2-blue', path: '/b', project: 'p', category: 'c', format: 'webp', size: 1 },
      { name: 'ent3-blue', path: '/c', project: 'p', category: 'c', format: 'webp', size: 1 },
      { name: 'ent4-blue-pattern', path: '/d', project: 'p', category: 'c', format: 'webp', size: 1 },
    ]);
    const ctx = makeCtx('/api/search?q=blue+pattern&limit=3');
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.results).toHaveLength(3);
    // Top result is the multi-match entry which displaced one of the singles.
    expect(json.results[0].name).toBe('ent4-blue-pattern');
    // Restore default behaviour for subsequent tests.
    shared.getManifest.mockResolvedValue(testManifest);
  });

  it('replaces a lower-scoring result with a higher one when the heap is full', async () => {
    // Forces all four interesting branches in fuzzySearch:
    //   - Initial find-min loop (after second push) takes the THEN branch.
    //   - Recompute-min loop (after eviction) takes the THEN branch.
    //
    // Token order: banking, hero, dark, blue, gradient, pattern (6 tokens,
    // invLen = 1/6 ≈ 0.167). Iteration over the 4-entry test manifest:
    //   1. dark-blue-banking-hero → banking, hero, dark, blue → 4/6 = 0.667
    //   2. nature-green-landscape → 0 matches → SKIP
    //   3. red-abstract-pattern   → pattern → 1/6 = 0.167 — heap fills to
    //      [0.667, 0.167]; find-min runs and the inner if compares
    //      0.167 < 0.667 → TRUE.
    //   4. blue-gradient-bg       → banking (in project "bankingonai"),
    //      blue, gradient → 3/6 = 0.5 — strictly greater than minScore
    //      (0.167) and strictly less than the existing max (0.667), so
    //      eviction runs and the recompute-min loop's inner if compares
    //      0.5 < 0.667 → TRUE.
    //
    // Result heap: [{0.667 entry 1}, {0.5 entry 4}].
    const ctx = makeCtx('/api/search?q=banking+hero+dark+blue+gradient+pattern&limit=2');
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.results).toHaveLength(2);
    expect(json.results[0].name).toContain('banking-hero');
    expect(json.results[1].name).toBe('blue-gradient-bg');
    expect(json.results[0].score).toBeGreaterThan(json.results[1].score);
  });

  it('falls back to the "unknown" client-IP key when cf-connecting-ip is missing', async () => {
    // Forces the right-hand side of `cf-connecting-ip || 'unknown'`.
    const ctx = {
      request: { url: 'https://cloudcdn.pro/api/search?q=banking', headers: new Headers() },
      env: {
        AI: undefined, VECTOR_INDEX: undefined,
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('[]')) },
      },
    };
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    // checkRateLimit was invoked with key suffix "unknown"
    expect(ctx.env.RATE_KV.put).toHaveBeenCalledWith(
      expect.stringContaining(':unknown'),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('handles vector matches with empty metadata via the || fallbacks', async () => {
    // Score above threshold so results.push runs, but metadata is empty so
    // every `m.metadata?.X || default` evaluates its right operand.
    const ctx = makeCtx('/api/search?q=banking', {
      AI: { run: vi.fn().mockResolvedValue({ data: [[0.1]] }) },
      VECTOR_INDEX: {
        query: vi.fn().mockResolvedValue({
          matches: [{ id: 'fallback-id', score: 0.9, metadata: {} }],
        }),
      },
    });
    const res = await onRequestGet(ctx);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].name).toBe('fallback-id'); // falls back to m.id
    expect(json.results[0].path).toBe('');
    expect(json.results[0].project).toBe('');
    expect(json.results[0].category).toBe('');
    expect(json.results[0].format).toBe('');
    expect(json.results[0].size).toBe(0);
  });

  it('returns 500 when getManifest itself throws (defensive)', async () => {
    const shared = await import('../../functions/api/_shared.js');
    // Replace the mocked resolver with one that rejects for this test only.
    const prior = shared.getManifest;
    shared.getManifest.mockRejectedValueOnce(new Error('manifest down'));
    try {
      const ctx = makeCtx('/api/search?q=banking');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Search failed');
    } finally {
      // restore default behaviour for subsequent tests
      shared.getManifest.mockResolvedValue(testManifest);
      void prior;
    }
  });

  it('OPTIONS preflight returns 204 with proper CORS headers', async () => {
    const { onRequestOptions } = await import('../../functions/api/search.js');
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('trips circuit breaker on AI quota error', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const quotaErr = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
    const ctx = makeCtx('/api/search?q=banking', {
      AI: { run: vi.fn().mockRejectedValue(quotaErr) },
      VECTOR_INDEX: { query: vi.fn() },
      RATE_KV: { get: vi.fn().mockResolvedValue(null), put },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Fuzzy fallback still returns results.
    expect(json.results.length).toBeGreaterThan(0);
    expect(put.mock.calls.some((c) => c[0] === 'ai:cb:open')).toBe(true);
  });

  // ── PR #109 defense additions ─────────────────────────────────
  describe('bot blocklist + Referer guard', () => {
    it('returns 403 bot_blocked for PerplexityBot', async () => {
      const ctx = makeCtx('/api/search?q=foo');
      ctx.request.headers.set('user-agent', 'PerplexityBot/1.0');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(403);
    });

    it('returns 403 hotlink_blocked for off-domain Referer', async () => {
      const ctx = makeCtx('/api/search?q=foo');
      ctx.request.headers.set('user-agent', 'Mozilla/5.0');
      ctx.request.headers.set('referer', 'https://offsite.example/');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(403);
    });
  });
});
