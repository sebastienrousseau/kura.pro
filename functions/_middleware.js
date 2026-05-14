/**
 * Cloudflare Pages middleware — three-pillar routing.
 *
 * Performance-critical: runs on EVERY request.
 * Optimized for minimal allocations and zero-copy where possible.
 *
 * Physical:  /clients/, /stocks/, /cdn/
 * Logical:   cloudcdn.pro/akande/..., /stocks/..., /dashboard/...
 */

import { trackRequest } from "./api/analytics.js";
import { createTrace, recordMetric } from "./api/_shared.js";

// Pre-compiled extension check — faster than regex for hot path
const ASSET_EXT = new Set(["webp", "avif", "jxl", "png", "svg", "ico", "mp4"]);

const CONTINENT_MAP = {
  EU: "europe",
  AS: "asia",
  NA: "north-america",
  SA: "south-america",
  AF: "africa",
  OC: "oceania",
  AN: "antarctica",
};

// Prefixes that have their own Functions middleware — must use context.next()
const FUNCTIONS_PREFIXES = ["/dashboard/", "/dist/"];
// Prefixes served from /cdn/ root (language-agnostic)
const SHARED_PREFIXES = ["/shared/"];
// Prefixes served from /cdn/en/ (English by default, with locale fallback)
const LOCALIZED_PREFIXES = ["/content/", "/api-reference/"];
// Supported language codes — /{lang}/ serves /cdn/{lang}/index.html
const LOCALES = new Set([
  "en", "ar", "bn", "cs", "de", "es", "fr", "ha", "he", "hi", "id",
  "it", "ja", "ko", "nl", "pl", "pt", "ro", "ru", "sv", "th",
  "tl", "tr", "uk", "vi", "yo", "zh", "zh-tw",
]);

/**
 * Extract file extension from path without regex.
 * Uses lastIndexOf — O(1) amortized, zero allocations.
 */
function getExtension(path) {
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot === path.length - 1) return "";
  const slash = path.lastIndexOf("/");
  if (slash > dot) return ""; // dot is in a directory name, not filename
  return path.slice(dot + 1).toLowerCase();
}

/**
 * Extract path segments at specific indices without split+filter.
 * Zero intermediate arrays.
 */
function getSegment(path, index) {
  let start = 0;
  let seg = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i] === "/") {
      if (seg === index) return path.slice(start + 1, i);
      start = i;
      seg++;
    }
  }
  if (seg === index) return path.slice(start + 1);
  return "";
}

/**
 * Build Cache-Tag header value directly — no array allocation.
 */
function buildCacheTag(path) {
  const project = getSegment(path, 0);
  const type = getSegment(path, 2);
  const ext = getExtension(path);

  let tag = "";
  if (project) tag += "project-" + project;
  if (type) tag += (tag ? ", " : "") + "type-" + type;
  if (ext) tag += (tag ? ", " : "") + "format-" + ext;
  tag += (tag ? ", " : "") + "all-assets";
  return tag;
}

function isAssetPath(path) {
  return ASSET_EXT.has(getExtension(path));
}

// ── Global security headers ──
// Applied to every response by the outer onRequest wrapper. These are
// per-response and per-origin baseline protections; per-route hardening
// (CSP, etc.) is still the responsibility of the route handler.
const SECURITY_HEADERS = {
  // Forces HTTPS for one year, includes subdomains, eligible for preload.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  // Disables MIME-type sniffing — defends against script injection via
  // mislabelled responses.
  "X-Content-Type-Options": "nosniff",
  // Strip referrer when crossing to a different origin; keep full URL on
  // same-origin so analytics on the dashboard still work.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Disable browser features we never use; reduces drive-by-feature risk.
  "Permissions-Policy":
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()",
  // Legacy clickjacking defence; modern browsers use frame-ancestors CSP
  // but this stays for older browsers and security scanners.
  "X-Frame-Options": "DENY",
  // Permit cross-origin embedding of asset responses (the whole point of
  // a CDN). Without this, fetch() with credentials: 'include' from other
  // origins would fail under post-Spectre default policies.
  "Cross-Origin-Resource-Policy": "cross-origin",
  // Content-Security-Policy — public-page strict mode.
  //   - script-src 'self'      — block any inline <script> or third-party
  //                              script load. The public homepage's inline
  //                              code has been externalized into
  //                              /shared/widgets/chat.js and
  //                              /shared/homepage-lang-switcher.js, so this
  //                              is now safe to enforce. Future XSS via the
  //                              chat widget's AI content would not execute.
  //   - style-src 'self' 'unsafe-inline' — many inline `style="..."`
  //                              attributes across the dashboard and the
  //                              homepage; tightening style-src is a
  //                              separate refactor with much smaller
  //                              blast-radius savings.
  //   - base-uri 'self'        — block <base href="https://attacker">
  //   - form-action 'self'     — keep form posts same-origin
  //   - frame-ancestors 'none' — modern replacement for X-Frame-Options DENY
  //   - object-src 'none'      — block <object>/<embed>/legacy Flash
  //   - upgrade-insecure-requests — auto-upgrade http: subresources
  //
  // Dashboard routes (/dashboard/*) override this header with a relaxed
  // variant — they have inline event handlers (onclick/onchange/oninput)
  // that strict script-src would break. The dashboard is admin-only and
  // doesn't render attacker-controlled content, so the threat model is
  // different. See functions/dashboard/_middleware.js for the override.
  "Content-Security-Policy":
    "script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
    "object-src 'none'; upgrade-insecure-requests",
};

function applyResponseEnvelope(response, trace) {
  // Don't touch redirects or responses with no body — they don't need it
  // and mutating headers on Response.redirect() is awkward.
  if (response.status >= 300 && response.status < 400) return response;

  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  // Trace ID surfaces in two headers so it's easy to extract from either
  // server logs (X-Trace-Id) or anything that already understands W3C
  // distributed tracing (traceparent). Both fields are safe to expose —
  // they're random UUIDs with no PII.
  if (trace) {
    if (!headers.has("X-Trace-Id")) headers.set("X-Trace-Id", trace.traceId);
    if (!headers.has("traceparent")) headers.set("traceparent", trace.traceparent);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  // Mint a trace at request entry. Downstream handlers can pick it up via
  // context.data.trace (Cloudflare passes context.data between handlers)
  // or read traceparent off the request headers; existing handlers keep
  // working unchanged.
  const trace = createTrace(context.request);
  context.data = context.data || {};
  context.data.trace = trace;
  try {
    const inboundHeaders = new Headers(context.request.headers);
    if (!inboundHeaders.has("traceparent")) {
      inboundHeaders.set("traceparent", trace.traceparent);
      context.request = new Request(context.request, { headers: inboundHeaders });
    }
  } catch { /* immutable request — fall back to context.data only */ }

  const response = await routeRequest(context);
  // Emit one WAE data point per request. No-op when the METRICS binding
  // is absent (the default until the user uncomments the stanza in
  // wrangler.toml), so this is safe to call unconditionally.
  try {
    const url = new URL(context.request.url);
    recordMetric(context.env, {
      endpoint: url.pathname,
      status: response.status,
      source: response.headers.get('x-mode') || '',
      durationMs: Date.now() - trace.startTime,
      traceId: trace.traceId,
    });
  } catch { /* metric emit must never affect the response */ }
  return applyResponseEnvelope(response, trace);
}

async function routeRequest(context) {
  const { request, env } = context;
  // Extract pathname without full URL parse — request.url is always absolute
  // in Workers, so we find the path after the host.
  const rawUrl = request.url;
  const pathStart = rawUrl.indexOf("/", rawUrl.indexOf("//") + 2);
  const qmark = rawUrl.indexOf("?", pathStart);
  const path = qmark === -1 ? rawUrl.slice(pathStart) : rawUrl.slice(pathStart, qmark);

  // ── 1. API routes — fast exit, no rewrite ──
  if (path.length > 4 && path.charCodeAt(0) === 47 && path.charCodeAt(1) === 97 &&
      path.charCodeAt(2) === 112 && path.charCodeAt(3) === 105 && path.charCodeAt(4) === 47) {
    // charCodes: /api/ — branchless-style check, avoids startsWith overhead
    return context.next();
  }

  // ── 2. Root static files — no rewrite ──
  if (path === "/favicon.ico") {
    return context.next();
  }
  // manifest.json is large (~320 KB) and served on every dashboard load.
  // Add a 1 h browser cache so repeat visits don't re-download it.
  // Cloudflare handles transport compression based on Accept-Encoding.
  if (path === "/manifest.json") {
    const res = await context.next();
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
    headers.set("Vary", "Accept-Encoding");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  // ── 3. CDN pillar ──
  // Root → English homepage
  if (path === "/" || path === "/index.html") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/en/index.html");
  }

  // Locale homepages: /fr, /fr/, /fr/index.html → /cdn/fr/index.html
  // Also handles /en/ explicitly.
  const firstSlash = path.indexOf("/", 1);
  const firstSegment = firstSlash === -1 ? path.slice(1) : path.slice(1, firstSlash);
  if (LOCALES.has(firstSegment)) {
    const rest = firstSlash === -1 ? "" : path.slice(firstSlash);
    if (rest === "" || rest === "/" || rest === "/index.html") {
      return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/" + firstSegment + "/index.html");
    }
  }
  if (path === "/404.html") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/404.html");
  }
  if (path === "/robots.txt" || path === "/sitemap.xml") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/cdn" + path);
  }
  if (path === "/api-reference") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/en/api-reference/index.html");
  }
  // Bare paths without trailing slash — redirect so they hit the Functions middleware
  if (path === "/dist" || path === "/dashboard") {
    return Response.redirect(rawUrl.slice(0, pathStart) + path + "/" + (qmark === -1 ? "" : rawUrl.slice(qmark)), 301);
  }

  // Paths with their own Functions middleware — always context.next() so auth runs
  for (let i = 0; i < FUNCTIONS_PREFIXES.length; i++) {
    const prefix = FUNCTIONS_PREFIXES[i];
    if (path.length >= prefix.length &&
        path.charCodeAt(1) === prefix.charCodeAt(1) &&
        path.startsWith(prefix)) {
      return context.next();
    }
  }

  // Language-agnostic shared assets — rewrite to /cdn/
  for (let i = 0; i < SHARED_PREFIXES.length; i++) {
    const prefix = SHARED_PREFIXES[i];
    if (path.length >= prefix.length &&
        path.charCodeAt(1) === prefix.charCodeAt(1) &&
        path.startsWith(prefix)) {
      return rewriteFetch(env, request, rawUrl, pathStart, "/cdn" + path);
    }
  }

  // Localized content/api-reference — rewrite to /cdn/en/ (default English)
  for (let i = 0; i < LOCALIZED_PREFIXES.length; i++) {
    const prefix = LOCALIZED_PREFIXES[i];
    if (path.length >= prefix.length &&
        path.charCodeAt(1) === prefix.charCodeAt(1) &&
        path.startsWith(prefix)) {
      return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/en" + path);
    }
  }

  // Locale-prefixed content/api-reference: /{lang}/content/ → /cdn/{lang}/content/
  // Falls back to EN if the locale-specific file 404s.
  if (LOCALES.has(firstSegment)) {
    const rest = firstSlash === -1 ? "" : path.slice(firstSlash);
    for (const prefix of LOCALIZED_PREFIXES) {
      if (rest.startsWith(prefix)) {
        const localePath = "/cdn/" + firstSegment + rest;
        const localeRes = await rewriteFetch(env, request, rawUrl, pathStart, localePath);
        if (localeRes.status !== 404) return localeRes;
        // Fallback to English
        return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/en" + rest);
      }
    }
  }

  // ── 4. Stocks pillar — serve directly ──
  if (path.length > 8 && path.charCodeAt(1) === 115 && path.startsWith("/stocks/")) {
    return serveAsset(context, env, request, path);
  }
  // Legacy /stock/ → /stocks/ redirect
  if (path.length > 7 && path.charCodeAt(1) === 115 && path.startsWith("/stock/")) {
    return Response.redirect(
      rawUrl.slice(0, pathStart) + "/stocks" + path.slice(6) + (qmark === -1 ? "" : rawUrl.slice(qmark)),
      301
    );
  }

  // ── 5. Geo-routing ──
  if (path.length > 8 && path.charCodeAt(1) === 103 && path.startsWith("/global/")) {
    return handleGeoRoute(context, env, request, rawUrl, pathStart, path, qmark);
  }

  // ── 6. Clients pillar — rewrite to /clients/ ──
  const clientUrl = rawUrl.slice(0, pathStart) + "/clients" + path + (qmark === -1 ? "" : rawUrl.slice(qmark));
  const response = await env.ASSETS.fetch(new Request(clientUrl, request));

  if (response.status === 404) {
    return context.next();
  }

  if (isAssetPath(path)) {
    const tagged = tagAndTrack(context, env, request, path, response);
    return tagged;
  }
  return response;
}

/**
 * Rewrite path and fetch — constructs URL string directly, avoids new URL().
 */
function rewriteFetch(env, request, rawUrl, pathStart, newPath) {
  const newUrl = rawUrl.slice(0, pathStart) + newPath;
  return env.ASSETS.fetch(new Request(newUrl, request));
}

/**
 * Tag response with Cache-Tag and fire analytics (non-blocking).
 */
function tagAndTrack(context, env, request, path, response) {
  const tag = buildCacheTag(path);
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Cache-Tag", tag);
  try { context.waitUntil(trackRequest(env, request, newResponse, path)); } catch {}
  return newResponse;
}

async function serveAsset(context, env, request, path) {
  const response = await context.next();
  if (isAssetPath(path)) {
    return tagAndTrack(context, env, request, path, response);
  }
  return response;
}

async function handleGeoRoute(context, env, request, rawUrl, pathStart, path, qmark) {
  const continent = request.cf?.continent || "NA";
  const region = CONTINENT_MAP[continent] || "north-america";
  const rest = path.slice(8); // "/global/".length === 8

  const rewrittenUrl = rawUrl.slice(0, pathStart) + "/" + region + "/" + rest + (qmark === -1 ? "" : rawUrl.slice(qmark));
  let response = await env.ASSETS.fetch(new Request(rewrittenUrl, request));

  if (response.status === 404) {
    response = await context.next();
  }

  const newResponse = new Response(response.body, response);
  newResponse.headers.set("X-CDN-Region", region);
  return newResponse;
}
