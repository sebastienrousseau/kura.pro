import { describe, it, expect, vi, beforeEach } from 'vitest';

const { onRequest } = await import('../../../functions/dashboard/_middleware.js');

/**
 * Helper: build a middleware context object.
 */
function makeContext(options = {}) {
  const {
    method = 'GET',
    pathname = '/dashboard/',
    cookie,
    formData,
    env = {},
  } = options;

  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  if (method === 'POST') headers.set('Content-Type', 'application/x-www-form-urlencoded');

  const request = {
    url: `https://cloudcdn.pro${pathname}`,
    method,
    headers,
    formData: formData ? vi.fn().mockResolvedValue(formData) : vi.fn(),
  };

  const nextResponse = new Response('OK from next()', { status: 200 });

  return {
    request,
    env: {
      DASHBOARD_PASSWORD: env.DASHBOARD_PASSWORD,
      DASHBOARD_SECRET: env.DASHBOARD_SECRET,
      ...env,
    },
    next: vi.fn().mockResolvedValue(nextResponse),
  };
}

function makeFormData(entries) {
  const fd = new Map(Object.entries(entries));
  fd.get = fd.get.bind(fd);
  return fd;
}

// ── Signing helper to create valid session cookies ──

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function makeSessionCookie(secret, expiresUnix) {
  const token = String(expiresUnix);
  const sig = await hmacSign(secret, token);
  return `cdn_session=${token}.${sig}`;
}

describe('Dashboard Auth Middleware', () => {
  // ── Dev mode (no password configured) ──
  describe('dev mode — no DASHBOARD_PASSWORD', () => {
    it('allows access on localhost when no password is configured', async () => {
      const ctx = makeContext({
        env: { DASHBOARD_PASSWORD: undefined, DASHBOARD_SECRET: undefined },
      });
      ctx.request.headers.set('host', 'localhost:8788');
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('denies access on production when no password is configured', async () => {
      const ctx = makeContext({
        env: { DASHBOARD_PASSWORD: undefined, DASHBOARD_SECRET: undefined },
      });
      ctx.request.headers.set('host', 'cloudcdn.pro');
      const res = await onRequest(ctx);
      expect(res.status).toBe(503);
    });
  });

  // ── Login page (GET) ──
  describe('GET /dashboard/login', () => {
    it('returns login HTML page', async () => {
      const ctx = makeContext({
        pathname: '/dashboard/login',
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const body = await res.text();
      expect(body).toContain('CloudCDN');
      expect(body).toContain('<form');
      expect(body).toContain('password');
    });

    it('does not show error class on initial load', async () => {
      const ctx = makeContext({
        pathname: '/dashboard/login',
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      const body = await res.text();
      // The error class should not include "show"
      expect(body).not.toContain('class="error show"');
    });
  });

  // ── Login POST ──
  describe('POST /dashboard/login', () => {
    it('redirects with Set-Cookie on correct password', async () => {
      const fd = makeFormData({ password: 'secret123' });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/dashboard/');
      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toContain('cdn_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Path=/dashboard');
    });

    it('returns 401 with error shown on wrong password', async () => {
      const fd = makeFormData({ password: 'wrongpass' });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const body = await res.text();
      expect(body).toContain('show');
      expect(body).toContain('Invalid password');
    });

    it('returns 401 on empty password', async () => {
      const fd = makeFormData({ password: '' });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(401);
    });

    it('uses DASHBOARD_SECRET over DASHBOARD_PASSWORD', async () => {
      const fd = makeFormData({ password: 'the-secret' });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_SECRET: 'the-secret', DASHBOARD_PASSWORD: 'other' },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(302);
    });
  });

  // ── Session cookie validation ──
  describe('session cookie — valid', () => {
    it('passes through to next() with a valid session cookie', async () => {
      const secret = 'secret123';
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      const cookie = await makeSessionCookie(secret, futureExpiry);

      const ctx = makeContext({
        pathname: '/dashboard/',
        cookie,
        env: { DASHBOARD_PASSWORD: secret },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  describe('session cookie — expired', () => {
    it('redirects to login when session cookie is expired', async () => {
      const secret = 'secret123';
      const pastExpiry = Math.floor(Date.now() / 1000) - 3600;
      const cookie = await makeSessionCookie(secret, pastExpiry);

      const ctx = makeContext({
        pathname: '/dashboard/',
        cookie,
        env: { DASHBOARD_PASSWORD: secret },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).not.toHaveBeenCalled();
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('/dashboard/login');
    });
  });

  describe('session cookie — invalid/tampered', () => {
    it('redirects to login with tampered signature', async () => {
      const secret = 'secret123';
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      const cookie = `cdn_session=${futureExpiry}.deadbeefcafebabe0000000000000000`;

      const ctx = makeContext({
        pathname: '/dashboard/',
        cookie,
        env: { DASHBOARD_PASSWORD: secret },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).not.toHaveBeenCalled();
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('/dashboard/login');
    });

    it('redirects to login with completely invalid cookie format', async () => {
      const ctx = makeContext({
        pathname: '/dashboard/',
        cookie: 'cdn_session=garbage-with-no-dot',
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).not.toHaveBeenCalled();
      expect(res.status).toBe(302);
    });

    it('redirects to login with no cookie at all', async () => {
      const ctx = makeContext({
        pathname: '/dashboard/',
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).not.toHaveBeenCalled();
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('/dashboard/login');
    });

    it('redirects to login when cookie is signed with wrong secret', async () => {
      const cookie = await makeSessionCookie('wrong-secret', Math.floor(Date.now() / 1000) + 3600);
      const ctx = makeContext({
        pathname: '/dashboard/',
        cookie,
        env: { DASHBOARD_PASSWORD: 'correct-secret' },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).not.toHaveBeenCalled();
      expect(res.status).toBe(302);
    });
  });

  // --- Extended tests ---

  describe('session cookie — boundary expiry', () => {
    it('passes through with session expiring far in the future', async () => {
      const secret = 'secret123';
      const farFuture = Math.floor(Date.now() / 1000) + 86400 * 365; // 1 year
      const cookie = await makeSessionCookie(secret, farFuture);
      const ctx = makeContext({
        pathname: '/dashboard/',
        cookie,
        env: { DASHBOARD_PASSWORD: secret },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('redirects when session expired 1 second ago', async () => {
      const secret = 'secret123';
      const justPast = Math.floor(Date.now() / 1000) - 1;
      const cookie = await makeSessionCookie(secret, justPast);
      const ctx = makeContext({
        pathname: '/dashboard/',
        cookie,
        env: { DASHBOARD_PASSWORD: secret },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).not.toHaveBeenCalled();
      expect(res.status).toBe(302);
    });
  });

  describe('login POST — edge cases', () => {
    it('handles password with special characters', async () => {
      const specialPass = 'p@$$w0rd!#%^&*()_+-=[]{}|;<>?,./~`"\'\\';
      const fd = makeFormData({ password: specialPass });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: specialPass },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/dashboard/');
    });

    it('handles password with Unicode characters', async () => {
      const unicodePass = '密码パスワード';
      const fd = makeFormData({ password: unicodePass });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: unicodePass },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(302);
    });

    it('rejects empty formData (no password field)', async () => {
      const fd = makeFormData({});
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(401);
    });
  });

  describe('dashboard sub-paths', () => {
    it('redirects unauthenticated access to sub-page to login', async () => {
      const ctx = makeContext({
        pathname: '/dashboard/zones/akande',
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('/dashboard/login');
    });

    it('allows authenticated access to sub-page', async () => {
      const secret = 'secret123';
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      const cookie = await makeSessionCookie(secret, futureExpiry);
      const ctx = makeContext({
        pathname: '/dashboard/zones/akande',
        cookie,
        env: { DASHBOARD_PASSWORD: secret },
      });
      const res = await onRequest(ctx);
      expect(ctx.next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  describe('login page structure', () => {
    it('login page includes form action to /dashboard/login', async () => {
      const ctx = makeContext({
        pathname: '/dashboard/login',
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      const body = await res.text();
      expect(body).toContain('action');
    });

    it('login page includes password input type', async () => {
      const ctx = makeContext({
        pathname: '/dashboard/login',
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      const body = await res.text();
      expect(body).toContain('type="password"');
    });

    it('login page has Cache-Control to prevent caching', async () => {
      const ctx = makeContext({
        pathname: '/dashboard/login',
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      // Login page should not be cached
      const cc = res.headers.get('Cache-Control');
      if (cc) {
        expect(cc).toContain('no');
      }
    });
  });

  describe('session cookie attributes', () => {
    it('successful login sets HttpOnly cookie', async () => {
      const fd = makeFormData({ password: 'secret123' });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
    });

    it('successful login sets Secure cookie', async () => {
      const fd = makeFormData({ password: 'secret123' });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.headers.get('Set-Cookie')).toContain('Secure');
    });

    it('successful login sets SameSite=Strict', async () => {
      const fd = makeFormData({ password: 'secret123' });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.headers.get('Set-Cookie')).toContain('SameSite=Strict');
    });

    it('successful login sets Path=/dashboard', async () => {
      const fd = makeFormData({ password: 'secret123' });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_PASSWORD: 'secret123' },
      });
      const res = await onRequest(ctx);
      expect(res.headers.get('Set-Cookie')).toContain('Path=/dashboard');
    });
  });

  describe('DASHBOARD_SECRET vs DASHBOARD_PASSWORD priority', () => {
    it('DASHBOARD_SECRET takes priority for session signing', async () => {
      const secret = 'the-secret';
      const fd = makeFormData({ password: secret });
      const ctx = makeContext({
        method: 'POST',
        pathname: '/dashboard/login',
        formData: fd,
        env: { DASHBOARD_SECRET: secret, DASHBOARD_PASSWORD: 'other-pass' },
      });
      const res = await onRequest(ctx);
      expect(res.status).toBe(302);
      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toContain('cdn_session=');
    });
  });
});
