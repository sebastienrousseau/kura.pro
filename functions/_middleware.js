/**
 * Cloudflare Pages middleware — three-pillar routing.
 *
 * Performance-critical: runs on EVERY request.
 * Optimized for minimal allocations and zero-copy where possible.
 *
 * Physical:  /clients/, /stocks/, /website/
 * Logical:   cloudcdn.pro/akande/..., /stocks/..., /dashboard/...
 */

import { trackRequest } from "./api/analytics.js";

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

// Pre-computed website prefixes for O(1) lookup
const WEBSITE_PREFIXES = ["/dashboard/", "/dist/", "/shared/", "/content/", "/api-reference/"];

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

export async function onRequest(context) {
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
  if (path === "/manifest.json" || path === "/favicon.ico") {
    return context.next();
  }

  // ── 3. Website pillar ──
  if (path === "/website" || path === "/website/") {
    return Response.redirect(rawUrl.slice(0, pathStart) + "/", 301);
  }
  if (path === "/" || path === "/index.html") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/website/index.html");
  }
  if (path === "/404.html") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/website/404.html");
  }
  if (path === "/robots.txt" || path === "/sitemap.xml") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/website" + path);
  }
  if (path === "/api-reference") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/website/api-reference/index.html");
  }
  if (path === "/dist") {
    return rewriteFetch(env, request, rawUrl, pathStart, "/website/dist/index.html");
  }
  if (path === "/dashboard") {
    return Response.redirect(rawUrl.slice(0, pathStart) + "/dashboard/" + (qmark === -1 ? "" : rawUrl.slice(qmark)), 301);
  }

  // Website prefix check — linear scan of 5 items (faster than Set for small N)
  for (let i = 0; i < WEBSITE_PREFIXES.length; i++) {
    const prefix = WEBSITE_PREFIXES[i];
    if (path.length >= prefix.length &&
        path.charCodeAt(1) === prefix.charCodeAt(1) &&
        path.startsWith(prefix)) {
      return rewriteFetch(env, request, rawUrl, pathStart, "/website" + path);
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
 * Uses redirect: 'manual' to prevent ASSETS.fetch from following internal redirects.
 */
function rewriteFetch(env, request, rawUrl, pathStart, newPath) {
  const newUrl = rawUrl.slice(0, pathStart) + newPath;
  return env.ASSETS.fetch(new Request(newUrl, { headers: request.headers, redirect: 'manual' }));
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
