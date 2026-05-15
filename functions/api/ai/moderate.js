/**
 * AI image moderation endpoint.
 *
 * GET  /api/ai/moderate?url=/clients/akande/v1/banners/hero.jpg
 * POST /api/ai/moderate  { "url": "..." }
 *
 * Sends the asset to a Workers AI vision model and asks for a structured
 * safe-search verdict. Useful as an automated gate during upload pipelines
 * (CI rejects an asset flagged "unsafe") or as a moderation surface for
 * user-generated content.
 *
 * Response shape:
 *   {
 *     url,
 *     safe:       true | false,
 *     verdict:    "safe" | "borderline" | "unsafe",
 *     categories: { nudity, violence, drugs, hateSymbols, gore }   // 0-1 floats
 *     reasoning:  "Short model-written explanation.",
 *     model:      "@cf/llava-hf/llava-1.5-7b-hf",
 *     source:     "ai" | "cached",
 *     degraded:   boolean,
 *     dateGenerated,
 *   }
 *
 * Determinism: we ask the model to emit a strict JSON line and parse it
 * defensively. When parsing fails we fall back to a conservative "safe:
 * false, verdict: 'borderline'" so the caller still has to decide.
 *
 * Caching: 24h cache keyed on asset path; identical bytes get the same
 * verdict so retries cost zero neurons.
 */

import {
  AI_COST, aiBudgetState, aiBudgetCharge, aiBudgetTrip, isAiQuotaError,
  checkRateLimit, errorResponse, log, rateLimitHeaders,
  hashString, buildCacheKey, cacheGet, cacheSet,
  authenticateAny,
} from '../_shared.js';
import { authorizeWithScope } from '../tokens.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const NEURON_COST = 14;
const CACHE_TTL_SEC = 86400;
const RATE_LIMIT_PER_MIN = 40;
const MAX_BYTES = 8 * 1024 * 1024;

const CATEGORIES = ['nudity', 'violence', 'drugs', 'hateSymbols', 'gore'];
const VERDICTS = new Set(['safe', 'borderline', 'unsafe']);

const PROMPT = `Classify this image's safety across five categories. Reply with a single JSON object containing:
  "verdict": one of "safe", "borderline", "unsafe"
  "categories": { "nudity": 0.0-1.0, "violence": 0.0-1.0, "drugs": 0.0-1.0, "hateSymbols": 0.0-1.0, "gore": 0.0-1.0 }
  "reasoning": one short sentence
Output ONLY the JSON object, no preamble or markdown.`;

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function parseModeration(raw) {
  if (raw == null) return null;
  const text = typeof raw === 'string'
    ? raw
    : (raw.description || raw.response || JSON.stringify(raw));
  /* v8 ignore next -- text is always a string after JSON.stringify fallback */
  if (typeof text !== 'string') return null;

  // Find the first {...} block — the model sometimes wraps its JSON in prose
  // or markdown fences. Take the first balanced-ish JSON candidate.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let obj;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  /* v8 ignore next -- JSON.parse of "{...}" block always yields an object */
  if (!obj || typeof obj !== 'object') return null;

  const verdict = VERDICTS.has(obj.verdict) ? obj.verdict : null;
  if (!verdict) return null;

  const categories = {};
  for (const c of CATEGORIES) {
    categories[c] = clampScore(obj.categories?.[c]);
  }
  const reasoning = typeof obj.reasoning === 'string'
    ? obj.reasoning.slice(0, 240)
    : '';
  return { verdict, categories, reasoning };
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
  const rl = await checkRateLimit(env, `rl:moderate:${ip}`, RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', `Rate limit exceeded. Maximum ${RATE_LIMIT_PER_MIN} moderation calls per minute per IP.`, { retryAfter: '60', limit: rl.limit });
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

  const cacheHash = await hashString(`moderate:${url}`);
  const cacheKey = buildCacheKey('moderate', cacheHash);
  const cached = await cacheGet(cacheKey);
  if (cached?.verdict) {
    return new Response(JSON.stringify({
      url,
      safe: cached.verdict === 'safe',
      verdict: cached.verdict,
      categories: cached.categories,
      reasoning: cached.reasoning,
      model: cached.model,
      source: 'cached',
      degraded: true,
      dateGenerated: cached.dateGenerated,
    }), { headers: { ...CORS_HEADERS, ...rateLimitHeaders(rl), 'Cache-Control': 'public, max-age=3600' } });
  }

  const budget = await aiBudgetState(env);
  if (!env.AI || budget.exhausted) {
    return errorResponse(503, 'AiUnavailable', 'AI moderation is temporarily unavailable. The daily Workers AI neuron budget is exhausted or the binding is missing.');
  }

  const reqUrl = new URL(request.url);
  const originUrl = new URL(url, reqUrl.origin).toString();
  let imageBytes;
  try {
    imageBytes = await fetchImageBytes(originUrl);
  } catch (err) {
    log.warn('MODERATE_ORIGIN_FAIL', err.message, { url });
    return errorResponse(404, 'AssetUnreachable', `Could not load asset for moderation: ${err.message}`);
  }

  let aiResult;
  try {
    aiResult = await env.AI.run(MODEL, {
      image: Array.from(imageBytes),
      prompt: PROMPT,
      max_tokens: 200,
    });
    await aiBudgetCharge(env, NEURON_COST);
  } catch (err) {
    if (isAiQuotaError(err)) await aiBudgetTrip(env, 'moderate_quota');
    log.warn('MODERATE_MODEL_FAIL', err.message);
    return errorResponse(503, 'AiUnavailable', 'AI moderation failed. The circuit breaker will skip subsequent calls until the budget recovers.');
  }

  const parsed = parseModeration(aiResult);
  let verdict, categories, reasoning;
  if (parsed) {
    ({ verdict, categories, reasoning } = parsed);
  } else {
    // Defensive fallback: conservative borderline verdict so callers
    // applying an automated gate err on the side of caution.
    log.warn('MODERATE_UNPARSEABLE', 'Could not extract structured verdict from model output');
    verdict = 'borderline';
    categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    reasoning = 'Model output could not be parsed; defaulting to borderline.';
  }

  const dateGenerated = new Date().toISOString();
  await cacheSet(cacheKey, { verdict, categories, reasoning, model: MODEL, dateGenerated }, CACHE_TTL_SEC);

  return new Response(JSON.stringify({
    url,
    safe: verdict === 'safe',
    verdict, categories, reasoning,
    model: MODEL,
    source: 'ai',
    degraded: false,
    dateGenerated,
  }), { headers: { ...CORS_HEADERS, ...rateLimitHeaders(rl), 'Cache-Control': 'public, max-age=3600' } });
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
