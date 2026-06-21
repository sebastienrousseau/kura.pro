/**
 * GET /api/insights/cache-explain?url=<url>
 *
 * "Why did this URL HIT/MISS?" — Phase 2B headline observability win.
 * Cloudflare paywalls equivalent functionality on Enterprise; we ship
 * it on the free tier for any session-authenticated account.
 *
 * Joins three sources:
 *   1. Live HEAD probe of the URL — cf-cache-status, age, etag,
 *      cache-tag, cache-control + the trace headers our middleware
 *      injects (X-Trace-Id, traceparent).
 *   2. Path classification — which routing branch the middleware
 *      took (api/, cdn/, stocks/, /clients/ pillar, /global/, etc.).
 *   3. Cache-tag analysis — extract the project / type / format tags
 *      so the user knows what `--tag` purge would invalidate it.
 *
 * Session-gated (any account member). Rate-limited 60/min per IP so a
 * runaway dashboard tab doesn't burn quota.
 *
 * Response:
 *   {
 *     url, cacheStatus, age, cacheControl, etag, cacheTag,
 *     routing: { pillar, project, ... },
 *     trace: { traceId, traceparent },
 *     verdict: "hit_fresh" | "hit_stale_revalidating" | "miss_origin_hit"
 *            | "miss_origin_error" | "bypass_no_store" | ...,
 *     suggestions: [ "...", ... ]
 *   }
 */

import { checkRateLimit } from "../_shared.js";
import {
  hasAccountsDB, getCurrentSession,
  AUTH_CORS, jsonError, authJson,
} from "../auth/_lib.js";

const PER_IP_LIMIT = 60;
const PER_IP_WINDOW = 60;

const PILLAR_PATTERNS = [
  { pattern: /^\/api\//, pillar: "api", note: "Dynamic — Pages Functions" },
  { pattern: /^\/cdn\//, pillar: "cdn", note: "Localised content (rewrite target)" },
  { pattern: /^\/stocks\//, pillar: "stocks", note: "Stock images pillar" },
  { pattern: /^\/shared\//, pillar: "shared", note: "Language-agnostic shared assets" },
  { pattern: /^\/dashboard\//, pillar: "dashboard", note: "Functions-middleware-gated" },
  { pattern: /^\/dist\//, pillar: "dist", note: "Functions-middleware-gated" },
  { pattern: /^\/global\//, pillar: "global", note: "Geo-routed" },
  { pattern: /^\/sign-up|^\/onboarding/, pillar: "auth_pages", note: "Cloudflare-Access-walled" },
  { pattern: /\.(webp|avif|jxl|png|svg|jpg|ico|mp4)$/i, pillar: "client_asset", note: "Tenant asset under /clients/<project>/" },
];

const STATUS_SUGGESTIONS = {
  HIT: ["Edge cache served the response from the local PoP. No origin fetch."],
  MISS: ["Edge cache had no copy; fetched from origin. The next request to the same PoP should HIT."],
  EXPIRED: ["Edge had a stale copy; revalidated with origin."],
  REVALIDATED: ["Stale-while-revalidate served the cached copy while refreshing in the background."],
  BYPASS: ["Cache was bypassed — usually because Cache-Control disallows caching (no-store, no-cache, private)."],
  DYNAMIC: ["Cloudflare considered the response uncacheable. Common for Pages Functions responses without explicit cache-control."],
  STALE: ["Stale copy served because the origin failed validation."],
  NONE: ["No cache decision recorded — typically a request that didn't reach the cache layer at all."],
  UPDATING: ["A background revalidation is in progress."],
};

const ASSET_EXT_RE = /\.([a-z0-9]+)$/i;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");

  const current = await getCurrentSession(env, request);
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");

  const ip = request.headers.get("cf-connecting-ip") || null;
  if (ip) {
    const rl = await checkRateLimit(env, `cache-explain:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW);
    if (!rl.allowed) {
      return jsonError(429, "rate_limited", "Too many cache-explain requests. Slow down.", {
        retryAfter: rl.resetAt ? Math.max(0, rl.resetAt - Math.floor(Date.now() / 1000)) : PER_IP_WINDOW,
      });
    }
  }

  const targetParam = new URL(request.url).searchParams.get("url");
  if (!targetParam) return jsonError(400, "invalid_input", "url query parameter required.");

  let target;
  try {
    target = new URL(targetParam);
  } catch {
    return jsonError(400, "invalid_input", "url must be an absolute URL.");
  }

  // Defence: only probe URLs on cloudcdn.pro (or the configured CDN
  // host) — otherwise this endpoint becomes an SSRF vector.
  const allowedHost = (env.CLOUDCDN_HOST || "cloudcdn.pro").toLowerCase();
  if (target.hostname.toLowerCase() !== allowedHost) {
    return jsonError(400, "invalid_input", `url must be on https://${allowedHost}.`);
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return jsonError(400, "invalid_input", "url must be http or https.");
  }

  // HEAD probe — cheap; uses 'no-cache' to capture the upstream
  // decision rather than reading a browser-cached response.
  let headRes;
  try {
    headRes = await fetch(target.toString(), {
      method: "HEAD",
      headers: { "Cache-Control": "no-cache", "User-Agent": "cloudcdn.pro/cache-explain" },
      redirect: "manual",
    });
  } catch (err) {
    return jsonError(502, "probe_failed", `HEAD probe failed: ${err && err.message || err}`);
  }

  const headers = headRes.headers;
  const status = headRes.status;
  const cacheStatus = headers.get("cf-cache-status") || "NONE";
  const age = Number(headers.get("age") || 0);
  const cacheControl = headers.get("cache-control") || null;
  const etag = headers.get("etag") || null;
  const cacheTag = headers.get("cache-tag") || null;
  const traceId = headers.get("x-trace-id") || null;
  const traceparent = headers.get("traceparent") || null;
  const cfRay = headers.get("cf-ray") || null;
  const server = headers.get("server") || null;

  const routing = classifyPath(target.pathname);
  const verdict = computeVerdict({ status, cacheStatus, cacheControl, age });

  const suggestions = (STATUS_SUGGESTIONS[cacheStatus] || []).slice();
  if (cacheTag) {
    suggestions.push(`Purge by tag with: curl -X POST -H "Authorization: Bearer <key with purge:write>" -d '{"tags":[${JSON.stringify(cacheTag.split(",")[0].trim())}]}' https://cloudcdn.pro/api/purge`);
  }
  if (cacheControl && /no-store|private/i.test(cacheControl)) {
    suggestions.push("Cache-Control explicitly disallows caching. If the response is safe to cache, remove no-store/private and set a max-age.");
  }
  if (cacheStatus === "MISS" && status >= 200 && status < 300) {
    suggestions.push("Request the same URL again from the same PoP — the next response should HIT.");
  }
  if (cacheStatus === "DYNAMIC" && routing.pillar === "api") {
    suggestions.push("Pages Functions responses default to DYNAMIC. Add Cache-Control: public, max-age=N to make them cacheable.");
  }

  return authJson({
    url: target.toString(),
    status,
    cacheStatus,
    age,
    cacheControl,
    etag,
    cacheTag,
    routing,
    trace: { traceId, traceparent, cfRay, server },
    verdict,
    suggestions,
    probedAt: new Date().toISOString(),
  });
}

export function classifyPath(pathname) {
  for (const { pattern, pillar, note } of PILLAR_PATTERNS) {
    if (pattern.test(pathname)) {
      const out = { pillar, note };
      const segs = pathname.split("/").filter(Boolean);
      if (pillar === "stocks" && segs[1]) out.category = segs[1];
      if (pillar === "client_asset") {
        out.project = segs[0];
        out.category = segs[2] || segs[1];
        const m = pathname.match(ASSET_EXT_RE);
        if (m) out.format = m[1].toLowerCase();
      }
      return out;
    }
  }
  // Default — clients pillar via the fallback rewrite in
  // functions/_middleware.js.
  const segs = pathname.split("/").filter(Boolean);
  const out = { pillar: "client_asset", note: "Tenant asset (clients pillar default)" };
  if (segs[0]) out.project = segs[0];
  if (segs[2]) out.category = segs[2];
  const m = pathname.match(ASSET_EXT_RE);
  if (m) out.format = m[1].toLowerCase();
  return out;
}

export function computeVerdict({ status, cacheStatus, cacheControl, age }) {
  if (status >= 500) return "origin_5xx";
  if (status >= 400) return "origin_4xx";
  if (cacheStatus === "HIT" && age > 0) return "hit_fresh";
  if (cacheStatus === "REVALIDATED") return "hit_stale_revalidating";
  if (cacheStatus === "STALE") return "hit_stale_origin_down";
  if (cacheStatus === "MISS" && status < 300) return "miss_origin_hit";
  if (cacheStatus === "EXPIRED") return "miss_revalidated";
  if (cacheStatus === "BYPASS") return "bypass_no_store";
  if (cacheStatus === "DYNAMIC") {
    return cacheControl && /no-store|private/i.test(cacheControl) ? "bypass_no_store" : "uncacheable_dynamic";
  }
  return "unknown";
}
