/**
 * Dist auth middleware — reuses the same session cookie from dashboard login.
 */

import { hmacVerifyCached, parseCookies } from '../api/_shared.js';

const SESSION_COOKIE = 'cdn_session';

export async function onRequest(context) {
  const { request, env } = context;
  const secret = env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;

  if (!secret) {
    const host = request.headers.get('host') || '';
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return context.next();
    return new Response('Distribution page requires authentication. Set DASHBOARD_PASSWORD in environment variables.', { status: 503 });
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const session = cookies[SESSION_COOKIE];

  if (session) {
    const dot = session.indexOf('.');
    if (dot > 0) {
      const token = session.slice(0, dot);
      const sig = session.slice(dot + 1);
      if (token && sig) {
        const valid = await hmacVerifyCached(secret, token, sig);
        const expires = parseInt(token, 10);
        if (valid && expires > Date.now() / 1000) {
          return context.next();
        }
      }
    }
  }

  const url = new URL(request.url);
  return Response.redirect(new URL('/dashboard/login', url.origin).toString(), 302);
}
