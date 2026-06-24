/**
 * BlurHash-style compact placeholder hash endpoint.
 *
 * GET /api/blurhash?url=/clients/akande/v1/logos/logo.svg
 *
 * BlurHash is a base-83 encoded ~30-char string representing a heavily
 * downsampled image. Clients decode it to a 32x32 placeholder at
 * paint-time and trade ~3 KB of base64 data URI for ~30 chars in HTML/
 * CSS.
 *
 * True BlurHash requires DCT computation that we'd rather not run at the
 * edge for every request. We compute a CloudCDN-flavoured "compact LQIP"
 * that follows the same contract: a short opaque string that a small
 * client-side helper turns into a placeholder. The string is the SHA-256
 * of the downsampled WebP bytes; the bytes themselves are also returned
 * inline as a base64 data URI so a 1-call integration "just works":
 *
 *   {
 *     hash:       "abcd1234...",
 *     dataUri:    "data:image/webp;base64,UklGR...",
 *     width:      32,
 *     dateGenerated,
 *   }
 *
 * Clients that have a BlurHash decoder can use the dataUri path; clients
 * that just want to dedupe placeholders against a content-addressed key
 * use the hash path.
 */

import {
  checkRateLimit, errorResponse, log, rateLimitHeaders,
  hashString, buildCacheKey, cacheGet, cacheSet, headFromGet,
} from './_shared.js';
import { matchedBotUa, isAllowedReferer } from './transform.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const RATE_LIMIT_PER_MIN = 200;
const CACHE_TTL_SEC = 86400;
const DEFAULT_SIZE = 32;
const MIN_SIZE = 8;
const MAX_SIZE = 64;

function clampSize(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // Bot blocklist + Referer guard (PR #108 hardening cohort).
  const ua = request.headers?.get?.('user-agent') || '';
  const botMatch = matchedBotUa(ua);
  if (botMatch) {
    return errorResponse(403, 'bot_blocked', `User-Agent "${botMatch}" is blocked from this endpoint.`);
  }
  const referer = request.headers?.get?.('referer') || '';
  if (!isAllowedReferer(referer)) {
    return errorResponse(403, 'hotlink_blocked', 'Off-domain hotlinking of /api/blurhash is not allowed.');
  }

  const ip = request.headers?.get?.('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env, `rl:blurhash:${ip}`, RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', `Rate limit exceeded. Maximum ${RATE_LIMIT_PER_MIN} requests per minute per IP.`, { retryAfter: '60', limit: rl.limit });
  }

  const reqUrl = new URL(request.url);
  const assetUrl = reqUrl.searchParams.get('url');
  if (!assetUrl) {
    return errorResponse(400, 'MissingUrl', 'The "url" query parameter is required. Provide a relative asset path.');
  }
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    return errorResponse(400, 'AbsoluteUrlForbidden', 'Absolute URLs are not allowed. Use a relative path.');
  }
  if (assetUrl.includes('..') || assetUrl.includes('\0') || assetUrl.includes('//')) {
    return errorResponse(400, 'InvalidUrl', 'URL contains disallowed sequences.');
  }

  const size = clampSize(reqUrl.searchParams.get('size'));

  // Cache lookup — same asset+size always yields the same hash/dataUri.
  const cacheHash = await hashString(`blurhash:${assetUrl}:${size}`);
  const cacheKey = buildCacheKey('blurhash', cacheHash);
  const cached = await cacheGet(cacheKey);
  if (cached?.hash) {
    return new Response(JSON.stringify({ ...cached, source: 'cached' }), {
      headers: { ...CORS_HEADERS, ...rateLimitHeaders(rl), 'Cache-Control': 'public, max-age=86400' },
    });
  }

  // Generate a tiny WebP via Cloudflare Image Resizing — same pipeline
  // /api/lqip uses, just with much smaller dimensions and heavier blur
  // so the bytes carry mostly low-frequency colour information.
  const originUrl = new URL(assetUrl, reqUrl.origin).toString();
  let response;
  try {
    response = await fetch(originUrl, { cf: { image: {
      width: size,
      quality: 35,
      format: 'webp',
      blur: 50,
    } } });
  } catch (err) {
    log.warn('BLURHASH_FETCH_FAIL', err.message);
    return errorResponse(502, 'OriginUnreachable', 'Origin asset fetch failed.');
  }
  if (!response.ok) {
    return errorResponse(response.status >= 500 ? 502 : 404, 'AssetNotFound', `Upstream returned ${response.status}.`);
  }

  let buf;
  try {
    buf = await response.arrayBuffer();
  } catch (err) {
    log.warn('BLURHASH_READ_FAIL', err.message);
    return errorResponse(502, 'OriginReadFailed', 'Failed to read placeholder bytes.');
  }

  const hash = (await sha256Hex(buf)).slice(0, 40); // 40-char content hash
  const dataUri = `data:image/webp;base64,${arrayBufferToBase64(buf)}`;
  const dateGenerated = new Date().toISOString();
  const payload = { url: assetUrl, hash, dataUri, width: size, bytes: buf.byteLength, dateGenerated };
  await cacheSet(cacheKey, payload, CACHE_TTL_SEC);

  return new Response(JSON.stringify({ ...payload, source: 'fresh' }), {
    headers: { ...CORS_HEADERS, ...rateLimitHeaders(rl), 'Cache-Control': 'public, max-age=86400' },
  });
}

export const onRequestHead = headFromGet(onRequestGet);

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400' },
  });
}
