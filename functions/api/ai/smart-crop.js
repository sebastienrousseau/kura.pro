/**
 * AI smart-crop endpoint.
 *
 * GET  /api/ai/smart-crop?url=/clients/akande/v1/logos/logo.svg
 * POST /api/ai/smart-crop  { "url": "..." }
 *
 * Sends the asset to a Workers AI vision model and asks where the visual
 * subject sits. Returns a `gravity` directive compatible with
 * /api/transform's `gravity=` parameter — meaning a caller can chain:
 *
 *   1. POST /api/ai/smart-crop?url=/x.jpg → { gravity: "north" }
 *   2. GET  /api/transform?url=/x.jpg&w=400&h=400&fit=cover&gravity=north
 *
 * Cloudinary's `gravity=auto` and Imgix's `crop=faces` both solve this
 * problem with proprietary closed pipelines. We use Workers AI's open
 * LLaVA model with a deterministic prompt to keep the answer in the
 * fixed set of nine compass directions plus `face` and `center`.
 *
 * Response shape:
 *   {
 *     url,
 *     gravity:    "center" | "north" | "south" | "east" | "west" |
 *                 "northeast" | "northwest" | "southeast" | "southwest" |
 *                 "face",
 *     confidence: "high" | "medium" | "low",
 *     model:      "@cf/llava-hf/llava-1.5-7b-hf",
 *     source:     "ai" | "cached",
 *     degraded:   false,
 *     dateGenerated,
 *   }
 *
 * Caching: 24h response cache keyed on the asset path (a still image has a
 * single best crop, no point recomputing). Hot paths cost zero neurons.
 */

import {
  AI_COST, aiBudgetState, aiBudgetCharge, aiBudgetTrip, isAiQuotaError,
  checkRateLimit, errorResponse, log,
  hashString, buildCacheKey, cacheGet, cacheSet,
  authenticateAny,
} from '../_shared.js';
import { authorizeWithScope } from '../tokens.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const NEURON_COST = 12;
const CACHE_TTL_SEC = 86400;
const RATE_LIMIT_PER_MIN = 60;
const MAX_BYTES = 8 * 1024 * 1024;

const VALID_GRAVITIES = new Set([
  'center', 'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest', 'face',
]);

const PROMPT = `Identify where the most important visual subject of this image is located. Respond with exactly ONE token from this list, nothing else: center north south east west northeast northwest southeast southwest face. Use "face" when a clearly visible human face dominates the frame.`;

// Longest gravity tokens first so a verbose response like "in the southeast
// corner" prefers "southeast" over the shorter "south" substring match.
const GRAVITIES_BY_LENGTH = [...VALID_GRAVITIES].sort((a, b) => b.length - a.length);

function parseGravity(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (VALID_GRAVITIES.has(cleaned)) return cleaned;
  // Fallback: scan for a valid token, longest-first.
  for (const g of GRAVITIES_BY_LENGTH) {
    if (cleaned.includes(g)) return g;
  }
  return null;
}

async function fetchImageBytes(originUrl) {
  const res = await fetch(originUrl);
  if (!res.ok) throw new Error(`origin returned ${res.status}`);
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len > MAX_BYTES) throw new Error('asset exceeds vision-model size cap');
  const buf = await res.arrayBuffer();
  /* v8 ignore next -- content-length pre-check covers the oversize case */
  if (buf.byteLength > MAX_BYTES) throw new Error('asset exceeds vision-model size cap');
  return new Uint8Array(buf);
}

async function handle(context, url) {
  const { request, env } = context;

  const authed = await authorizeWithScope(
    request, env, 'ai:read',
    () => authenticateAny(request, env)
  );
  if (!authed) {
    return errorResponse(401, 'Unauthorized', 'Authentication required. Provide AccountKey, AccessKey, or a scoped Bearer token with "ai:read".');
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env, `rl:smart-crop:${ip}`, RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', `Rate limit exceeded. Maximum ${RATE_LIMIT_PER_MIN} smart-crop calls per minute per IP.`, { retryAfter: '60', limit: rl.limit });
  }

  if (!url || typeof url !== 'string' || url.length === 0) {
    return errorResponse(400, 'MissingUrl', 'The "url" field is required.');
  }
  if (url.length > 2048) {
    return errorResponse(400, 'UrlTooLong', 'URL exceeds the 2048-character maximum.');
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return errorResponse(400, 'AbsoluteUrlForbidden', 'Absolute URLs are not allowed. Use a relative path.');
  }
  if (url.includes('..') || url.includes('\0') || url.includes('//')) {
    return errorResponse(400, 'InvalidUrl', 'URL contains disallowed sequences.');
  }

  // ── Cache lookup ──
  const cacheHash = await hashString(`crop:${url}`);
  const cacheKey = buildCacheKey('smart-crop', cacheHash);
  const cached = await cacheGet(cacheKey);
  if (cached?.gravity) {
    return new Response(JSON.stringify({
      url,
      gravity: cached.gravity,
      /* v8 ignore next -- writer always sets confidence/model/dateGenerated */
      confidence: cached.confidence || 'medium',
      /* v8 ignore next -- writer always sets model */
      model: cached.model || MODEL,
      source: 'cached',
      degraded: true,
      /* v8 ignore next -- writer always sets dateGenerated */
      dateGenerated: cached.dateGenerated || new Date().toISOString(),
    }), { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' } });
  }

  // ── Budget gate ──
  const budget = await aiBudgetState(env);
  if (!env.AI || budget.exhausted) {
    return errorResponse(503, 'AiUnavailable', 'AI smart-crop is temporarily unavailable. The daily Workers AI neuron budget is exhausted or the binding is missing.');
  }

  // ── Origin fetch ──
  const reqUrl = new URL(request.url);
  const originUrl = new URL(url, reqUrl.origin).toString();
  let imageBytes;
  try {
    imageBytes = await fetchImageBytes(originUrl);
  } catch (err) {
    log.warn('SMART_CROP_ORIGIN_FAIL', err.message, { url });
    return errorResponse(404, 'AssetUnreachable', `Could not load asset for vision analysis: ${err.message}`);
  }

  // ── Vision-model call ──
  let aiResult;
  try {
    aiResult = await env.AI.run(MODEL, {
      image: Array.from(imageBytes),
      prompt: PROMPT,
      max_tokens: 8,
    });
    await aiBudgetCharge(env, NEURON_COST);
  } catch (err) {
    if (isAiQuotaError(err)) await aiBudgetTrip(env, 'smart_crop_quota');
    log.warn('SMART_CROP_MODEL_FAIL', err.message);
    return errorResponse(503, 'AiUnavailable', 'AI smart-crop failed. The circuit breaker will skip subsequent calls until the budget recovers.');
  }

  const rawText = aiResult?.description || aiResult?.response || aiResult;
  const gravity = parseGravity(rawText);
  if (!gravity) {
    // Default to center if the model returns garbage; better than no response.
    log.warn('SMART_CROP_UNPARSEABLE', 'Could not extract gravity from model output', { rawText: typeof rawText === 'string' ? rawText.slice(0, 120) : null });
    const dateGenerated = new Date().toISOString();
    const fallback = { gravity: 'center', confidence: 'low', model: MODEL, dateGenerated };
    await cacheSet(cacheKey, fallback, CACHE_TTL_SEC);
    return new Response(JSON.stringify({
      url, ...fallback, source: 'ai', degraded: false,
    }), { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' } });
  }

  // Confidence: exact-token match → high; word-inside-sentence → medium.
  const cleaned = String(rawText).toLowerCase().replace(/[^a-z]/g, '');
  const confidence = VALID_GRAVITIES.has(cleaned) ? 'high' : 'medium';

  const dateGenerated = new Date().toISOString();
  await cacheSet(cacheKey, { gravity, confidence, model: MODEL, dateGenerated }, CACHE_TTL_SEC);

  return new Response(JSON.stringify({
    url, gravity, confidence, model: MODEL,
    source: 'ai',
    degraded: false,
    dateGenerated,
  }), { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' } });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url).searchParams.get('url');
  return handle(context, url);
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch {
    return errorResponse(400, 'InvalidJson', 'Invalid JSON body.');
  }
  return handle(context, body?.url);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' },
  });
}
