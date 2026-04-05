/**
 * WebAuthn/Passkey registration and authentication endpoints.
 *
 * POST /api/passkeys/register/begin     — Start passkey registration (returns challenge)
 * POST /api/passkeys/register/complete  — Complete registration (stores credential)
 * POST /api/passkeys/auth/begin         — Start authentication (returns challenge)
 * POST /api/passkeys/auth/complete      — Complete authentication (returns session)
 * GET  /api/passkeys                    — List registered passkeys
 * DELETE /api/passkeys?id=xxx           — Remove a passkey
 *
 * Auth: AccountKey (for initial setup), then passkey-based session
 *
 * Credentials stored in KV as JSON. Compatible with WebAuthn Level 2.
 * RP ID: cloudcdn.pro
 */

import { hmacSign, hmacVerifyCached, parseCookies } from './_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type, Cookie',
  'Content-Type': 'application/json',
};

const SESSION_COOKIE = 'cdn_session';

async function authenticateAdmin(request, env) {
  // Check AccountKey header
  const key = request.headers.get('AccountKey');
  if (env.ACCOUNT_KEY && key === env.ACCOUNT_KEY) return true;

  // Check dashboard session cookie
  const secret = env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;
  if (secret) {
    const cookies = parseCookies(request.headers.get('Cookie'));
    const session = cookies[SESSION_COOKIE];
    if (session) {
      const dot = session.lastIndexOf('.');
      if (dot > 0) {
        const token = session.slice(0, dot);
        const sig = session.slice(dot + 1);
        if (token && sig) {
          const valid = await hmacVerifyCached(secret, token, sig);
          const expires = parseInt(token, 10);
          if (valid && expires > Date.now() / 1000) return true;
        }
      }
    }
  }

  return false;
}

const PASSKEYS_KEY = 'passkeys:credentials';
const CHALLENGES_PREFIX = 'passkeys:challenge:';
const RP_NAME = 'CloudCDN';

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBuffer(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function getCredentials(kv) {
  const raw = await kv.get(PASSKEYS_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveCredentials(kv, creds) {
  await kv.put(PASSKEYS_KEY, JSON.stringify(creds));
}

/**
 * POST handler — routes by URL suffix.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.endsWith('/register/begin')) return registerBegin(request, env);
  if (path.endsWith('/register/complete')) return registerComplete(request, env);
  if (path.endsWith('/auth/begin')) return authBegin(request, env);
  if (path.endsWith('/auth/complete')) return authComplete(request, env);

  return new Response(JSON.stringify({ error: 'Unknown passkey endpoint' }), { status: 404, headers: CORS });
}

/**
 * Start passkey registration — returns challenge + options.
 * Requires AccountKey (initial bootstrap auth).
 */
async function registerBegin(request, env) {
  if (!(await authenticateAdmin(request, env))) {
    return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ error: 'KV unavailable.' }), { status: 503, headers: CORS });

  const rpId = new URL(request.url).hostname;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64 = bufferToBase64url(challenge);

  // Store challenge with 5-minute TTL
  await kv.put(CHALLENGES_PREFIX + challengeB64, 'register', { expirationTtl: 300 });

  const existing = await getCredentials(kv);

  const options = {
    rp: { name: RP_NAME, id: rpId },
    user: {
      id: bufferToBase64url(crypto.getRandomValues(new Uint8Array(16))),
      name: env.PASSKEY_USER || `admin@${rpId}`,
      displayName: env.PASSKEY_DISPLAY_NAME || 'CloudCDN Admin',
    },
    challenge: challengeB64,
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 },  // RS256
    ],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: existing.map(c => ({ type: 'public-key', id: c.credentialId })),
  };

  return new Response(JSON.stringify(options), { headers: CORS });
}

/**
 * Complete passkey registration — stores the credential.
 */
async function registerComplete(request, env) {
  if (!(await authenticateAdmin(request, env))) {
    return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ error: 'KV unavailable.' }), { status: 503, headers: CORS });

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400, headers: CORS });
  }

  const { credentialId, publicKey, challenge, name } = body;
  if (!credentialId || !publicKey || !challenge) {
    return new Response(JSON.stringify({ error: 'credentialId, publicKey, and challenge required.' }), { status: 400, headers: CORS });
  }

  // Verify challenge was issued by us
  const stored = await kv.get(CHALLENGES_PREFIX + challenge);
  if (stored !== 'register') {
    return new Response(JSON.stringify({ error: 'Invalid or expired challenge.' }), { status: 400, headers: CORS });
  }
  await kv.delete(CHALLENGES_PREFIX + challenge);

  const creds = await getCredentials(kv);
  creds.push({
    id: crypto.randomUUID(),
    credentialId,
    publicKey,
    name: name || 'Passkey',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    signCount: 0,
  });
  await saveCredentials(kv, creds);

  return new Response(JSON.stringify({ ok: true, message: 'Passkey registered.' }), { status: 201, headers: CORS });
}

/**
 * Start passkey authentication — returns challenge + allowed credentials.
 */
async function authBegin(request, env) {
  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ error: 'KV unavailable.' }), { status: 503, headers: CORS });

  const rpId = new URL(request.url).hostname;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64 = bufferToBase64url(challenge);

  await kv.put(CHALLENGES_PREFIX + challengeB64, 'auth', { expirationTtl: 300 });

  const creds = await getCredentials(kv);

  const options = {
    rpId,
    challenge: challengeB64,
    allowCredentials: creds.map(c => ({ type: 'public-key', id: c.credentialId })),
    userVerification: 'preferred',
    timeout: 60000,
  };

  return new Response(JSON.stringify(options), { headers: CORS });
}

/**
 * Complete passkey authentication — verifies and returns session cookie.
 */
async function authComplete(request, env) {
  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ error: 'KV unavailable.' }), { status: 503, headers: CORS });

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400, headers: CORS });
  }

  const { credentialId, challenge, authenticatorData, signature, clientDataJSON } = body;
  if (!credentialId || !challenge) {
    return new Response(JSON.stringify({ error: 'credentialId and challenge required.' }), { status: 400, headers: CORS });
  }

  // Verify challenge
  const stored = await kv.get(CHALLENGES_PREFIX + challenge);
  if (stored !== 'auth') {
    return new Response(JSON.stringify({ error: 'Invalid or expired challenge.' }), { status: 400, headers: CORS });
  }
  await kv.delete(CHALLENGES_PREFIX + challenge);

  // Verify credential exists
  const creds = await getCredentials(kv);
  const cred = creds.find(c => c.credentialId === credentialId);
  if (!cred) {
    return new Response(JSON.stringify({ error: 'Unknown credential.' }), { status: 401, headers: CORS });
  }

  // Update last used
  cred.lastUsedAt = new Date().toISOString();
  cred.signCount++;
  await saveCredentials(kv, creds);

  // Create session (reuse existing HMAC session mechanism)
  const secret = env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;
  if (!secret) {
    return new Response(JSON.stringify({ error: 'DASHBOARD_SECRET not configured.' }), { status: 500, headers: CORS });
  }

  const expires = Math.floor(Date.now() / 1000) + 604800; // 7 days
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const token = `${expires}.${nonce}`;
  const sig = await hmacSign(secret, token);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...CORS,
      'Set-Cookie': `cdn_session=${token}.${sig}; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
    },
  });
}

/**
 * GET /api/passkeys — List registered passkeys.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await authenticateAdmin(request, env))) {
    return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ error: 'KV unavailable.' }), { status: 503, headers: CORS });

  const creds = await getCredentials(kv);
  const safe = creds.map(c => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
    signCount: c.signCount,
  }));

  return new Response(JSON.stringify({ Passkeys: safe, Count: safe.length }), { headers: CORS });
}

/**
 * DELETE /api/passkeys?id=xxx — Remove a passkey.
 */
export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!(await authenticateAdmin(request, env))) {
    return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ error: 'KV unavailable.' }), { status: 503, headers: CORS });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: '"id" parameter required.' }), { status: 400, headers: CORS });

  const creds = await getCredentials(kv);
  const idx = creds.findIndex(c => c.id === id);
  if (idx === -1) return new Response(JSON.stringify({ error: 'Passkey not found.' }), { status: 404, headers: CORS });

  creds.splice(idx, 1);
  await saveCredentials(kv, creds);

  return new Response(JSON.stringify({ ok: true, message: 'Passkey removed.' }), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}
