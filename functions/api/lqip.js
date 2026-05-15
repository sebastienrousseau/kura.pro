/**
 * Low-quality image placeholder (LQIP) endpoint.
 *
 * GET /api/lqip?url=/clients/akande/v1/logos/logo.svg&size=32
 *
 * Returns a base64-encoded data URI for a tiny, heavily-blurred WebP version
 * of the requested asset. The client embeds the data URI as a CSS
 * `background-image` (or `<img src>`) while the full asset loads, giving
 * users an instant visual placeholder.
 *
 * Response shape:
 *   {
 *     lqip: "data:image/webp;base64,UklGRiQAAABXR...",
 *     bytes: 1240,
 *     width: 32,
 *     dateGenerated: "2026-05-13T19:00:00Z",
 *   }
 *
 * Implementation: leans on Cloudflare's Image Resizing pipeline via
 * `cf.image` options the way /api/transform does — no new image library or
 * binding required. Encodes the resulting bytes to base64 server-side so
 * the client gets a single drop-in string.
 */

import { checkRateLimit, errorResponse, log, rateLimitHeaders } from './_shared.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const DEFAULT_SIZE = 32;
const MAX_SIZE = 64;
const RATE_LIMIT_PER_MIN = 200;

function clampSize(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(8, Math.min(MAX_SIZE, n));
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env, `rl:lqip:${ip}`, RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', `Rate limit exceeded. Maximum ${RATE_LIMIT_PER_MIN} requests per minute per IP.`, { retryAfter: '60', limit: rl.limit });
  }

  const url = new URL(request.url);
  const assetUrl = url.searchParams.get('url');
  if (!assetUrl) {
    return errorResponse(400, 'MissingUrl', 'The "url" query parameter is required. Provide a relative asset path (e.g. /clients/akande/v1/logos/logo.svg).');
  }
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    return errorResponse(400, 'AbsoluteUrlForbidden', 'Absolute URLs are not allowed. Use a relative path.');
  }
  if (assetUrl.includes('..') || assetUrl.includes('\0') || assetUrl.includes('//')) {
    return errorResponse(400, 'InvalidUrl', 'URL contains disallowed sequences (traversal, null byte, or empty segments).');
  }

  const size = clampSize(url.searchParams.get('size'));
  const blur = clampSize(url.searchParams.get('blur') || '30');

  const originUrl = new URL(assetUrl, url.origin).toString();
  const imageOpts = {
    width: size,
    quality: 30,
    format: 'webp',
    blur: Math.min(250, blur),
  };

  let response;
  try {
    response = await fetch(originUrl, { cf: { image: imageOpts } });
  } catch (err) {
    log.error('LQIP_FETCH_ERROR', err.message);
    return errorResponse(502, 'OriginUnreachable', 'Origin asset fetch failed. Verify the path resolves to a real image.');
  }

  if (!response.ok) {
    return errorResponse(response.status >= 500 ? 502 : 404, 'AssetNotFound', `Upstream returned ${response.status}.`);
  }

  let buf;
  try {
    buf = await response.arrayBuffer();
  } catch (err) {
    log.error('LQIP_READ_ERROR', err.message);
    return errorResponse(502, 'OriginReadFailed', 'Failed to read placeholder bytes from origin.');
  }

  const base64 = arrayBufferToBase64(buf);
  const lqip = `data:image/webp;base64,${base64}`;

  return new Response(JSON.stringify({
    lqip,
    bytes: buf.byteLength,
    width: size,
    dateGenerated: new Date().toISOString(),
  }), {
    headers: {
      ...CORS_HEADERS,
      ...rateLimitHeaders(rl),
      // The placeholder is deterministic per (url, size, blur), so cache it
      // for a day. Vary is unnecessary — no Accept negotiation.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' },
  });
}
