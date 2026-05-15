/**
 * Dashboard auth middleware.
 *
 * Protects /dashboard/* with a session cookie.
 * Login via /dashboard/login with DASHBOARD_PASSWORD env var.
 * Session is an HMAC-signed token stored in a secure cookie.
 */

import { hmacSign, hmacVerify, hmacVerifyCached, parseCookies } from '../api/_shared.js';

const SESSION_COOKIE = 'cdn_session';
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CloudCDN — Login</title>
  <meta name="theme-color" content="#08090d">
  <script src="/shared/theme-boot.js"></script>
  <link rel="stylesheet" href="/shared/theme.css">
  <script defer src="/shared/theme-toggle.js"></script>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: var(--surface); border: 1px solid var(--border-subtle); border-radius: 1rem; padding: 2.5rem; width: 100%; max-width: 380px; box-shadow: var(--shadow-lg); }
    h1 { font-size: 1.25rem; font-weight: 700; color: var(--heading); margin-bottom: 0.25rem; }
    h1 span { color: var(--accent-text); }
    p { font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.375rem; }
    input { width: 100%; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: 0.5rem; padding: 0.625rem 0.75rem; color: var(--text); font-size: 0.875rem; outline: none; transition: border-color 0.15s; }
    input:focus { border-color: var(--accent); }
    button { width: 100%; background: #4f46e5; border: none; border-radius: 0.5rem; padding: 0.625rem; color: #fff; font-size: 0.875rem; font-weight: 600; cursor: pointer; margin-top: 1rem; transition: background 0.15s; }
    button:hover { background: var(--accent); }
    .error { color: light-dark(#dc2626, #ef4444); font-size: 0.75rem; margin-top: 0.75rem; display: none; }
    .error.show { display: block; }
    .or-divider { text-align: center; margin-top: 1rem; font-size: 0.75rem; color: var(--text-dim); }
    .passkey-btn { width: 100%; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: 0.5rem; padding: 0.625rem; color: var(--text); font-size: 0.875rem; cursor: pointer; margin-top: 0.5rem; transition: border-color 0.15s; }
    .passkey-btn:hover { border-color: var(--accent); }
    .theme-toggle { position: fixed; top: 1rem; inset-inline-end: 1rem; }
  </style>
</head>
<body>
  <button type="button" class="theme-toggle" aria-label="Switch to light mode" aria-pressed="false" title="Toggle theme">
    <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </svg>
    <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
    </svg>
  </button>
  <form class="card" method="POST" action="/dashboard/login">
    <h1>Cloud<span>CDN</span></h1>
    <p>Sign in to the asset dashboard</p>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required autofocus placeholder="Enter dashboard password">
    <button type="submit">Sign in</button>
    <div class="or-divider">or</div>
    <button type="button" id="passkey-btn" class="passkey-btn">Sign in with Passkey</button>
    <p class="error ERRCLASS">Invalid password. Please try again.</p>
  </form>
  <script src="/dashboard/_login.js"></script>
</body>
</html>`;

const SETUP_PASSKEY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CloudCDN — Set Up Passkey</title>
  <meta name="theme-color" content="#08090d">
  <script src="/shared/theme-boot.js"></script>
  <link rel="stylesheet" href="/shared/theme.css">
  <script defer src="/shared/theme-toggle.js"></script>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: var(--surface); border: 1px solid var(--border-subtle); border-radius: 1rem; padding: 2.5rem; width: 100%; max-width: 420px; box-shadow: var(--shadow-lg); }
    h1 { font-size: 1.25rem; font-weight: 700; color: var(--heading); margin-bottom: 0.25rem; }
    h1 span { color: var(--accent-text); }
    p { font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1.5rem; line-height: 1.6; }
    .icon { width: 48px; height: 48px; margin: 0 auto 1.25rem; display: block; opacity: 0.9; color: var(--accent-text); }
    label { display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.375rem; }
    input { width: 100%; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: 0.5rem; padding: 0.625rem 0.75rem; color: var(--text); font-size: 0.875rem; outline: none; transition: border-color 0.15s; margin-bottom: 1rem; }
    input:focus { border-color: var(--accent); }
    .btn-primary { width: 100%; background: #4f46e5; border: none; border-radius: 0.5rem; padding: 0.75rem; color: #fff; font-size: 0.875rem; font-weight: 600; cursor: pointer; transition: background 0.15s; }
    .btn-primary:hover { background: var(--accent); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-skip { width: 100%; background: transparent; border: 1px solid var(--border-subtle); border-radius: 0.5rem; padding: 0.625rem; color: var(--text-muted); font-size: 0.8125rem; cursor: pointer; margin-top: 0.75rem; transition: border-color 0.15s, color 0.15s; text-decoration: none; display: block; text-align: center; }
    .btn-skip:hover { border-color: var(--accent); color: var(--text); }
    .status { font-size: 0.75rem; margin-top: 1rem; text-align: center; min-height: 1.25rem; }
    .status.success { color: var(--green); }
    .status.error { color: light-dark(#dc2626, #ef4444); }
    .passkey-list { margin-top: 1rem; }
    .passkey-item { display: flex; justify-content: space-between; align-items: center; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: 0.5rem; padding: 0.625rem 0.75rem; margin-bottom: 0.5rem; font-size: 0.8125rem; }
    .passkey-item .name { color: var(--text); font-weight: 500; }
    .passkey-item .date { color: var(--text-dim); font-size: 0.6875rem; }
    .check { color: var(--green); font-size: 1.25rem; display: none; text-align: center; margin-bottom: 1rem; }
    .check.show { display: block; }
    .theme-toggle { position: fixed; top: 1rem; inset-inline-end: 1rem; }
  </style>
</head>
<body>
  <button type="button" class="theme-toggle" aria-label="Switch to light mode" aria-pressed="false" title="Toggle theme">
    <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </svg>
    <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
    </svg>
  </button>
  <div class="card">
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <circle cx="12" cy="12" r="2"/>
      <path d="M6 12h2M16 12h2"/>
    </svg>
    <h1>Cloud<span>CDN</span></h1>
    <p>Secure your dashboard with a passkey. Passkeys use your device's biometrics (fingerprint, face, or PIN) — no password to remember.</p>

    <div id="existing-passkeys" class="passkey-list" style="display:none;"></div>

    <label for="passkey-name">Passkey Name</label>
    <input type="text" id="passkey-name" placeholder="e.g., MacBook Pro, YubiKey" value="">

    <button class="btn-primary" id="register-btn">Register Passkey</button>
    <p class="status" id="status"></p>

    <div class="check" id="success-check">&#10003; Passkey registered</div>

    <a href="/dashboard/" class="btn-skip" id="skip-link">Skip for now — go to dashboard</a>
  </div>

  <script src="/dashboard/_setup-passkey.js"></script>
</body>
</html>`;

// Dashboard CSP — matches the global public-page CSP exactly now that
// all inline <script> blocks and onclick/onchange/oninput attributes
// have been externalized (see cdn/en/dashboard/_upload-tab.js and
// _upload-page.js). The override stays here as a single source of
// truth for what /dashboard/* responses serve, and so any future
// dashboard-only tightening (e.g. stricter style-src) is colocated
// with the auth handler.
const DASHBOARD_CSP =
  "script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
  "object-src 'none'; upgrade-insecure-requests";

function withDashboardCsp(response) {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', DASHBOARD_CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleRequest(context) {
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

    // Constant-time password verification using HMAC comparison.
    // Both the submitted password and stored secret are HMAC-signed with
    // a fixed key, then compared via timingSafeEqual — preventing timing
    // attacks that could leak password length or content.
    const passwordMatch = await hmacVerify('cloudcdn-pw-check', password, await hmacSign('cloudcdn-pw-check', secret));

    if (passwordMatch) {
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
      const cookie = `${SESSION_COOKIE}=${token}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;

      const loginRes = new Response(null, { status: 302, headers: { 'Location': '/dashboard/setup-passkey' } });
      loginRes.headers.append('Set-Cookie', cookie);
      // Non-HttpOnly indicator cookie for JS-based UI (login/logout toggle)
      loginRes.headers.append('Set-Cookie', `cdn_logged_in=1; Path=/; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`);
      // Clear any stale cookie with old Path=/dashboard
      loginRes.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
      return loginRes;
    }

    // Wrong password
    return new Response(LOGIN_HTML.replace('ERRCLASS', 'show'), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Handle passkey setup page (served after successful login)
  if (url.pathname === '/dashboard/setup-passkey') {
    // Must be authenticated to see this page
    const cookies = parseCookies(request.headers.get('Cookie'));
    const session = cookies[SESSION_COOKIE];
    let authenticated = false;
    if (session) {
      const lastDot = session.lastIndexOf('.');
      if (lastDot > 0) {
        const token = session.slice(0, lastDot);
        const sig = session.slice(lastDot + 1);
        if (token && sig) {
          const valid = await hmacVerifyCached(secret, token, sig);
          const expires = parseInt(token, 10);
          if (valid && expires > Date.now() / 1000) authenticated = true;
        }
      }
    }
    if (!authenticated) return Response.redirect(new URL('/dashboard/login', url.origin).toString(), 302);

    return new Response(SETUP_PASSKEY_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Handle logout — clears cookies on both old (Path=/dashboard) and new (Path=/) paths
  if (url.pathname === '/dashboard/logout') {
    const res = new Response(null, { status: 302, headers: { 'Location': '/dashboard/login' } });
    res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    res.headers.append('Set-Cookie', `cdn_logged_in=; Path=/; Secure; SameSite=Strict; Max-Age=0`);
    return res;
  }

  // Handle login page GET
  if (url.pathname === '/dashboard/login') {
    return new Response(LOGIN_HTML.replace('ERRCLASS', ''), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Public assets needed by the unauthenticated login page. The login HTML
  // references /dashboard/_login.js for the passkey button handler (CSP
  // requires same-origin script-src, so we can't keep it inline). This
  // route bypasses the session check so the browser can fetch the JS
  // without first being redirected to the login page.
  if (url.pathname === '/dashboard/_login.js') {
    const rewritten = new URL(request.url);
    rewritten.pathname = '/cdn/en/dashboard/_login.js';
    return env.ASSETS.fetch(new Request(rewritten.toString(), request));
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
          // Rewrite /dashboard/* to /cdn/en/dashboard/* for static asset
          // serving. Keep the trailing slash for directory paths — do NOT
          // append index.html. Pages' asset binding 308-redirects explicit
          // index.html paths to the directory form, and that 308 would
          // bounce the browser to /cdn/en/dashboard/, where the public
          // middleware's /cdn/<locale>/... canonicalisation would 301 it
          // back to /dashboard/, looping for authenticated users. Asking
          // for the directory makes env.ASSETS serve the index directly.
          const rewrittenUrl = new URL(request.url);
          rewrittenUrl.pathname = '/cdn/en' + url.pathname;
          return env.ASSETS.fetch(new Request(rewrittenUrl.toString(), request));
        }
      }
    }
  }

  // Not authenticated — redirect to login
  return Response.redirect(new URL('/dashboard/login', url.origin).toString(), 302);
}

export async function onRequest(context) {
  const response = await handleRequest(context);
  // Skip header rewriting on redirects — they have no body and editing
  // their headers via the new Response() trick strips the Location.
  if (response.status >= 300 && response.status < 400) return response;
  return withDashboardCsp(response);
}
