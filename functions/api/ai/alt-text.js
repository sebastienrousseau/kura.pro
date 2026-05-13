/**
 * AI-generated alt text endpoint.
 *
 * POST /api/ai/alt-text
 *   { "url": "/clients/akande/v1/logos/logo.svg" }
 * GET  /api/ai/alt-text?url=/clients/akande/v1/logos/logo.svg
 *
 * Sends the asset to a Workers AI vision model and returns a short
 * accessibility-quality description. Designed for use during ingest
 * (alt text is generated once at upload time and cached for re-use)
 * or on-demand from authoring tools.
 *
 * Response shape:
 *   {
 *     url:        "/clients/...",
 *     alt:        "A red square on a white background.",
 *     model:      "@cf/llava-hf/llava-1.5-7b-hf",
 *     source:     "ai" | "cached",
 *     degraded:   false,
 *     dateGenerated: "2026-...",
 *   }
 *
 * Uses the shared AI budget guard (functions/api/_shared.js):
 *   - reads ai:neurons:YYYY-MM-DD against AI_DAILY_BUDGET
 *   - trips ai:cb:open on quota errors
 *   - returns 503 with a clear message when AI is unavailable rather
 *     than a fabricated description
 *
 * Caching: 24h response cache keyed on the asset path (the same image
 * gets the same alt text). Hot paths cost zero neurons.
 */

import {
  AI_COST, aiBudgetState, aiBudgetCharge, aiBudgetTrip, isAiQuotaError,
  checkRateLimit, errorResponse, log,
  hashString, buildCacheKey, cacheGet, cacheSet,
} from '../_shared.js';
import { authorizeWithScope } from '../tokens.js';
import { authenticateAny } from '../_shared.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const ALT_TEXT_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const ALT_TEXT_NEURON_COST = 12;        // Conservative estimate for one vision call.
const ALT_TEXT_CACHE_TTL_SEC = 86400;   // Same image → same alt text for 24h.
const ALT_TEXT_RATE_LIMIT = 60;         // 60 req/min/IP — generative AI is expensive.
const ALT_TEXT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB cap on image data into the model.

const PROMPT = 'Provide a single concise sentence describing this image, suitable for use as HTML alt text. Be specific about the subject, action, and notable visual attributes. Do not start with "An image of" or "A picture of". Maximum 120 characters.';

async function fetchImageBytes(originUrl) {
  const res = await fetch(originUrl);
  if (!res.ok) throw new Error(`origin returned ${res.status}`);
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len > ALT_TEXT_MAX_BYTES) throw new Error('asset exceeds vision-model size cap');
  const buf = await res.arrayBuffer();
  /* v8 ignore next -- belt-and-suspenders post-fetch check; content-length
     above already filters oversized bodies in practice */
  if (buf.byteLength > ALT_TEXT_MAX_BYTES) throw new Error('asset exceeds vision-model size cap');
  return new Uint8Array(buf);
}

function trimAlt(text) {
  if (typeof text !== 'string') return '';
  let s = text.trim();
  // Strip wrapping quotes if the model returned a quoted string.
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  // Hard cap at 160 chars — slightly above the 120-char prompt budget.
  if (s.length > 160) s = s.slice(0, 157).trimEnd() + '...';
  return s;
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
  const rl = await checkRateLimit(env, `rl:alt-text:${ip}`, ALT_TEXT_RATE_LIMIT, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', `Rate limit exceeded. Maximum ${ALT_TEXT_RATE_LIMIT} alt-text generations per minute per IP.`, { retryAfter: '60', limit: rl.limit });
  }

  if (!url || typeof url !== 'string' || url.length === 0) {
    return errorResponse(400, 'MissingUrl', 'The "url" field is required. Provide a relative asset path (e.g. /clients/akande/v1/logos/logo.svg).');
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

  // ── Cache lookup (Layer 1) — same asset = same alt text ──
  const cacheHash = await hashString(`alt:${url}`);
  const cacheKey = buildCacheKey('alt-text', cacheHash);
  const cached = await cacheGet(cacheKey);
  if (cached?.alt) {
    return new Response(JSON.stringify({
      url,
      alt: cached.alt,
      /* v8 ignore next -- writer always sets model; fallback is defensive */
      model: cached.model || ALT_TEXT_MODEL,
      source: 'cached',
      degraded: true,
      /* v8 ignore next -- writer always sets dateGenerated */
      dateGenerated: cached.dateGenerated || new Date().toISOString(),
    }), { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' } });
  }

  // ── AI budget gate (Layer 2) ──
  const budget = await aiBudgetState(env);
  if (!env.AI || budget.exhausted) {
    return errorResponse(503, 'AiUnavailable', 'AI alt-text generation is temporarily unavailable. The daily Workers AI neuron budget is exhausted or the binding is missing. Cached responses still work.');
  }

  // ── Fetch the image bytes from origin ──
  const reqUrl = new URL(request.url);
  const originUrl = new URL(url, reqUrl.origin).toString();
  let imageBytes;
  try {
    imageBytes = await fetchImageBytes(originUrl);
  } catch (err) {
    log.warn('ALT_TEXT_ORIGIN_FAIL', err.message, { url });
    return errorResponse(404, 'AssetUnreachable', `Could not load asset for vision analysis: ${err.message}`);
  }

  // ── Vision-model call ──
  let aiResult;
  try {
    aiResult = await env.AI.run(ALT_TEXT_MODEL, {
      image: Array.from(imageBytes),
      prompt: PROMPT,
      max_tokens: 80,
    });
    await aiBudgetCharge(env, ALT_TEXT_NEURON_COST);
  } catch (err) {
    if (isAiQuotaError(err)) await aiBudgetTrip(env, 'alt_text_quota');
    log.warn('ALT_TEXT_MODEL_FAIL', err.message);
    return errorResponse(503, 'AiUnavailable', 'AI alt-text generation failed. Retry shortly — the circuit breaker will skip the call automatically until the budget recovers.');
  }

  const alt = trimAlt(aiResult?.description || aiResult?.response || aiResult);
  if (!alt) {
    return errorResponse(502, 'EmptyAiResponse', 'The vision model returned no usable text for this image.');
  }

  const dateGenerated = new Date().toISOString();
  await cacheSet(cacheKey, { alt, model: ALT_TEXT_MODEL, dateGenerated }, ALT_TEXT_CACHE_TTL_SEC);

  return new Response(JSON.stringify({
    url, alt, model: ALT_TEXT_MODEL,
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
