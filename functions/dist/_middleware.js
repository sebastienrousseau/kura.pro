/**
 * Dist auth middleware — reuses the same session cookie from dashboard login.
 */

const SESSION_COOKIE = 'cdn_session';

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

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  }
  return cookies;
}

export async function onRequest(context) {
  const { request, env } = context;
  const secret = env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;

  if (!secret) return context.next();

  const cookies = parseCookies(request.headers.get('Cookie'));
  const session = cookies[SESSION_COOKIE];

  if (session) {
    const [token, sig] = session.split('.');
    if (token && sig) {
      const expected = await hmacSign(secret, token);
      const expires = parseInt(token, 10);
      if (expected === sig && expires > Date.now() / 1000) {
        return context.next();
      }
    }
  }

  const url = new URL(request.url);
  return Response.redirect(new URL('/dashboard/login', url.origin).toString(), 302);
}
