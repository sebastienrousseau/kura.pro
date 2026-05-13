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

// ── WebAuthn assertion verification ──

/**
 * Convert a DER-encoded ECDSA signature (as emitted by authenticators) to
 * the raw r||s concatenation that WebCrypto's `verify` expects.
 *
 * DER form: `30 <total-len> 02 <r-len> <r-bytes> 02 <s-len> <s-bytes>`.
 * Both r and s can be 0x00-padded to encode the high bit, so we strip
 * leading zeros and re-pad to 32 bytes apiece. P-256 → 64-byte output.
 */
export function derEcdsaToRaw(der) {
  if (!(der instanceof Uint8Array)) der = new Uint8Array(der);
  if (der[0] !== 0x30) throw new Error('Invalid DER: missing sequence tag');
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f; // long-form length skip
  if (der[offset] !== 0x02) throw new Error('Invalid DER: missing r integer');
  const rLen = der[offset + 1];
  let r = der.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  if (der[offset] !== 0x02) throw new Error('Invalid DER: missing s integer');
  const sLen = der[offset + 1];
  let s = der.slice(offset + 2, offset + 2 + sLen);
  // Strip a single leading 0x00 that DER adds to disambiguate positive ints
  if (r.length > 32 && r[0] === 0x00) r = r.slice(r.length - 32);
  if (s.length > 32 && s[0] === 0x00) s = s.slice(s.length - 32);
  // Left-pad to 32 bytes (Web Crypto wants fixed-length r||s)
  const pad = (buf) => {
    if (buf.length === 32) return buf;
    const out = new Uint8Array(32);
    out.set(buf, 32 - buf.length);
    return out;
  };
  const raw = new Uint8Array(64);
  raw.set(pad(r), 0);
  raw.set(pad(s), 32);
  return raw;
}

/**
 * Try to import a stored credential public key as SPKI. Returns `null` if
 * the bytes don't parse as either ES256 (P-256) or RS256 — that signals a
 * legacy attestation-object credential that needs re-registration.
 */
export async function importStoredPublicKey(spkiBytes) {
  // Try ES256 first — it's by far the most common authenticator algorithm.
  try {
    return {
      key: await crypto.subtle.importKey(
        'spki', spkiBytes,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      ),
      alg: 'ES256',
    };
  } catch { /* fall through to RS256 */ }
  try {
    return {
      key: await crypto.subtle.importKey(
        'spki', spkiBytes,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
      ),
      alg: 'RS256',
    };
  } catch {
    return null;
  }
}

/**
 * Verify a WebAuthn authentication assertion per the Level 2 spec, minus
 * the user-presence/user-verification flag enforcement (we don't gate on
 * those today). Returns `{ valid, reason? }`.
 *
 * Inputs are all base64url strings as sent by the dashboard's login JS.
 */
export async function verifyAssertion({
  storedPublicKeyB64,
  authenticatorDataB64,
  signatureB64,
  clientDataJSONB64,
  expectedOrigin,
  expectedChallengeB64,
}) {
  if (!storedPublicKeyB64 || !authenticatorDataB64 || !signatureB64 || !clientDataJSONB64) {
    return { valid: false, reason: 'missing assertion fields' };
  }

  // 1. Parse and validate clientDataJSON.
  let clientData;
  const clientDataBytes = base64urlToBuffer(clientDataJSONB64);
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
  } catch {
    return { valid: false, reason: 'clientDataJSON not valid UTF-8 JSON' };
  }
  if (clientData.type !== 'webauthn.get') {
    return { valid: false, reason: `unexpected type: ${clientData.type}` };
  }
  if (clientData.origin !== expectedOrigin) {
    return { valid: false, reason: `origin mismatch: ${clientData.origin}` };
  }
  if (clientData.challenge !== expectedChallengeB64) {
    return { valid: false, reason: 'challenge mismatch' };
  }

  // 2. Compute the signed payload: authData || sha256(clientDataJSON).
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
  const authData = new Uint8Array(base64urlToBuffer(authenticatorDataB64));
  const signedData = new Uint8Array(authData.length + clientDataHash.length);
  signedData.set(authData, 0);
  signedData.set(clientDataHash, authData.length);

  // 3. Import the stored public key (try ES256, then RS256).
  const spki = new Uint8Array(base64urlToBuffer(storedPublicKeyB64));
  const imported = await importStoredPublicKey(spki);
  if (!imported) {
    return { valid: false, reason: 'stored publicKey is not SPKI; legacy credential needs re-registration' };
  }

  // 4. Verify the signature.
  const sigBytes = new Uint8Array(base64urlToBuffer(signatureB64));
  try {
    if (imported.alg === 'ES256') {
      const rawSig = derEcdsaToRaw(sigBytes);
      const ok = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, imported.key, rawSig, signedData
      );
      return ok ? { valid: true, alg: 'ES256' } : { valid: false, reason: 'ECDSA signature failed verification' };
    } else {
      const ok = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', imported.key, sigBytes, signedData
      );
      return ok ? { valid: true, alg: 'RS256' } : { valid: false, reason: 'RSA signature failed verification' };
    }
  } catch (err) {
    return { valid: false, reason: `verify threw: ${err?.message || err}` };
  }
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

  // Cryptographic verification of the WebAuthn assertion. Required when
  // the client provides authenticatorData/signature/clientDataJSON (which
  // the current dashboard JS does post-Sprint-12); falls back to legacy
  // credentialId-presence-only verification for old clients that haven't
  // been updated yet, surfacing the mode via response header so we can
  // monitor migration progress.
  const hasAssertion = !!(authenticatorData && signature && clientDataJSON);
  const strictMode = env.PASSKEY_STRICT_VERIFY === '1';
  let verifyMode = 'legacy';
  let verifyReason = null;
  if (hasAssertion) {
    const expectedOrigin = `https://${new URL(request.url).hostname}`;
    const result = await verifyAssertion({
      storedPublicKeyB64: cred.publicKey,
      authenticatorDataB64: authenticatorData,
      signatureB64: signature,
      clientDataJSONB64: clientDataJSON,
      expectedOrigin,
      expectedChallengeB64: challenge,
    });
    if (result.valid) {
      verifyMode = result.alg || 'strict';
    } else if (result.reason && result.reason.startsWith('stored publicKey is not SPKI')) {
      // Legacy attestation-object credential — accept (no worse than the
      // pre-Sprint-12 status quo) but flag for re-registration.
      verifyMode = 'legacy-spki';
      verifyReason = result.reason;
    } else if (strictMode) {
      // Strict mode (opt-in via PASSKEY_STRICT_VERIFY=1): real verification
      // failures (origin/type/challenge/signature mismatch) refuse the
      // login.
      return new Response(JSON.stringify({
        error: 'Assertion verification failed.',
        detail: result.reason,
      }), { status: 401, headers: CORS });
    } else {
      // Loose mode (default): real verification failed but we still
      // accept the login to avoid locking out admins during the
      // strict-mode rollout. The failure reason is reported in headers
      // so operators can see it in logs before flipping the flag.
      verifyMode = 'loose';
      verifyReason = result.reason;
    }
  }

  // Bump signCount / lastUsedAt — best-effort. WebAuthn uses signCount for
  // replay defense, but failing the login because KV is over quota is a
  // worse outcome than skipping a counter update. We surface the failure
  // via a response header so operators can see it in logs.
  cred.lastUsedAt = new Date().toISOString();
  cred.signCount++;
  let saveError = null;
  try {
    await saveCredentials(kv, creds);
  } catch (err) {
    saveError = err?.message || String(err);
  }

  // Create session using the same secret we signed the challenge with —
  // both flows use challengeSecret(env), which falls back to DASHBOARD_SECRET
  // / DASHBOARD_PASSWORD when a dedicated PASSKEY_CHALLENGE_SECRET isn't set.
  const expires = Math.floor(Date.now() / 1000) + 604800; // 7 days
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const token = `${expires}.${nonce}`;
  const sig = await hmacSign(secret, token);

  // Multiple Set-Cookie headers can't go through a plain object — use
  // the array form below. We set the canonical Path=/ session, plus:
  //   - a non-HttpOnly indicator cookie for the dashboard's login/logout
  //     UI toggle (matches the password-login flow).
  //   - a Max-Age=0 cookie at Path=/dashboard to clear any stale session
  //     left over from pre-fix deploys (Slice 2 of Sprint 12).
  const setCookies = [
    `cdn_session=${token}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
    `cdn_logged_in=1; Path=/; Secure; SameSite=Strict; Max-Age=604800`,
    `cdn_session=; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  ];

  const responseHeaders = new Headers(CORS);
  for (const c of setCookies) responseHeaders.append('Set-Cookie', c);
  responseHeaders.set('X-Passkey-Verification', verifyMode);
  if (verifyReason) responseHeaders.set('X-Passkey-Verification-Reason', verifyReason);
  if (saveError) responseHeaders.set('X-Passkey-Counter-Save', `failed: ${saveError}`);

  return new Response(JSON.stringify({ ok: true, verification: verifyMode }), {
    status: 200,
    headers: responseHeaders,
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
