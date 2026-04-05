/**
 * Dashboard auth middleware.
 *
 * Protects /dashboard/* with a session cookie.
 * Login via /dashboard/login with DASHBOARD_PASSWORD env var.
 * Session is an HMAC-signed token stored in a secure cookie.
 */

import { hmacSign, hmacVerifyCached, parseCookies } from '../api/_shared.js';

const SESSION_COOKIE = 'cdn_session';
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

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
    <div style="text-align:center;margin-top:1rem;">
      <span style="font-size:0.75rem;color:#5b5f73;">or</span>
    </div>
    <button type="button" id="passkey-btn" style="width:100%;background:#1a1d27;border:1px solid #2a2d3a;border-radius:0.5rem;padding:0.625rem;color:#e2e4ea;font-size:0.875rem;cursor:pointer;margin-top:0.5rem;transition:border-color 0.15s;" onmouseover="this.style.borderColor='#6366f1'" onmouseout="this.style.borderColor='#2a2d3a'" onclick="loginWithPasskey()">Sign in with Passkey</button>
    <p class="error ERRCLASS">Invalid password. Please try again.</p>
  </form>
  <script>
  async function loginWithPasskey() {
    try {
      const beginRes = await fetch('/api/passkeys/auth/begin', { method: 'POST' });
      if (!beginRes.ok) { alert('No passkeys registered.'); return; }
      const options = await beginRes.json();
      options.challenge = Uint8Array.from(atob(options.challenge.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
      if (options.allowCredentials) {
        options.allowCredentials = options.allowCredentials.map(c => ({
          ...c, id: Uint8Array.from(atob(c.id.replace(/-/g,'+').replace(/_/g,'/')), ch => ch.charCodeAt(0))
        }));
      }
      const credential = await navigator.credentials.get({ publicKey: options });
      const completeRes = await fetch('/api/passkeys/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentialId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,''),
          challenge: btoa(String.fromCharCode(...options.challenge)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,''),
        }),
      });
      if (completeRes.ok) window.location.href = '/dashboard/';
      else alert('Passkey authentication failed.');
    } catch (e) { if (e.name !== 'NotAllowedError') alert('Passkey error: ' + e.message); }
  }
  </script>
</body>
</html>`;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const secret = env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;

  // If no password is configured: allow only on localhost (dev mode), deny in production
  if (!secret) {
    const host = request.headers.get('host') || '';
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
      return context.next();
    }
    // Fail closed in production — require DASHBOARD_PASSWORD to be set
    return new Response('Dashboard requires authentication. Set DASHBOARD_PASSWORD in environment variables.', { status: 503 });
  }

  // Handle login POST
  if (url.pathname === '/dashboard/login' && request.method === 'POST') {
    // Brute-force protection: 5 attempts per IP per 15 minutes
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    if (env.RATE_KV) {
      const loginKey = `login:${ip}`;
      const attempts = parseInt(await env.RATE_KV.get(loginKey) || '0', 10);
      if (attempts >= 5) {
        return new Response(LOGIN_HTML.replace('ERRCLASS', 'show').replace('Invalid password. Please try again.', 'Too many login attempts. Please wait 15 minutes.'), {
          status: 429,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '900' },
        });
      }
      await env.RATE_KV.put(loginKey, String(attempts + 1), { expirationTtl: 900 });
    }

    const form = await request.formData();
    const password = form.get('password') || '';

    if (password === secret) {
      // Clear login attempts on success
      if (env.RATE_KV) {
        const loginKey = `login:${ip}`;
        await env.RATE_KV.delete(loginKey);
      }

      // Create signed session token with random nonce
      const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
      const token = `${expires}.${nonce}`;
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
    const lastDot = session.lastIndexOf('.');
    if (lastDot > 0) {
      const token = session.slice(0, lastDot);
      const sig = session.slice(lastDot + 1);
      if (token && sig) {
        const valid = await hmacVerifyCached(secret, token, sig);
        const expires = parseInt(token, 10);
        if (valid && expires > Date.now() / 1000) {
          return context.next();
        }
      }
    }
  }

  // Not authenticated — redirect to login
  return Response.redirect(new URL('/dashboard/login', url.origin).toString(), 302);
}
