/**
 * Cloudflare Pages middleware — runs on every request.
 *
 * - Adds Cache-Tag surrogate keys for asset responses
 * - Geo-routes /global/ paths to region-specific folders
 * - Tracks asset requests via analytics (non-blocking)
 */

import { trackRequest } from "./api/analytics.js";

const ASSET_EXTENSIONS = /\.(webp|avif|png|svg|ico|mp4)$/i;
const PASSTHROUGH_PREFIXES = ["/api/", "/dashboard/", "/dist/"];

const CONTINENT_MAP = {
  EU: "europe",
  AS: "asia",
  NA: "north-america",
  SA: "south-america",
  AF: "africa",
  OC: "oceania",
  AN: "antarctica",
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Pass through API, dashboard, and dist routes unchanged
  if (PASSTHROUGH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return context.next();
  }

  // Geo-routing for /global/ paths
  if (path.startsWith("/global/")) {
    return handleGeoRoute(context, url, path);
  }

  // Get the response from origin
  const response = await context.next();

  // Add Cache-Tag headers for asset responses
  if (ASSET_EXTENSIONS.test(path)) {
    const tagged = addCacheTags(response, path);

    // Non-blocking analytics tracking
    try {
      context.waitUntil(trackRequest(env, request, tagged));
    } catch {
      // Never block the response
    }

    return tagged;
  }

  return response;
}

/**
 * Derive Cache-Tag surrogate keys from the URL path.
 * Example: /bankingonai/assets/banners/hero.webp
 *   → project-bankingonai, type-banners, format-webp, all-assets
 */
function addCacheTags(response, path) {
  const segments = path.split("/").filter(Boolean);
  const tags = [];

  // Project name — first path segment
  if (segments.length > 0) {
    tags.push(`project-${segments[0]}`);
  }

  // Category — third path segment (index 2)
  if (segments.length > 2) {
    tags.push(`type-${segments[2]}`);
  }

  // Format — file extension
  const extMatch = path.match(/\.(\w+)$/);
  if (extMatch) {
    tags.push(`format-${extMatch[1].toLowerCase()}`);
  }

  tags.push("all-assets");

  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Cache-Tag", tags.join(", "));
  return newResponse;
}

/**
 * Rewrite /global/<rest> to /{region}/<rest> based on cf.continent.
 * Falls back to /global/ if the region-specific path 404s.
 */
async function handleGeoRoute(context, url, path) {
  const continent = context.request.cf?.continent || "NA";
  const region = CONTINENT_MAP[continent] || "north-america";
  const rest = path.slice("/global/".length);
  const rewrittenPath = `/${region}/${rest}`;

  // Build a new URL for the rewritten path
  const rewrittenUrl = new URL(url);
  rewrittenUrl.pathname = rewrittenPath;

  // Fetch from origin with rewritten path
  const rewrittenRequest = new Request(rewrittenUrl, context.request);
  let response = await context.env.ASSETS.fetch(rewrittenRequest);

  // Fall back to original /global/ path on 404
  if (response.status === 404) {
    response = await context.next();
  }

  const newResponse = new Response(response.body, response);
  newResponse.headers.set("X-CDN-Region", region);
  return newResponse;
}
