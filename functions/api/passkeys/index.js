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

import { hmacSign, hmacVerifyCached, parseCookies } from '../_shared.js';

// Stateless challenge TTL — matches the legacy KV expirationTtl.
const CHALLENGE_TTL_SECONDS = 300;

/**
 * Issue a stateless, signed challenge for either 'auth' or 'register'.
 *
 * Format (decoded): `<nonce>.<expires>.<type>.<hmac-hex>` where:
 *   - nonce:    base64url(32 random bytes)
 *   - expires:  unix-seconds when this challenge becomes invalid
 *   - type:     'auth' | 'register' — prevents cross-flow replay
 *   - hmac:     HMAC-SHA256(secret, `<nonce>.<expires>.<type>`)
 *
 * The whole blob is then base64url-encoded so it survives WebAuthn's
 * byte-array round-trip through the browser → authenticator → server.
 *
 * Why stateless: KV writes hit Cloudflare's free-tier daily cap quickly
 * when login is attempted repeatedly (every authBegin used to write a
 * fresh KV row). HMAC challenges have a 5-minute window built into the
 * signed expiry, need zero storage, and can never exhaust quota.
 */
async function issueChallenge(secret, type) {
  const nonce = bufferToBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS;
  const payload = `${nonce}.${expires}.${type}`;
  const sig = await hmacSign(secret, payload);
  const blob = `${payload}.${sig}`;
  return bufferToBase64url(new TextEncoder().encode(blob));
}

/**
 * Verify a challenge issued by issueChallenge. Returns `true` only when
 * the signature is valid (timing-safe) AND the challenge has not expired
 * AND the embedded type matches the expected flow.
 */
async function verifyChallenge(secret, signedChallenge, expectedType) {
  try {
    const decoded = new TextDecoder().decode(base64urlToBuffer(signedChallenge));
    const parts = decoded.split('.');
    if (parts.length !== 4) return false;
    const [nonce, expiresStr, type, sigHex] = parts;
    if (type !== expectedType) return false;
    const expires = parseInt(expiresStr, 10);
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    const expectedSig = await hmacSign(secret, `${nonce}.${expiresStr}.${type}`);
    // Constant-time hex compare; both are 64-char lowercase hex strings.
    if (sigHex.length !== expectedSig.length) return false;
    let diff = 0;
    for (let i = 0; i < sigHex.length; i++) diff |= sigHex.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

/**
 * Pick the secret used to sign passkey challenges. Falls back from
 * DASHBOARD_SECRET → DASHBOARD_PASSWORD so installs without the new
 * secret env var keep working.
 */
function challengeSecret(env) {
  return env.PASSKEY_CHALLENGE_SECRET || env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;
}

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
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupted KV value — fail soft so authBegin can still return an
    // empty allowCredentials list rather than crashing the Worker.
    // The caller will see "Unknown credential" on completion instead of
    // an opaque Worker exception, and we'll see the issue surface in WAE.
    return [];
  }
}

async function saveCredentials(kv, creds) {
  await kv.put(PASSKEYS_KEY, JSON.stringify(creds));
}

function jsonError(message, status, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), { status, headers: CORS });
}

/**
 * POST handler — routes by URL suffix. Wraps every sub-handler in a
 * try/catch so a thrown KV/JSON/WebCrypto error returns a JSON 500 the
 * client can read, rather than a Cloudflare "Worker threw exception"
 * HTML page that the dashboard can't parse.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path.endsWith('/register/begin')) return await registerBegin(request, env);
    if (path.endsWith('/register/complete')) return await registerComplete(request, env);
    if (path.endsWith('/auth/begin')) return await authBegin(request, env);
    if (path.endsWith('/auth/complete')) return await authComplete(request, env);
  } catch (err) {
    return jsonError('Passkey handler failed', 500, { detail: err?.message || String(err) });
  }

  return jsonError('Unknown passkey endpoint', 404);
}

/**
 * Start passkey registration — returns challenge + options.
 * Requires AccountKey (initial bootstrap auth). Stateless: no KV write.
 */
async function registerBegin(request, env) {
  if (!(await authenticateAdmin(request, env))) {
    return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ error: 'KV unavailable.' }), { status: 503, headers: CORS });

  const secret = challengeSecret(env);
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Challenge secret not configured.' }), { status: 503, headers: CORS });
  }

  const rpId = new URL(request.url).hostname;
  const challengeB64 = await issueChallenge(secret, 'register');

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

  const secret = challengeSecret(env);
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Challenge secret not configured.' }), { status: 503, headers: CORS });
  }

  // Stateless verify: HMAC signature + embedded expiry, no KV roundtrip.
  if (!(await verifyChallenge(secret, challenge, 'register'))) {
    return new Response(JSON.stringify({ error: 'Invalid or expired challenge.' }), { status: 400, headers: CORS });
  }

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
 * Stateless: no KV write for the challenge.
 */
async function authBegin(request, env) {
  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ error: 'KV unavailable.' }), { status: 503, headers: CORS });

  const secret = challengeSecret(env);
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Challenge secret not configured.' }), { status: 503, headers: CORS });
  }

  const rpId = new URL(request.url).hostname;
  const challengeB64 = await issueChallenge(secret, 'auth');

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

  const secret = challengeSecret(env);
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Challenge secret not configured.' }), { status: 503, headers: CORS });
  }

  // Stateless verify — HMAC signature + embedded expiry, no KV read.
  if (!(await verifyChallenge(secret, challenge, 'auth'))) {
    return new Response(JSON.stringify({ error: 'Invalid or expired challenge.' }), { status: 400, headers: CORS });
  }

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

  // Create session using the same secret we signed the challenge with —
  // both flows use challengeSecret(env), which falls back to DASHBOARD_SECRET
  // / DASHBOARD_PASSWORD when a dedicated PASSKEY_CHALLENGE_SECRET isn't set.
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
  try {
    if (!(await authenticateAdmin(request, env))) {
      return jsonError('Authentication required.', 401);
    }

    const kv = env.RATE_KV;
    if (!kv) return jsonError('KV unavailable.', 503);

    const creds = await getCredentials(kv);
    const safe = creds.map(c => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
      signCount: c.signCount,
    }));

    return new Response(JSON.stringify({ Passkeys: safe, Count: safe.length }), { headers: CORS });
  } catch (err) {
    return jsonError('Passkey handler failed', 500, { detail: err?.message || String(err) });
  }
}

/**
 * DELETE /api/passkeys?id=xxx — Remove a passkey.
 */
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    if (!(await authenticateAdmin(request, env))) {
      return jsonError('Authentication required.', 401);
    }

    const kv = env.RATE_KV;
    if (!kv) return jsonError('KV unavailable.', 503);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonError('"id" parameter required.', 400);

    const creds = await getCredentials(kv);
    const idx = creds.findIndex(c => c.id === id);
    if (idx === -1) return jsonError('Passkey not found.', 404);

    creds.splice(idx, 1);
    await saveCredentials(kv, creds);

    return new Response(JSON.stringify({ ok: true, message: 'Passkey removed.' }), { headers: CORS });
  } catch (err) {
    return jsonError('Passkey handler failed', 500, { detail: err?.message || String(err) });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}
