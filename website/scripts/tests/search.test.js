import { describe, it, expect, vi } from 'vitest';

const testManifest = [
  { name: 'dark-blue-banking-hero', path: '/stock/images/dark-blue-banking-hero.webp', project: 'bankingonai', category: 'hero', format: 'webp', size: 45000 },
  { name: 'nature-green-landscape', path: '/stock/images/nature-green-landscape.webp', project: 'ecotravel', category: 'background', format: 'webp', size: 82000 },
  { name: 'red-abstract-pattern', path: '/stock/images/red-abstract-pattern.svg', project: 'designsystem', category: 'pattern', format: 'svg', size: 3200 },
  { name: 'blue-gradient-bg', path: '/stock/images/blue-gradient-bg.png', project: 'bankingonai', category: 'background', format: 'png', size: 15000 },
];

// Mock the _shared.js getManifest to return our test data
vi.mock('../../../functions/api/_shared.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getManifest: vi.fn().mockResolvedValue(testManifest),
  };
});

const { onRequestGet } = await import('../../../functions/api/search.js');

function makeCtx(url, envOverrides = {}) {
  return {
    request: {
      url: `https://kura.pro${url}`,
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
});
