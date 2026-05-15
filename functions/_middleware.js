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
 *
 * The if-falsy branches below (`!project`, `!type`, `!ext`, plus the
 * `(tag ? ", " : "")` else-arms when `tag` is still empty) are
 * effectively dead in production: tagAndTrack only runs against asset
 * paths that survived routing through the clients pillar or the stocks
 * pillar, both of which guarantee a project segment and an asset
 * extension. The branches stay as guards so a future routing change
 * doesn't crash here on a stray path with missing segments, but they
 * aren't worth contorting tests to exercise.
 */
/* v8 ignore start -- defensive guards; see buildCacheTag jsdoc */
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
/* v8 ignore stop */

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

// CSP override for /api-reference. The page embeds Scalar's interactive
// API explorer (`<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference">`),
// which (a) loads its bundle from jsDelivr and (b) injects inline
// scripts/styles at runtime for its Vue mount. The page is read-only docs
// over a public OpenAPI spec — no attacker-controlled content rendered —
// so we allow:
//   - script-src ... 'unsafe-inline' cdn.jsdelivr.net  (Scalar bundle + runtime)
//   - style-src  ... cdn.jsdelivr.net                  (Scalar's CSS bundle)
//   - font-src   data: cdn.jsdelivr.net                (icon fonts)
//   - img-src    data: https:                          (API endpoint icons)
//   - connect-src cloudcdn.pro                         (Try-it fetches)
//
// Everything else (frame-ancestors, object-src, upgrade-insecure-requests,
// base-uri, form-action) stays as strict as the public page CSP.
// Scalar's runtime calls api.scalar.com (registry search) and fetches
// source maps from cdn.jsdelivr.net; fonts come from various https
// origins (Google Fonts, jsdelivr). font-src/connect-src widened to
// `https:` so we don't have to track every CDN Scalar might add later —
// the rest of the strict baseline (frame-ancestors, object-src,
// upgrade-insecure-requests) still applies.
const API_REFERENCE_CSP =
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; " +
  "font-src 'self' data: https:; " +
  "img-src 'self' data: https:; " +
  "connect-src 'self' https:; " +
  "worker-src 'self' blob:; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
  "object-src 'none'; upgrade-insecure-requests";

/**
 * Stamp the relaxed API-Reference CSP onto a response. Called from the
 * `/api-reference` rewrite branch *before* the response goes through
 * applyResponseEnvelope, which only sets CSP when not already present.
 */
function withApiReferenceCsp(response) {
  const headers = new Headers(response.headers);
  // Headers.set replaces a single named value, but if the upstream
  // response somehow already carries a CSP (Cloudflare Pages can stamp
  // one from a matching _headers rule before the worker sees it),
  // the iterator-based Headers copy can carry two entries. Drop any
  // pre-existing CSP first so the override is the only one on the wire.
  headers.delete("Content-Security-Policy");
  headers.set("Content-Security-Policy", API_REFERENCE_CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
  /* v8 ignore next -- createTrace() always returns truthy; the falsy
     branch is a defensive guard for unit tests that bypass the wrapper. */
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
  // Leaked internal /cdn/<locale>/... paths → 301 to the canonical clean
  // URL. Pages serves these because they exist in the deploy, but
  // they're meant to be the middleware's INTERNAL rewrite target, not
  // user-facing. When they leak (old bookmarks, copy-pasted preview
  // URLs, the previous index.html → directory 308 dance), users land on
  // pages with the strict default CSP — Scalar gets blocked, the
  // theme toggle still works but the canonical URL is wrong.
  if (path.length > 4 && path.startsWith("/cdn/")) {
    const rest = path.slice(4); // includes leading "/", e.g. "/en/api-reference/"
    const slash = rest.indexOf("/", 1);
    const lang = slash === -1 ? rest.slice(1) : rest.slice(1, slash);
    if (LOCALES.has(lang)) {
      const tail = slash === -1 ? "" : rest.slice(slash);
      // EN drops the /en/ prefix; other locales keep their /{lang}/ prefix.
      // Where the canonical URL has a specific trailing-slash convention,
      // we emit it directly to save the browser a second hop:
      //   /api-reference  — no slash (per the route handler above)
      //   /dashboard/, /dist/ — slash (those are Functions-middleware roots
      //     with a /dashboard|/dist → /…/ 301 of their own)
      let target;
      if (lang === "en") {
        if (tail === "" || tail === "/") target = "/";
        else if (tail === "/api-reference/" || tail === "/api-reference") target = "/api-reference";
        else if (tail === "/dashboard" || tail === "/dashboard/") target = "/dashboard/";
        else if (tail === "/dist" || tail === "/dist/") target = "/dist/";
        else target = tail;
      } else {
        target = tail === "" ? "/" + lang + "/" : "/" + lang + tail;
      }
      const query = qmark === -1 ? "" : rawUrl.slice(qmark);
      return Response.redirect(rawUrl.slice(0, pathStart) + target + query, 301);
    }
  }

  // Root → English homepage. Use the directory path (not /index.html)
  // so env.ASSETS serves the index directly instead of 308-redirecting
  // — the new /cdn/<locale>/... → clean-URL redirect above would loop
  // forever on that 308 (`/` → /cdn/en/index.html → 308 /cdn/en/ → 301 /).
  if (path === "/" || path === "/index.html") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/en/");
  }

  // Locale homepages: /fr, /fr/, /fr/index.html → /cdn/fr/
  // Also handles /en/ explicitly. Directory path for the same reason
  // as the root rewrite above.
  const firstSlash = path.indexOf("/", 1);
  const firstSegment = firstSlash === -1 ? path.slice(1) : path.slice(1, firstSlash);
  if (LOCALES.has(firstSegment)) {
    const rest = firstSlash === -1 ? "" : path.slice(firstSlash);
    if (rest === "" || rest === "/" || rest === "/index.html") {
      return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/" + firstSegment + "/");
    }
  }
  if (path === "/404.html") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/cdn/404.html");
  }
  if (path === "/robots.txt" || path === "/sitemap.xml") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/cdn" + path);
  }
  if (path === "/api-reference" || path === "/api-reference/") {
    // Use the directory path (not /index.html) so env.ASSETS serves the
    // index directly instead of 308-redirecting to add a trailing slash.
    // Both / and no-/ forms get the same override so Scalar boots either
    // way (and the LOCALIZED_PREFIXES rule below catches deeper paths
    // like /api-reference/openapi.json or /api-reference/clients/*).
    const res = await rewriteFetch(env, request, rawUrl, pathStart, "/cdn/en/api-reference/");
    return withApiReferenceCsp(res);
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
    /* v8 ignore next -- when firstSlash === -1, the locale-homepage block
       above always returns first (rest === "" matches the homepage match),
       so this ternary's true-branch is unreachable in practice. */
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
