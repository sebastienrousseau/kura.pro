/**
 * POST /api/assets/process
 *
 * Phase 2D — "drop image, get the pipeline" — the AI-asset
 * differentiator from the 2026 research. Single endpoint chains the
 * existing AI primitives (alt-text, smart-crop, background-remove,
 * moderate) + image transforms (AVIF/WebP/JXL) + signed URL minting
 * so the agent (or dashboard) issues one call instead of N.
 *
 * Two modes:
 *   - mode: 'urls' (default)
 *       Lazy-evaluation: returns the deterministic URLs the agent
 *       can follow to fetch each variant. Cheap — no GPU calls
 *       upfront. Moderation runs synchronously so an unsafe image
 *       is refused at the entry point.
 *   - mode: 'eager'
 *       Invokes alt-text + smart-crop synchronously alongside
 *       moderation. Slower (~2-3s) but gives the caller the alt-text
 *       and crop boxes without a second round-trip.
 *
 * Request body:
 *   {
 *     url: string,              // absolute cloudcdn.pro URL to source image
 *     mode?: 'urls' | 'eager',
 *     formats?: Array<'avif'|'webp'|'jxl'|'png'|'jpeg'>,
 *     crops?: Array<'16:9'|'9:16'|'1:1'>,
 *     signedTtlSeconds?: number  // 1-86400, default 3600
 *   }
 *
 * Response 200:
 *   {
 *     source: { url },
 *     moderation: { verdict, reason? },
 *     variants: { avif: { url }, webp: { url }, ... },
 *     crops:    { '16:9': { url }, '9:16': { url }, '1:1': { url } },
 *     aiAssisted: { altText?: string, smartCropHints?: object },
 *     signed: { url, expiresAt }
 *   }
 *
 * Session-gated. Per-IP rate-limited to 30/min.
 */

import { checkRateLimit } from "../_shared.js";
import {
  hasAccountsDB, getCurrentSession,
  AUTH_CORS, jsonError, authJson,
} from "../auth/_lib.js";

const DEFAULT_FORMATS = ["avif", "webp"];
const VALID_FORMATS = new Set(["avif", "webp", "jxl", "png", "jpeg"]);
const DEFAULT_CROPS = ["16:9", "9:16", "1:1"];
const VALID_CROPS = new Set(["16:9", "9:16", "1:1", "4:3", "3:2"]);
const DEFAULT_SIGNED_TTL = 3600;
const MAX_SIGNED_TTL = 86_400;
const PER_IP_LIMIT = 30;
const PER_IP_WINDOW = 60;
const ALLOWED_SOURCE_PATTERN = /^https:\/\/cloudcdn\.pro\/(stocks|clients|[a-z][a-z0-9-]*)\/[^\s?#]+\.(webp|avif|jxl|png|jpe?g|svg)(\?[^\s#]*)?$/i;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");

  const current = await getCurrentSession(env, request);
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");
  if (!current.account) return jsonError(403, "no_account", "No account associated with this session.");

  const ip = request.headers.get("cf-connecting-ip") || null;
  if (ip) {
    const rl = await checkRateLimit(env, `assets-process:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW);
    if (!rl.allowed) {
      return jsonError(429, "rate_limited", "Too many process requests. Slow down.", {
        retryAfter: rl.resetAt ? Math.max(0, rl.resetAt - Math.floor(Date.now() / 1000)) : PER_IP_WINDOW,
      });
    }
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const sourceUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!ALLOWED_SOURCE_PATTERN.test(sourceUrl)) {
    return jsonError(400, "invalid_input", "url must be an absolute https://cloudcdn.pro/... image URL.");
  }
  const mode = body.mode === "eager" ? "eager" : "urls";
  const formats = sanitiseList(body.formats, DEFAULT_FORMATS, VALID_FORMATS);
  const crops = sanitiseList(body.crops, DEFAULT_CROPS, VALID_CROPS);
  const ttl = sanitiseTtl(body.signedTtlSeconds);

  // Moderate FIRST — refuse processing of unsafe content at the entry
  // point so we don't generate variants for content the platform would
  // reject anyway. Cheap (~200ms via Workers AI).
  const moderation = await invokeModeration(env, sourceUrl);
  if (moderation.verdict === "block") {
    return jsonError(422, "content_moderation_block", `Source image rejected: ${moderation.reason || "unsafe content"}.`);
  }

  // Build the variant + crop URL set. These are pointers to the
  // existing /api/transform endpoint; the client follows them lazily
  // and the edge caches the result.
  const variants = {};
  for (const fmt of formats) {
    variants[fmt] = { url: buildTransformUrl(request, sourceUrl, { format: fmt }) };
  }
  const cropUrls = {};
  for (const aspect of crops) {
    const [w, h] = aspect.split(":").map(Number);
    // Pick a sensible width target; height computed by ratio. Edge
    // accepts both — clients can re-resize by changing query params.
    cropUrls[aspect] = {
      url: buildTransformUrl(request, sourceUrl, {
        w: 1280, h: Math.round((1280 * h) / w), fit: "cover", gravity: "auto",
      }),
    };
  }

  // Eager mode: also invoke alt-text + smart-crop hints synchronously.
  let aiAssisted = {};
  if (mode === "eager") {
    aiAssisted = await invokeAiPair(env, sourceUrl, crops);
  } else {
    // URL-mode: include the pointers so the agent knows where to fetch
    // each result on demand.
    aiAssisted = {
      altTextUrl: buildApiUrl(request, "/api/ai/alt-text", { url: sourceUrl }),
      smartCropUrl: buildApiUrl(request, "/api/ai/smart-crop", { url: sourceUrl, aspect: crops[0] }),
      backgroundRemoveUrl: buildApiUrl(request, "/api/ai/background-remove", { url: sourceUrl }),
    };
  }

  const signed = await buildSignedUrl(env, request, sourceUrl, ttl);

  return authJson({
    source: { url: sourceUrl },
    moderation,
    variants,
    crops: cropUrls,
    aiAssisted,
    signed,
    mode,
  });
}

// ── Helpers ──────────────────────────────────────────────────────

export function sanitiseList(input, fallback, allowed) {
  if (!Array.isArray(input) || input.length === 0) return fallback.slice();
  const out = [];
  for (const v of input) {
    if (typeof v === "string" && allowed.has(v) && !out.includes(v)) out.push(v);
  }
  return out.length ? out : fallback.slice();
}

export function sanitiseTtl(input) {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SIGNED_TTL) return DEFAULT_SIGNED_TTL;
  return n;
}

export function buildTransformUrl(request, sourceUrl, params) {
  const base = new URL(request.url);
  const u = new URL("/api/transform", `${base.protocol}//${base.host}`);
  u.searchParams.set("url", sourceUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export function buildApiUrl(request, path, params) {
  const base = new URL(request.url);
  const u = new URL(path, `${base.protocol}//${base.host}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export async function invokeModeration(env, sourceUrl) {
  // The existing /api/ai/moderate runs at the edge; we call it via
  // self-fetch so the same circuit-breaker + budget logic apply. If
  // the call fails (e.g. AI quota exhausted), default to allow so a
  // diagnostic outage doesn't block legitimate processing — the
  // moderation service is best-effort, not a hard gate.
  try {
    const res = await fetch(buildApiUrl({ url: "https://cloudcdn.pro/" }, "/api/ai/moderate", { url: sourceUrl }), {
      headers: { "User-Agent": "cloudcdn.pro/assets-process" },
    });
    if (!res.ok) return { verdict: "allow", note: `moderation upstream returned ${res.status} — defaulting to allow` };
    const data = await res.json();
    const block = data && (data.safe === false || data.verdict === "block" || data.flagged === true);
    return block
      ? { verdict: "block", reason: data?.reason || data?.label || "unsafe" }
      : { verdict: "allow", labels: data?.labels || null };
  } catch (err) {
    /* v8 ignore next — defensive catch on the self-fetch; the failure
       mode is "moderation upstream is wholly unreachable" which is rare
       enough to not warrant a contrived test. */
    return { verdict: "allow", note: `moderation failed: ${err && err.message || err} — defaulting to allow` };
  }
}

export async function invokeAiPair(env, sourceUrl, crops) {
  // Fire alt-text + smart-crop in parallel; resilient to either
  // failing.
  const [altRes, cropRes] = await Promise.allSettled([
    fetch(buildApiUrl({ url: "https://cloudcdn.pro/" }, "/api/ai/alt-text", { url: sourceUrl })),
    fetch(buildApiUrl({ url: "https://cloudcdn.pro/" }, "/api/ai/smart-crop", { url: sourceUrl, aspect: crops[0] })),
  ]);
  const out = {};
  if (altRes.status === "fulfilled" && altRes.value.ok) {
    try { out.altText = (await altRes.value.json())?.alt || null; } catch { /* ignore */ }
  }
  if (cropRes.status === "fulfilled" && cropRes.value.ok) {
    try { out.smartCropHints = await cropRes.value.json(); } catch { /* ignore */ }
  }
  return out;
}

export async function buildSignedUrl(env, request, sourceUrl, ttlSeconds) {
  // Mint a signed delivery URL pointing at the source path. The
  // existing /api/signed endpoint owns the HMAC logic — we call it
  // internally rather than re-implement.
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  try {
    const u = buildApiUrl(request, "/api/signed", {
      path: new URL(sourceUrl).pathname,
      expires: expiresAt,
    });
    const res = await fetch(u);
    if (res.ok) {
      const data = await res.json();
      return { url: data?.url || sourceUrl, expiresAt };
    }
  } catch { /* fall through */ }
  // Fallback: return the source URL unsigned so the caller still has
  // something pointing at the asset. Document the failure mode.
  return { url: sourceUrl, expiresAt, note: "signed-url mint failed; returning unsigned source" };
}
