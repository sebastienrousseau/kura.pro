/**
 * Tests for GET /api/insights/cache-explain — the "why did this URL
 * miss/hit" diagnostic endpoint.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const cacheExplain = await import('../../functions/api/insights/cache-explain.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

const SESSION = {
  token_hash: 'h', user_id: 'u1', account_id: 'a1',
  expires_at: Math.floor(Date.now() / 1000) + 3600, revoked_at: null,
  email: 'w@e.com', name: null, email_verified_at: null,
  account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: 0,
};

function makeD1(sessionRow = SESSION) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(sessionRow),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    })),
    batch: vi.fn(),
  };
}

function makeReq({ url = 'https://cloudcdn.pro/api/insights/cache-explain?url=https%3A%2F%2Fcloudcdn.pro%2Fstocks%2Fimages%2Ftest.webp', cookie = 'cdn_session=tok' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('cf-connecting-ip', '203.0.113.1');
  headers.set('user-agent', 'vitest');
  return { method: 'GET', url, headers };
}

function freshEnv(overrides = {}) {
  return {
    ACCOUNTS_DB: makeD1(),
    RATE_KV: { get: vi.fn(), put: vi.fn() },
    ...overrides,
  };
}

function headResponse({ status = 200, headers = {} } = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Response(null, { status, headers: h });
}

// ── classifyPath direct ─────────────────────────────────────────

describe('classifyPath', () => {
  it.each([
    ['/api/health', 'api'],
    ['/cdn/en/index.html', 'cdn'],
    ['/stocks/images/x.webp', 'stocks'],
    ['/shared/site-nav.css', 'shared'],
    ['/dashboard/', 'dashboard'],
    ['/dist/install.sh', 'dist'],
    ['/global/usa/asset.webp', 'global'],
    ['/sign-up', 'auth_pages'],
    ['/onboarding', 'auth_pages'],
    ['/akande/v1/logos/logo.svg', 'client_asset'],
    ['/some/unknown/path', 'client_asset'],
  ])('classifyPath(%j) → pillar=%s', (path, expected) => {
    expect(cacheExplain.classifyPath(path).pillar).toBe(expected);
  });

  it('extracts format from client_asset filename', () => {
    const r = cacheExplain.classifyPath('/akande/v1/logos/logo.svg');
    expect(r.format).toBe('svg');
    expect(r.project).toBe('akande');
  });

  it('handles paths under /stocks/<category>/', () => {
    const r = cacheExplain.classifyPath('/stocks/images/x.webp');
    expect(r.category).toBe('images');
  });
});

// ── computeVerdict direct ───────────────────────────────────────

describe('computeVerdict', () => {
  it.each([
    [{ status: 500, cacheStatus: 'NONE', cacheControl: null }, 'origin_5xx'],
    [{ status: 404, cacheStatus: 'NONE', cacheControl: null }, 'origin_4xx'],
    [{ status: 200, cacheStatus: 'HIT', age: 60, cacheControl: null }, 'hit_fresh'],
    [{ status: 200, cacheStatus: 'REVALIDATED', cacheControl: null }, 'hit_stale_revalidating'],
    [{ status: 200, cacheStatus: 'STALE', cacheControl: null }, 'hit_stale_origin_down'],
    [{ status: 200, cacheStatus: 'MISS', cacheControl: null }, 'miss_origin_hit'],
    [{ status: 200, cacheStatus: 'EXPIRED', cacheControl: null }, 'miss_revalidated'],
    [{ status: 200, cacheStatus: 'BYPASS', cacheControl: null }, 'bypass_no_store'],
    [{ status: 200, cacheStatus: 'DYNAMIC', cacheControl: 'no-store' }, 'bypass_no_store'],
    [{ status: 200, cacheStatus: 'DYNAMIC', cacheControl: 'public, max-age=60' }, 'uncacheable_dynamic'],
    [{ status: 200, cacheStatus: 'UNKNOWN_VALUE', cacheControl: null }, 'unknown'],
  ])('computeVerdict(%o) → %s', (inp, expected) => {
    expect(cacheExplain.computeVerdict(inp)).toBe(expected);
  });
});

// ── HTTP endpoint ──────────────────────────────────────────────

describe('GET /api/insights/cache-explain', () => {
  it('OPTIONS preflight returns 204', async () => {
    expect((await cacheExplain.onRequestOptions()).status).toBe(204);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    expect((await cacheExplain.onRequestGet({ request: makeReq(), env: {} })).status).toBe(503);
  });

  it('returns 401 without an active session', async () => {
    const env = freshEnv({ ACCOUNTS_DB: makeD1(null) });
    expect((await cacheExplain.onRequestGet({ request: makeReq(), env })).status).toBe(401);
  });

  it('returns 429 when per-IP rate-limit trips', async () => {
    const env = freshEnv({ RATE_KV: { get: vi.fn().mockResolvedValue('999'), put: vi.fn() } });
    expect((await cacheExplain.onRequestGet({ request: makeReq(), env })).status).toBe(429);
  });

  it('returns 400 when url param is absent', async () => {
    const env = freshEnv();
    const req = makeReq({ url: 'https://cloudcdn.pro/api/insights/cache-explain' });
    expect((await cacheExplain.onRequestGet({ request: req, env })).status).toBe(400);
  });

  it('returns 400 when url param is malformed', async () => {
    const env = freshEnv();
    const req = makeReq({ url: 'https://cloudcdn.pro/api/insights/cache-explain?url=not-a-url' });
    expect((await cacheExplain.onRequestGet({ request: req, env })).status).toBe(400);
  });

  it('returns 400 when url points off-host (SSRF defence)', async () => {
    const env = freshEnv();
    const req = makeReq({ url: 'https://cloudcdn.pro/api/insights/cache-explain?url=https%3A%2F%2Fevil.example.com%2F' });
    expect((await cacheExplain.onRequestGet({ request: req, env })).status).toBe(400);
  });

  it('returns 400 when url protocol is not http(s)', async () => {
    const env = freshEnv();
    const req = makeReq({ url: 'https://cloudcdn.pro/api/insights/cache-explain?url=ftp%3A%2F%2Fcloudcdn.pro%2Fx' });
    expect((await cacheExplain.onRequestGet({ request: req, env })).status).toBe(400);
  });

  it('returns 502 when HEAD probe throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const env = freshEnv();
    expect((await cacheExplain.onRequestGet({ request: makeReq(), env })).status).toBe(502);
  });

  it('happy path — HIT response with cache-tag → returns purge-by-tag suggestion', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(headResponse({
      status: 200,
      headers: {
        'cf-cache-status': 'HIT',
        age: '300',
        'cache-control': 'public, max-age=31536000, immutable',
        etag: '"abc123"',
        'cache-tag': 'project-akande,type-logos,format-svg,all-assets',
        'x-trace-id': 'trace-xyz',
        traceparent: '00-trace-xyz-span-01',
        'cf-ray': 'ray-abc',
        server: 'cloudflare',
      },
    }));
    const env = freshEnv();
    const res = await cacheExplain.onRequestGet({ request: makeReq(), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cacheStatus).toBe('HIT');
    expect(body.age).toBe(300);
    expect(body.cacheTag).toContain('project-akande');
    expect(body.verdict).toBe('hit_fresh');
    expect(body.routing.pillar).toBe('stocks');
    expect(body.trace.traceId).toBe('trace-xyz');
    expect(body.suggestions.some(s => s.includes('Purge by tag'))).toBe(true);
  });

  it('MISS response surfaces "request again — should HIT" suggestion', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(headResponse({
      status: 200,
      headers: { 'cf-cache-status': 'MISS' },
    }));
    const env = freshEnv();
    const res = await cacheExplain.onRequestGet({ request: makeReq(), env });
    const body = await res.json();
    expect(body.cacheStatus).toBe('MISS');
    expect(body.verdict).toBe('miss_origin_hit');
    expect(body.suggestions.some(s => s.includes('next response should HIT'))).toBe(true);
  });

  it('DYNAMIC on /api/* surfaces "add Cache-Control" suggestion', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(headResponse({
      status: 200,
      headers: { 'cf-cache-status': 'DYNAMIC' },
    }));
    const env = freshEnv();
    const req = makeReq({
      url: 'https://cloudcdn.pro/api/insights/cache-explain?url=https%3A%2F%2Fcloudcdn.pro%2Fapi%2Fhealth',
    });
    const res = await cacheExplain.onRequestGet({ request: req, env });
    const body = await res.json();
    expect(body.routing.pillar).toBe('api');
    expect(body.suggestions.some(s => s.includes('add Cache-Control') || s.includes('Add Cache-Control'))).toBe(true);
  });

  it('no-store cache-control surfaces "remove no-store" suggestion', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(headResponse({
      status: 200,
      headers: { 'cf-cache-status': 'BYPASS', 'cache-control': 'no-store, max-age=0' },
    }));
    const env = freshEnv();
    const res = await cacheExplain.onRequestGet({ request: makeReq(), env });
    const body = await res.json();
    expect(body.verdict).toBe('bypass_no_store');
    expect(body.suggestions.some(s => /no-store/i.test(s))).toBe(true);
  });
});
