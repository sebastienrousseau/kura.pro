/**
 * Tests for POST /api/auth/onboarding/zone — the server-side
 * replacement for the wizard's old client-side HEAD probe.
 *
 * D1 is mocked, the HEAD probe is mocked via globalThis.fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const zoneModule = await import('../../functions/api/auth/onboarding/zone.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

function makeD1({ first = async () => null, all = async () => ({ results: [] }) } = {}) {
  const bind = vi.fn(() => ({
    first: vi.fn(first),
    all: vi.fn(all),
    run: vi.fn().mockResolvedValue({ success: true }),
  }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, batch: vi.fn() };
}

function makeRequest({ method = 'POST', body, cookie = 'cdn_session=tok' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('cf-connecting-ip', '203.0.113.1');
  headers.set('user-agent', 'vitest');
  return {
    method, url: 'https://cloudcdn.pro/api/auth/onboarding/zone', headers,
    cf: { country: 'US' },
    json: async () => body,
  };
}

const SESSION_ROW = {
  token_hash: 'h', user_id: 'u1', account_id: 'a1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  revoked_at: null,
  email: 'who@example.com', name: null, email_verified_at: null,
  account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: 0,
};

function envWithSession(overrides = {}) {
  let n = 0;
  const slugRow = overrides.slugConflict;
  const insertFn = overrides.insertFn;
  return {
    ACCOUNTS_DB: {
      prepare: vi.fn((sql) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            n++;
            // 1st: getCurrentSession
            if (n === 1) return overrides.session === undefined ? SESSION_ROW : overrides.session;
            // 2nd+: pickSlug collision-check (return slugRow once if simulating conflict, else null)
            if (slugRow && n === 2) return { id: 'collision' };
            return null;
          }),
          all: vi.fn().mockResolvedValue({ results: overrides.zonesList || [] }),
          run: vi.fn(async () => {
            if (insertFn) return insertFn(sql);
            return { success: true };
          }),
        })),
      })),
      batch: vi.fn(),
    },
  };
}

function defaultHeadOk() {
  globalThis.fetch = vi.fn(async (_url, init) => {
    if (init && init.method === 'HEAD') return new Response(null, { status: 200 });
    return new Response('?', { status: 599 });
  });
}

// ── slugify direct ──────────────────────────────────────────────

describe('slugify', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['My-Project!!', 'my-project'],
    ['   --foo--   ', 'foo'],
    ['CAPS', 'caps'],
    ['résumé', 'resume'],  // diacritics-stripped; é → e
    ['multiple    spaces', 'multiple-spaces'],
    ['_under_scores_', 'under-scores'],
    ['1234567890123456789012345678901234567890', '12345678901234567890123456789012'],
  ])('slugify(%j) → %j', (input, expected) => {
    expect(zoneModule.slugify(input)).toBe(expected);
  });

  it('returns empty for whitespace-only input', () => {
    expect(zoneModule.slugify('   ')).toBe('');
    expect(zoneModule.slugify('')).toBe('');
    expect(zoneModule.slugify(null)).toBe('');
  });
});

// ── probeOrigin direct ──────────────────────────────────────────

describe('probeOrigin', () => {
  it('returns "ok" on 2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    expect(await zoneModule.probeOrigin('https://example.com')).toBe('ok');
  });
  it('returns "ok" on 3xx redirect (still reachable)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 301 }));
    expect(await zoneModule.probeOrigin('https://example.com')).toBe('ok');
  });
  it('returns http_error:<code> on 4xx/5xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    expect(await zoneModule.probeOrigin('https://example.com')).toBe('http_error:403');
  });
  it('returns "unreachable" on generic network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await zoneModule.probeOrigin('https://example.com')).toBe('unreachable');
  });
  it('returns "tls_error" on TLS-related errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('TLS handshake failed: certificate unknown'));
    expect(await zoneModule.probeOrigin('https://example.com')).toBe('tls_error');
  });
  it('returns "timeout" on AbortError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(await zoneModule.probeOrigin('https://example.com')).toBe('timeout');
  });
});

// ── HTTP endpoint ──────────────────────────────────────────────

describe('POST /api/auth/onboarding/zone', () => {
  beforeEach(() => defaultHeadOk());

  it('OPTIONS preflight returns 204', async () => {
    expect((await zoneModule.onRequestOptions()).status).toBe(204);
  });

  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'x', originUrl: 'https://a.com' } }),
      env: {},
    });
    expect(res.status).toBe(503);
  });

  it('returns 401 with no active session', async () => {
    const env = envWithSession({ session: null });
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'x', originUrl: 'https://a.com' } }),
      env,
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when session has no account', async () => {
    const env = envWithSession({
      session: {
        ...SESSION_ROW,
        account_id: null, account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null,
      },
    });
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'x', originUrl: 'https://a.com' } }),
      env,
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 on bad JSON', async () => {
    const env = envWithSession();
    const req = makeRequest({ body: {} });
    req.json = async () => { throw new Error('boom'); };
    const res = await zoneModule.onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('returns 400 on short/empty name', async () => {
    const env = envWithSession();
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: '', originUrl: 'https://a.com' } }),
      env,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on name longer than 64 chars', async () => {
    const env = envWithSession();
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'a'.repeat(65), originUrl: 'https://a.com' } }),
      env,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on non-http(s) origin URL', async () => {
    const env = envWithSession();
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'My Project', originUrl: 'ftp://a.com' } }),
      env,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on garbage origin URL', async () => {
    const env = envWithSession();
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'My Project', originUrl: 'not a url' } }),
      env,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the name slugifies to nothing alphanumeric', async () => {
    const env = envWithSession();
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: '---', originUrl: 'https://a.com' } }),
      env,
    });
    expect(res.status).toBe(400);
  });

  it('happy path — 201, returns zone with edgeHostname + originStatus', async () => {
    const env = envWithSession();
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'My First Zone', originUrl: 'https://origin.example.com' } }),
      env,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.zone.name).toBe('My First Zone');
    expect(body.zone.slug).toBe('my-first-zone');
    expect(body.zone.edgeHostname).toBe('my-first-zone.cdn.cloudcdn.pro');
    expect(body.zone.originStatus).toBe('ok');
    expect(body.zone.live).toBe(false);
  });

  it('happy path — origin probe failure does not block provisioning', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const env = envWithSession();
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'mine', originUrl: 'https://origin.example.com' } }),
      env,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).zone.originStatus).toBe('unreachable');
  });

  it('returns 409 slug_conflict when INSERT itself hits UNIQUE (race past pickSlug)', async () => {
    let firstCalls = 0;
    const env = {
      ACCOUNTS_DB: {
        prepare: vi.fn((sql) => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => {
              firstCalls++;
              // 1st: session, 2nd+: pickSlug → null so we reach the INSERT
              return firstCalls === 1 ? SESSION_ROW : null;
            }),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn(async () => {
              if (sql.includes('INSERT INTO account_zones')) {
                throw new Error('UNIQUE constraint failed: account_zones.slug');
              }
              return { success: true };
            }),
          })),
        })),
        batch: vi.fn(),
      },
    };
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'My Project', originUrl: 'https://o.example.com' } }),
      env,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('slug_conflict');
  });

  it('returns 500 internal on non-UNIQUE D1 error during insert', async () => {
    let firstCalls = 0;
    const env = {
      ACCOUNTS_DB: {
        prepare: vi.fn((sql) => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => {
              firstCalls++;
              // 1st call is getCurrentSession (returns the session row).
              // Subsequent calls are pickSlug collision checks — return
              // null so the slug is accepted and we reach the insert.
              return firstCalls === 1 ? SESSION_ROW : null;
            }),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn(async () => {
              if (sql.includes('INSERT INTO account_zones')) {
                throw new Error('database is locked');
              }
              return { success: true };
            }),
          })),
        })),
        batch: vi.fn(),
      },
    };
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'My Project', originUrl: 'https://o.example.com' } }),
      env,
    });
    expect(res.status).toBe(500);
  });

  it('returns 409 slug_conflict when pickSlug exhausts retries', async () => {
    // Every collision check returns a hit → pickSlug returns null after 4 attempts.
    let firstCalls = 0;
    const env = {
      ACCOUNTS_DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => {
              firstCalls++;
              return firstCalls === 1 ? SESSION_ROW : { id: 'collision-' + firstCalls };
            }),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
        })),
        batch: vi.fn(),
      },
    };
    const res = await zoneModule.onRequestPost({
      request: makeRequest({ body: { name: 'My Project', originUrl: 'https://o.example.com' } }),
      env,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('slug_conflict');
  });
});

describe('GET /api/auth/onboarding/zone', () => {
  it('returns 503 when ACCOUNTS_DB is missing', async () => {
    const res = await zoneModule.onRequestGet({ request: makeRequest({ method: 'GET' }), env: {} });
    expect(res.status).toBe(503);
  });

  it('returns 401 without session', async () => {
    const env = envWithSession({ session: null });
    const res = await zoneModule.onRequestGet({ request: makeRequest({ method: 'GET' }), env });
    expect(res.status).toBe(401);
  });

  it('returns 403 when session lacks an account', async () => {
    const env = envWithSession({
      session: {
        ...SESSION_ROW,
        account_id: null, account_id_full: null, account_name: null, plan: null, monthly_cap_usd: null,
      },
    });
    const res = await zoneModule.onRequestGet({ request: makeRequest({ method: 'GET' }), env });
    expect(res.status).toBe(403);
  });

  it('happy path — returns the account zones', async () => {
    const env = envWithSession({
      zonesList: [
        { id: 'z1', name: 'A', slug: 'a', origin_url: 'https://a.io', edge_hostname: 'a.cdn.cloudcdn.pro', origin_status: 'ok', live: 0, created_at: 100 },
        { id: 'z2', name: 'B', slug: 'b', origin_url: 'https://b.io', edge_hostname: 'b.cdn.cloudcdn.pro', origin_status: null, live: 1, created_at: 200 },
      ],
    });
    const res = await zoneModule.onRequestGet({ request: makeRequest({ method: 'GET' }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.zones).toHaveLength(2);
    expect(body.zones[0].edgeHostname).toBe('a.cdn.cloudcdn.pro');
    expect(body.zones[1].live).toBe(true);
  });
});
