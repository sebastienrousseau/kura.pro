/**
 * Tests for POST /api/assets/process — the AI-asset pipeline that
 * chains moderate + alt-text + smart-crop + transform + signed-url.
 *
 * The downstream /api/ai/* + /api/transform + /api/signed endpoints
 * are mocked via globalThis.fetch.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const processor = await import('../../functions/api/assets/process.js');

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

function makeReq({ body, cookie = 'cdn_session=tok' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('cf-connecting-ip', '203.0.113.1');
  headers.set('user-agent', 'vitest');
  return { method: 'POST', url: 'https://cloudcdn.pro/api/assets/process', headers, json: async () => body };
}

function freshEnv(overrides = {}) {
  return {
    ACCOUNTS_DB: makeD1(),
    RATE_KV: { get: vi.fn(), put: vi.fn() },
    ...overrides,
  };
}

function stubAi({ moderation = { safe: true, labels: [] }, altText = 'a sample alt', smartCrop = { x: 0, y: 0, w: 100, h: 100 }, signed = { url: 'https://cloudcdn.pro/stocks/images/test.webp?sig=abc' } } = {}) {
  globalThis.fetch = vi.fn(async (urlOrReq) => {
    const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
    if (u.includes('/api/ai/moderate')) return new Response(JSON.stringify(moderation), { status: 200 });
    if (u.includes('/api/ai/alt-text')) return new Response(JSON.stringify({ alt: altText }), { status: 200 });
    if (u.includes('/api/ai/smart-crop')) return new Response(JSON.stringify(smartCrop), { status: 200 });
    if (u.includes('/api/signed')) return new Response(JSON.stringify(signed), { status: 200 });
    return new Response('unstubbed: ' + u, { status: 599 });
  });
}

const SOURCE = 'https://cloudcdn.pro/stocks/images/test.webp';

// ── helper unit tests ──────────────────────────────────────────

describe('sanitiseList', () => {
  it('returns fallback when input is empty/invalid', () => {
    expect(processor.sanitiseList(undefined, ['avif'], new Set(['avif', 'webp']))).toEqual(['avif']);
    expect(processor.sanitiseList([], ['avif'], new Set(['avif']))).toEqual(['avif']);
    expect(processor.sanitiseList(null, ['x'], new Set(['x']))).toEqual(['x']);
  });
  it('filters to allowed values + deduplicates', () => {
    const r = processor.sanitiseList(['avif', 'webp', 'avif', 'bogus'], [], new Set(['avif', 'webp']));
    expect(r).toEqual(['avif', 'webp']);
  });
  it('falls back when all values are filtered out', () => {
    const r = processor.sanitiseList(['bogus', 'invalid'], ['default'], new Set(['default']));
    expect(r).toEqual(['default']);
  });
});

describe('sanitiseTtl', () => {
  it('returns default for invalid input', () => {
    expect(processor.sanitiseTtl(undefined)).toBe(3600);
    expect(processor.sanitiseTtl('not-a-number')).toBe(3600);
    expect(processor.sanitiseTtl(0)).toBe(3600);
    expect(processor.sanitiseTtl(-100)).toBe(3600);
    expect(processor.sanitiseTtl(86_401)).toBe(3600);
    expect(processor.sanitiseTtl(3.14)).toBe(3600);
  });
  it('accepts valid values', () => {
    expect(processor.sanitiseTtl(60)).toBe(60);
    expect(processor.sanitiseTtl(86_400)).toBe(86_400);
  });
});

describe('buildTransformUrl', () => {
  it('builds /api/transform URL with params', () => {
    const u = processor.buildTransformUrl(
      { url: 'https://cloudcdn.pro/api/assets/process' },
      'https://cloudcdn.pro/stocks/images/x.webp',
      { w: 800, format: 'avif' },
    );
    expect(u).toContain('https://cloudcdn.pro/api/transform?');
    expect(u).toContain('url=https%3A%2F%2Fcloudcdn.pro%2Fstocks%2Fimages%2Fx.webp');
    expect(u).toContain('w=800');
    expect(u).toContain('format=avif');
  });
  it('skips undefined/null params', () => {
    const u = processor.buildTransformUrl(
      { url: 'https://cloudcdn.pro/' },
      'https://cloudcdn.pro/x',
      { w: 100, h: undefined, format: null },
    );
    expect(u).toContain('w=100');
    expect(u).not.toContain('h=');
    expect(u).not.toContain('format=');
  });
});

// ── HTTP endpoint ──────────────────────────────────────────────

describe('POST /api/assets/process', () => {
  beforeEach(() => stubAi());

  it('OPTIONS preflight returns 204', async () => {
    expect((await processor.onRequestOptions()).status).toBe(204);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    expect((await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env: {} })).status).toBe(503);
  });

  it('returns 401 without an active session', async () => {
    const env = freshEnv({ ACCOUNTS_DB: makeD1(null) });
    expect((await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env })).status).toBe(401);
  });

  it('returns 403 when session has no account', async () => {
    const env = freshEnv({ ACCOUNTS_DB: makeD1({
      ...SESSION, account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null,
    }) });
    expect((await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env })).status).toBe(403);
  });

  it('returns 429 when per-IP rate-limit trips', async () => {
    // Discriminating mock: rate-limit keys return '999' so the limiter
    // trips; usage-cache keys return null so the new enforceCap check
    // is a no-op (cap=0 + 0 usage = allowed).
    const env = freshEnv({ RATE_KV: { get: vi.fn(async (k) => k.startsWith('usage:') ? null : '999'), put: vi.fn() } });
    expect((await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env })).status).toBe(429);
  });

  it('returns 402 when the account has hit its monthly cap', async () => {
    // The session mock defaults monthly_cap_usd to 0 (degrade-only) —
    // so any non-zero usage refuses. Seed the usage-cache key with $5.
    const env = freshEnv({ RATE_KV: { get: vi.fn(async (k) => k.startsWith('usage:') ? '5' : null), put: vi.fn() } });
    const res = await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('spend_cap_reached');
  });

  it('returns 400 on bad JSON', async () => {
    const env = freshEnv();
    const req = makeReq();
    req.json = async () => { throw new Error('boom'); };
    expect((await processor.onRequestPost({ request: req, env })).status).toBe(400);
  });

  it('returns 400 on missing url', async () => {
    const env = freshEnv();
    expect((await processor.onRequestPost({ request: makeReq({ body: {} }), env })).status).toBe(400);
  });

  it('returns 400 when url is not an https://cloudcdn.pro/... image', async () => {
    const env = freshEnv();
    expect((await processor.onRequestPost({ request: makeReq({ body: { url: 'https://evil.com/x.webp' } }), env })).status).toBe(400);
    expect((await processor.onRequestPost({ request: makeReq({ body: { url: 'https://cloudcdn.pro/stocks/images/no-extension' } }), env })).status).toBe(400);
  });

  it('refuses with 422 when moderation flags the source as unsafe', async () => {
    stubAi({ moderation: { safe: false, reason: 'adult_content' } });
    const env = freshEnv();
    const res = await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('content_moderation_block');
  });

  it('happy path (urls mode) — returns variants, crops, lazy AI URLs, signed URL', async () => {
    const env = freshEnv();
    const res = await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source.url).toBe(SOURCE);
    expect(body.moderation.verdict).toBe('allow');
    expect(body.variants.avif.url).toContain('/api/transform');
    expect(body.variants.avif.url).toContain('format=avif');
    expect(body.variants.webp.url).toContain('format=webp');
    expect(body.crops['16:9'].url).toContain('/api/transform');
    expect(body.crops['1:1'].url).toContain('/api/transform');
    expect(body.aiAssisted.altTextUrl).toContain('/api/ai/alt-text');
    expect(body.aiAssisted.smartCropUrl).toContain('/api/ai/smart-crop');
    expect(body.signed.url).toContain('sig=abc');
    expect(body.mode).toBe('urls');
  });

  it('eager mode — invokes alt-text + smart-crop synchronously', async () => {
    const env = freshEnv();
    const res = await processor.onRequestPost({
      request: makeReq({ body: { url: SOURCE, mode: 'eager' } }),
      env,
    });
    const body = await res.json();
    expect(body.mode).toBe('eager');
    expect(body.aiAssisted.altText).toBe('a sample alt');
    expect(body.aiAssisted.smartCropHints).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(body.aiAssisted.altTextUrl).toBeUndefined();
  });

  it('respects custom formats + crops + ttl', async () => {
    const env = freshEnv();
    const res = await processor.onRequestPost({
      request: makeReq({ body: { url: SOURCE, formats: ['jxl', 'png'], crops: ['4:3'], signedTtlSeconds: 60 } }),
      env,
    });
    const body = await res.json();
    expect(Object.keys(body.variants)).toEqual(['jxl', 'png']);
    expect(Object.keys(body.crops)).toEqual(['4:3']);
    expect(body.signed.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 61);
  });

  it('moderation upstream error defaults to allow (best-effort)', async () => {
    globalThis.fetch = vi.fn(async (urlOrReq) => {
      const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
      if (u.includes('/api/ai/moderate')) return new Response('upstream down', { status: 503 });
      if (u.includes('/api/signed')) return new Response(JSON.stringify({ url: SOURCE }), { status: 200 });
      return new Response('?', { status: 599 });
    });
    const env = freshEnv();
    const res = await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env });
    expect(res.status).toBe(200);
    expect((await res.json()).moderation.verdict).toBe('allow');
  });

  it('signed-url mint failure falls back to unsigned source URL', async () => {
    globalThis.fetch = vi.fn(async (urlOrReq) => {
      const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
      if (u.includes('/api/ai/moderate')) return new Response(JSON.stringify({ safe: true }), { status: 200 });
      if (u.includes('/api/signed')) return new Response('forbidden', { status: 403 });
      return new Response('?', { status: 599 });
    });
    const env = freshEnv();
    const res = await processor.onRequestPost({ request: makeReq({ body: { url: SOURCE } }), env });
    const body = await res.json();
    expect(body.signed.url).toBe(SOURCE);
    expect(body.signed.note).toContain('unsigned source');
  });
});
