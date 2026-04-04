/**
 * Dashboard auth middleware.
 *
 * Protects /dashboard/* with a session cookie.
 * Login via /dashboard/login with DASHBOARD_PASSWORD env var.
 * Session is an HMAC-signed token stored in a secure cookie.
 */

const SESSION_COOKIE = 'cdn_session';
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

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

async function hmacVerify(secret, data, signature) {
  const expected = await hmacSign(secret, data);
  return expected === signature;
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

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CloudCDN — Login</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #08090d; color: #e2e4ea; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #0f1117; border: 1px solid #2a2d3a; border-radius: 1rem; padding: 2.5rem; width: 100%; max-width: 380px; }
    h1 { font-size: 1.25rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem; }
    h1 span { color: #6366f1; }
    p { font-size: 0.8125rem; color: #8b8fa3; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.75rem; color: #5b5f73; margin-bottom: 0.375rem; }
    input { width: 100%; background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 0.5rem; padding: 0.625rem 0.75rem; color: #e2e4ea; font-size: 0.875rem; outline: none; transition: border-color 0.15s; }
    input:focus { border-color: #6366f1; }
    button { width: 100%; background: #6366f1; border: none; border-radius: 0.5rem; padding: 0.625rem; color: #fff; font-size: 0.875rem; font-weight: 500; cursor: pointer; margin-top: 1rem; transition: background 0.15s; }
    button:hover { background: #818cf8; }
    .error { color: #ef4444; font-size: 0.75rem; margin-top: 0.75rem; display: none; }
    .error.show { display: block; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/dashboard/login">
    <h1>Cloud<span>CDN</span></h1>
    <p>Sign in to the asset dashboard</p>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required autofocus placeholder="Enter dashboard password">
    <button type="submit">Sign in</button>
    <p class="error ERRCLASS">Invalid password. Please try again.</p>
  </form>
</body>
</html>`;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const secret = env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;

  // If no password is configured, allow access (dev mode)
  if (!secret) {
    return context.next();
  }

  // Handle login POST
  if (url.pathname === '/dashboard/login' && request.method === 'POST') {
    const form = await request.formData();
    const password = form.get('password') || '';

    if (password === secret) {
      // Create signed session token
      const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;
      const token = `${expires}`;
      const sig = await hmacSign(secret, token);
      const cookie = `${SESSION_COOKIE}=${token}.${sig}; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;

      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/dashboard/',
          'Set-Cookie': cookie,
        },
      });
    }

    // Wrong password
    return new Response(LOGIN_HTML.replace('ERRCLASS', 'show'), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Handle login page GET
  if (url.pathname === '/dashboard/login') {
    return new Response(LOGIN_HTML.replace('ERRCLASS', ''), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Verify session cookie
  const cookies = parseCookies(request.headers.get('Cookie'));
  const session = cookies[SESSION_COOKIE];

  if (session) {
    const [token, sig] = session.split('.');
    if (token && sig) {
      const valid = await hmacVerify(secret, token, sig);
      const expires = parseInt(token, 10);
      if (valid && expires > Date.now() / 1000) {
        return context.next();
      }
    }
  }

  // Not authenticated — redirect to login
  return Response.redirect(new URL('/dashboard/login', url.origin).toString(), 302);
}
