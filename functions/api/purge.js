/**
 * Cache invalidation endpoint.
 *
 * POST /api/purge
 * Body: { "urls": ["https://cloudcdn.pro/path/to/asset.webp"] }
 *   or: { "purge_everything": true }
 *   or: { "tags": ["project-bankingonai", "type-banner"] }
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const MAX_URLS = 30;
const MAX_TAGS = 30;
const MAX_PURGES_PER_DAY = 100;
const ALLOWED_PREFIX = "https://cloudcdn.pro/";
const TAG_PATTERN = /^[a-zA-Z0-9-]+$/;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function onRequestPost(context) {
  const { env, request } = context;

  // Auth
  const apiKey = request.headers.get("x-api-key");
  if (!env.PURGE_KEY || apiKey !== env.PURGE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  // Required env
  if (!env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
    return new Response(
      JSON.stringify({ error: "Server misconfigured: missing CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Rate limit
  const kv = env.RATE_KV;
  const rateLimitKey = `purge:count:${today()}`;
  const currentCount = parseInt(await kv.get(rateLimitKey) || "0", 10);
  if (currentCount >= MAX_PURGES_PER_DAY) {
    return new Response(
      JSON.stringify({ error: `Rate limit exceeded: max ${MAX_PURGES_PER_DAY} purges per day` }),
      { status: 429, headers: CORS_HEADERS }
    );
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  // Build Cloudflare API payload — exactly one mode allowed
  let cfPayload;
  const modes = [body.purge_everything === true, Array.isArray(body.urls), Array.isArray(body.tags)];
  const activeCount = modes.filter(Boolean).length;

  if (activeCount > 1) {
    return new Response(
      JSON.stringify({ error: "Only one of purge_everything, urls, or tags may be specified per request" }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (body.purge_everything === true) {
    cfPayload = { purge_everything: true };
  } else if (Array.isArray(body.urls)) {
    if (body.urls.length === 0) {
      return new Response(JSON.stringify({ error: "urls array is empty" }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    if (body.urls.length > MAX_URLS) {
      return new Response(
        JSON.stringify({ error: `Too many URLs: max ${MAX_URLS} per request` }),
        { status: 400, headers: CORS_HEADERS }
      );
    }
    const invalid = body.urls.filter((u) => !u.startsWith(ALLOWED_PREFIX));
    if (invalid.length > 0) {
      return new Response(
        JSON.stringify({
          error: `All URLs must start with ${ALLOWED_PREFIX}`,
          invalid,
        }),
        { status: 400, headers: CORS_HEADERS }
      );
    }
    cfPayload = { files: body.urls };
  } else if (Array.isArray(body.tags)) {
    if (body.tags.length === 0) {
      return new Response(JSON.stringify({ error: "tags array is empty" }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    if (body.tags.length > MAX_TAGS) {
      return new Response(
        JSON.stringify({ error: `Too many tags: max ${MAX_TAGS} per request` }),
        { status: 400, headers: CORS_HEADERS }
      );
    }
    const invalidTags = body.tags.filter((t) => typeof t !== "string" || !TAG_PATTERN.test(t));
    if (invalidTags.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Tags must be alphanumeric with hyphens only",
          invalid: invalidTags,
        }),
        { status: 400, headers: CORS_HEADERS }
      );
    }
    cfPayload = { tags: body.tags };
  } else {
    return new Response(
      JSON.stringify({ error: 'Request must include "urls" array, "tags" array, or "purge_everything": true' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Call Cloudflare API
  const cfUrl = `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`;

  let cfResponse;
  try {
    cfResponse = await fetch(cfUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cfPayload),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to reach Cloudflare API", detail: err.message }),
      { status: 502, headers: CORS_HEADERS }
    );
  }

  const cfResult = await cfResponse.json();

  // Increment rate limit counter on success
  if (cfResult.success) {
    await kv.put(rateLimitKey, String(currentCount + 1), {
      expirationTtl: 60 * 60 * 24 * 2,
    });
  }

  const status = cfResult.success ? 200 : 502;

  return new Response(
    JSON.stringify({
      success: cfResult.success,
      purged: body.purge_everything ? "everything" : (body.urls || body.tags),
      remaining_today: cfResult.success
        ? MAX_PURGES_PER_DAY - (currentCount + 1)
        : MAX_PURGES_PER_DAY - currentCount,
      cloudflare: cfResult,
    }, null, 2),
    { status, headers: CORS_HEADERS }
  );
}
