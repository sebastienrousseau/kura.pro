import { describe, it, expect, vi } from 'vitest';

const { onRequest } = await import('../../functions/dist/_middleware.js');
import { hmacSign } from '../../functions/api/_shared.js';

function makeCtx(options = {}) {
  const h = new Headers();
  if (options.host) h.set('host', options.host);
  if (options.cookie) h.set('Cookie', options.cookie);

  return {
    request: {
      url: options.url || 'https://cloudcdn.pro/dist/test.js',
      headers: h,
    },
    env: {
      DASHBOARD_SECRET: options.secret,
      DASHBOARD_PASSWORD: options.password,
      ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) },
    },
    next: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })),
  };
}

describe('Dist Auth Middleware', () => {
  it('allows on localhost without password', async () => {
    const ctx = makeCtx({ host: 'localhost:8788' });
    const res = await onRequest(ctx);
    expect(ctx.next).toHaveBeenCalled();
  });

  it('allows on 127.0.0.1 without password', async () => {
    const ctx = makeCtx({ host: '127.0.0.1:8788' });
    const res = await onRequest(ctx);
    expect(ctx.next).toHaveBeenCalled();
  });

  it('returns 503 on production without password configured', async () => {
    const ctx = makeCtx({ host: 'cloudcdn.pro' });
    const res = await onRequest(ctx);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('authentication');
  });

  it('valid session cookie passes through', async () => {
    const secret = 'test-secret-123';
    const futureExpiry = String(Math.floor(Date.now() / 1000) + 3600);
    const sig = await hmacSign(secret, futureExpiry);
    const cookie = `cdn_session=${futureExpiry}.${sig}`;

    const ctx = makeCtx({ secret, cookie });
    const res = await onRequest(ctx);
    expect(ctx.env.ASSETS.fetch).toHaveBeenCalled();
  });

  it('expired session redirects to login', async () => {
    const secret = 'test-secret-123';
    const pastExpiry = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = await hmacSign(secret, pastExpiry);
    const cookie = `cdn_session=${pastExpiry}.${sig}`;

    const ctx = makeCtx({ secret, cookie });
    const res = await onRequest(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/dashboard/login');
  });

  it('tampered session signature redirects to login', async () => {
    const secret = 'test-secret-123';
    const futureExpiry = String(Math.floor(Date.now() / 1000) + 3600);
    const cookie = `cdn_session=${futureExpiry}.tampered-signature-abc`;

    const ctx = makeCtx({ secret, cookie });
    const res = await onRequest(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/dashboard/login');
  });

  it('missing session cookie redirects to login', async () => {
    const ctx = makeCtx({ secret: 'test-secret-123' });
    const res = await onRequest(ctx);
    expect(res.status).toBe(302);
  });

  it('malformed cookie (no dot separator) redirects to login', async () => {
    const ctx = makeCtx({ secret: 'test-secret-123', cookie: 'cdn_session=nodot' });
    const res = await onRequest(ctx);
    expect(res.status).toBe(302);
  });

  it('empty cookie value redirects to login', async () => {
    const ctx = makeCtx({ secret: 'test-secret-123', cookie: 'cdn_session=' });
    const res = await onRequest(ctx);
    expect(res.status).toBe(302);
  });

  it('uses DASHBOARD_PASSWORD as fallback for DASHBOARD_SECRET', async () => {
    const password = 'my-password';
    const futureExpiry = String(Math.floor(Date.now() / 1000) + 3600);
    const sig = await hmacSign(password, futureExpiry);
    const cookie = `cdn_session=${futureExpiry}.${sig}`;

    const ctx = makeCtx({ password, cookie });
    const res = await onRequest(ctx);
    expect(ctx.env.ASSETS.fetch).toHaveBeenCalled();
  });

  it('redirects to login with correct origin', async () => {
    const ctx = makeCtx({
      secret: 'test-secret-123',
      url: 'https://custom.domain.com/dist/page.html',
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('custom.domain.com');
  });

  // --- Extended tests ---
  it('expired cookie with correct signature redirects', async () => {
    const secret = 'test-secret-123';
    const pastExpiry = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = await hmacSign(secret, pastExpiry);
    const cookie = `cdn_session=${pastExpiry}.${sig}`;
    const ctx = makeCtx({ secret, cookie });
    const res = await onRequest(ctx);
    expect(res.status).toBe(302);
  });

  it('cookie with wrong signature redirects', async () => {
    const secret = 'test-secret-123';
    const futureExpiry = String(Math.floor(Date.now() / 1000) + 3600);
    const wrongSig = 'deadbeef'.repeat(8);
    const cookie = `cdn_session=${futureExpiry}.${wrongSig}`;
    const ctx = makeCtx({ secret, cookie });
    const res = await onRequest(ctx);
    expect(res.status).toBe(302);
  });

  it('redirect Location includes /dashboard/login', async () => {
    const ctx = makeCtx({ secret: 'test-secret-123' });
    const res = await onRequest(ctx);
    expect(res.headers.get('Location')).toContain('/dashboard/login');
  });

  it('allows localhost dev mode without secret', async () => {
    const ctx = makeCtx({});
    ctx.request.headers.set('host', 'localhost:8788');
    const res = await onRequest(ctx);
    expect(ctx.next).toHaveBeenCalled();
  });

  it('denies production without secret', async () => {
    const ctx = makeCtx({});
    ctx.request.headers.set('host', 'cloudcdn.pro');
    const res = await onRequest(ctx);
    expect([302, 503]).toContain(res.status);
  });

  it('cookie with extra cookies still works', async () => {
    const secret = 'test-secret-123';
    const futureExpiry = String(Math.floor(Date.now() / 1000) + 3600);
    const sig = await hmacSign(secret, futureExpiry);
    const cookie = `other_cookie=foo; cdn_session=${futureExpiry}.${sig}; another=bar`;
    const ctx = makeCtx({ secret, cookie });
    const res = await onRequest(ctx);
    expect(ctx.env.ASSETS.fetch).toHaveBeenCalled();
  });
});
