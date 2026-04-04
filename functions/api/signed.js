/**
 * Signed URL verification endpoint.
 *
 * GET /api/signed?path=/protected/client-report.pdf&expires=1712248800&sig=abc123
 *
 * Validates HMAC-SHA256 signature, checks expiration, then proxies the
 * protected asset from origin with appropriate cache headers.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

/**
 * Convert an ArrayBuffer to a hex string.
 */
function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Import a secret string as an HMAC-SHA256 CryptoKey.
 */
async function importKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Compute HMAC-SHA256 hex digest of a message using the given secret.
 */
async function hmacHex(secret, message) {
  const key = await importKey(secret);
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bufferToHex(sig);
}

/**
 * Generate a signed URL object. Useful for server-side code or scripts.
 *
 * @param {string} secret - HMAC secret key
 * @param {string} path - Asset path (e.g. "/protected/report.pdf")
 * @param {number} expiresAt - Unix timestamp (seconds)
 * @returns {Promise<{ url: string, expires: number, sig: string }>}
 */
export async function generateSignedUrl(secret, path, expiresAt) {
  const message = `${path}:${expiresAt}`;
  const sig = await hmacHex(secret, message);
  const params = new URLSearchParams({ path, expires: String(expiresAt), sig });
  return {
    url: `/api/signed?${params.toString()}`,
    expires: expiresAt,
    sig,
  };
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function onRequestGet(context) {
  const { SIGNED_URL_SECRET } = context.env;

  if (!SIGNED_URL_SECRET) {
    return Response.json(
      { error: 'Server misconfigured: SIGNED_URL_SECRET is not set' },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const url = new URL(context.request.url);
  const path = url.searchParams.get('path');
  const expires = url.searchParams.get('expires');
  const sig = url.searchParams.get('sig');

  if (!path || !expires || !sig) {
    return Response.json(
      { error: 'Missing required parameters: path, expires, sig' },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  const expiresNum = parseInt(expires, 10);
  if (isNaN(expiresNum)) {
    return Response.json(
      { error: 'Invalid expires parameter' },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  // Check expiration
  if (Date.now() / 1000 > expiresNum) {
    return Response.json(
      { error: 'URL expired' },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  // Validate signature
  const expectedSig = await hmacHex(SIGNED_URL_SECRET, `${path}:${expires}`);
  if (!timingSafeEqual(expectedSig, sig)) {
    return Response.json(
      { error: 'Invalid signature' },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  // Fetch the protected asset from origin
  const assetUrl = new URL(path, url.origin).toString();
  try {
    const response = await fetch(assetUrl);

    if (!response.ok) {
      return Response.json(
        { error: `Asset not found (${response.status})` },
        { status: response.status, headers: CORS_HEADERS }
      );
    }

    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('X-Signed-URL', 'verified');
    headers.set('Cache-Control', 'private, max-age=3600');

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch {
    return Response.json(
      { error: 'Failed to fetch asset' },
      { status: 502, headers: CORS_HEADERS }
    );
  }
}
