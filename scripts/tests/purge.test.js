import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestPost } = await import('../../functions/api/purge.js');

const originalFetch = globalThis.fetch;

function makeContext(body, env = {}, headers = {}) {
  return {
    request: {
      headers: {
        get: (name) => {
          const lower = name.toLowerCase();
          if (lower === 'x-api-key') return headers['x-api-key'] ?? null;
          return null;
        },
      },
      json: async () => body,
    },
    env: {
      PURGE_KEY: env.PURGE_KEY ?? 'test-key',
      CLOUDFLARE_ZONE_ID: env.CLOUDFLARE_ZONE_ID ?? 'zone-123',
      CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN ?? 'token-abc',
      RATE_KV: env.RATE_KV ?? {
        get: vi.fn().mockResolvedValue('0'),
        put: vi.fn(),
      },
      ...env,
    },
  };
}

function authedContext(body, envOverrides = {}, extraHeaders = {}) {
  return makeContext(body, envOverrides, { 'x-api-key': 'test-key', ...extraHeaders });
}

describe('POST /api/purge', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- Auth ---
  it('returns 401 when API key is missing', async () => {
    const ctx = makeContext({ purge_everything: true }, {}, {});
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
  });

  it('returns 401 when API key is wrong', async () => {
    const ctx = makeContext({ purge_everything: true }, {}, { 'x-api-key': 'wrong-key' });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  // --- Missing env vars ---
  it('returns 500 when CLOUDFLARE_ZONE_ID is missing', async () => {
    const ctx = authedContext({ purge_everything: true }, {
      CLOUDFLARE_ZONE_ID: undefined,
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('CLOUDFLARE_ZONE_ID');
  });

  it('returns 500 when CLOUDFLARE_API_TOKEN is missing', async () => {
    const ctx = authedContext({ purge_everything: true }, {
      CLOUDFLARE_API_TOKEN: undefined,
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('CLOUDFLARE_API_TOKEN');
  });

  // --- Rate limiting ---
  it('returns 429 when daily purge limit is reached', async () => {
    const ctx = authedContext({ purge_everything: true }, {
      RATE_KV: {
        get: vi.fn().mockResolvedValue('100'),
        put: vi.fn(),
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('Rate limit');
  });

  // --- URL purging ---
  it('purges valid URLs via Cloudflare API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const urls = ['https://cloudcdn.pro/img/a.webp', 'https://cloudcdn.pro/img/b.png'];
    const ctx = authedContext({ urls });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);

    const fetchCall = globalThis.fetch.mock.calls[0];
    expect(fetchCall[0]).toContain('/purge_cache');
    const payload = JSON.parse(fetchCall[1].body);
    expect(payload.files).toEqual(urls);
  });

  it('returns 400 for URLs not starting with allowed prefix', async () => {
    const ctx = authedContext({ urls: ['https://evil.com/bad.png'] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('https://cloudcdn.pro/');
  });

  it('returns 400 for empty URLs array', async () => {
    const ctx = authedContext({ urls: [] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('empty');
  });

  it('returns 400 for more than 30 URLs', async () => {
    const urls = Array.from({ length: 31 }, (_, i) => `https://cloudcdn.pro/img/${i}.png`);
    const ctx = authedContext({ urls });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('max 30');
  });

  // --- Tag purging ---
  it('purges valid tags via Cloudflare API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const tags = ['project-bankingonai', 'type-banner'];
    const ctx = authedContext({ tags });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);

    const payload = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(payload.tags).toEqual(tags);
  });

  it('returns 400 for tags with special characters', async () => {
    const ctx = authedContext({ tags: ['valid-tag', 'invalid tag!'] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('alphanumeric');
  });

  it('returns 400 for more than 30 tags', async () => {
    const tags = Array.from({ length: 31 }, (_, i) => `tag-${i}`);
    const ctx = authedContext({ tags });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('max 30');
  });

  it('returns 400 for empty tags array', async () => {
    const ctx = authedContext({ tags: [] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('empty');
  });

  // --- Purge everything ---
  it('purges everything when purge_everything is true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ purge_everything: true });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);

    const payload = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(payload.purge_everything).toBe(true);
    const json = await res.json();
    expect(json.purged).toBe('everything');
  });

  // --- Mutual exclusivity ---
  it('returns 400 when both urls and tags are provided', async () => {
    const ctx = authedContext({
      urls: ['https://cloudcdn.pro/a.png'],
      tags: ['tag-a'],
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Only one');
  });

  it('returns 400 when both urls and purge_everything are provided', async () => {
    const ctx = authedContext({
      urls: ['https://cloudcdn.pro/a.png'],
      purge_everything: true,
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Only one');
  });

  // --- Cloudflare API failure ---
  it('returns 502 when Cloudflare API is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const ctx = authedContext({ purge_everything: true });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('Failed to reach Cloudflare API');
  });

  it('returns 502 when Cloudflare API returns failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, errors: ['bad'] }), { status: 200 })
    );
    const ctx = authedContext({ purge_everything: true });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(502);
  });

  // --- Boundary tests ---
  it('purges with exactly 30 URLs (boundary)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const urls = Array.from({ length: 30 }, (_, i) => `https://cloudcdn.pro/img/${i}.png`);
    const ctx = authedContext({ urls });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });

  it('purges with exactly 30 tags (boundary)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const tags = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
    const ctx = authedContext({ tags });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });

  it('returns 400 for 31 tags (over limit)', async () => {
    const tags = Array.from({ length: 31 }, (_, i) => `tag-${i}`);
    const ctx = authedContext({ tags });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('accepts tags with hyphens', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ tags: ['project-banking-on-ai', 'type-hero-banner'] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });

  it('rejects tags with spaces', async () => {
    const ctx = authedContext({ tags: ['valid-tag', 'invalid tag'] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects tags with special characters', async () => {
    const ctx = authedContext({ tags: ['tag!@#'] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for mixed tags and purge_everything', async () => {
    const ctx = authedContext({
      tags: ['tag-a'],
      purge_everything: true,
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Only one');
  });

  it('returns 400 for URLs with http:// (not https://)', async () => {
    const ctx = authedContext({ urls: ['http://cloudcdn.pro/img/test.png'] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for purge_everything=false', async () => {
    const ctx = authedContext({ purge_everything: false });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 when no purge mode is specified', async () => {
    const ctx = authedContext({});
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns remaining purge count on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ purge_everything: true }, {
      RATE_KV: {
        get: vi.fn().mockResolvedValue('5'),
        put: vi.fn(),
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('purged');
  });

  it('rate limit allows request at 99 (below 100 limit)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ purge_everything: true }, {
      RATE_KV: {
        get: vi.fn().mockResolvedValue('99'),
        put: vi.fn(),
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });

  it('handles Cloudflare API returning non-200 status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, errors: ['forbidden'] }), { status: 403 })
    );
    const ctx = authedContext({ purge_everything: true });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(502);
  });

  it('purge with valid single URL succeeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ urls: ['https://cloudcdn.pro/img/logo.webp'] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });

  it('purge with valid single tag succeeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ tags: ['project-akande'] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });

  it('purge everything response contains purged field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ purge_everything: true });
    const res = await onRequestPost(ctx);
    const json = await res.json();
    expect(json.purged).toBeDefined();
  });

  it('purge URL response has CORS header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ urls: ['https://cloudcdn.pro/img/a.webp'] });
    const res = await onRequestPost(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('purge 401 has CORS header', async () => {
    const ctx = makeContext({ purge_everything: true }, {}, {});
    const res = await onRequestPost(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('purge sends Bearer token to Cloudflare', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ purge_everything: true });
    await onRequestPost(ctx);
    const authHeader = globalThis.fetch.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toContain('Bearer');
  });

  it('purge sends to correct zone endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const ctx = authedContext({ purge_everything: true });
    await onRequestPost(ctx);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain('zone-123');
    expect(url).toContain('purge_cache');
  });

  it('URL purge validates all URLs start with allowed prefix', async () => {
    const urls = [
      'https://cloudcdn.pro/img/ok.png',
      'https://evil.com/bad.png',
    ];
    const ctx = authedContext({ urls });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });
});
