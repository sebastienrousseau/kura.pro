import { log, appendAuditLog, legacyErrorJson } from './_shared.js';
import { validateToken } from './tokens.js';

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

  // Auth: PURGE_KEY in x-api-key header, OR a scoped Bearer token with "purge:write"
  const apiKey = request.headers.get("x-api-key");
  const apiKeyOk = env.PURGE_KEY && apiKey === env.PURGE_KEY;
  const tokenOk = !apiKeyOk && (await validateToken(env, request, "purge:write"));
  if (!apiKeyOk && !tokenOk) {
    return legacyErrorJson(401, "Unauthorized");
  }

  // Required env
  if (!env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
    return legacyErrorJson(500, "Server misconfigured: missing CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN");
  }

  // Rate limit
  const kv = env.RATE_KV;
  const rateLimitKey = `purge:count:${today()}`;
  const currentCount = parseInt(await kv.get(rateLimitKey) || "0", 10);
  if (currentCount >= MAX_PURGES_PER_DAY) {
    return legacyErrorJson(
      429,
      `Rate limit exceeded: max ${MAX_PURGES_PER_DAY} purges per day`,
      { limit: MAX_PURGES_PER_DAY, retryAfter: 86400 }
    );
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return legacyErrorJson(400, "Invalid JSON body");
  }

  // Build Cloudflare API payload — exactly one mode allowed
  let cfPayload;
  const modes = [body.purge_everything === true, Array.isArray(body.urls), Array.isArray(body.tags)];
  const activeCount = modes.filter(Boolean).length;

  if (activeCount > 1) {
    return legacyErrorJson(400, "Only one of purge_everything, urls, or tags may be specified per request");
  }

  if (body.purge_everything === true) {
    cfPayload = { purge_everything: true };
  } else if (Array.isArray(body.urls)) {
    if (body.urls.length === 0) {
      return legacyErrorJson(400, "urls array is empty");
    }
    if (body.urls.length > MAX_URLS) {
      return legacyErrorJson(400, `Too many URLs: max ${MAX_URLS} per request`);
    }
    const invalid = body.urls.filter((u) => !u.startsWith(ALLOWED_PREFIX));
    if (invalid.length > 0) {
      return legacyErrorJson(400, `All URLs must start with ${ALLOWED_PREFIX}`, { extra: { invalid } });
    }
    cfPayload = { files: body.urls };
  } else if (Array.isArray(body.tags)) {
    if (body.tags.length === 0) {
      return legacyErrorJson(400, "tags array is empty");
    }
    if (body.tags.length > MAX_TAGS) {
      return legacyErrorJson(400, `Too many tags: max ${MAX_TAGS} per request`);
    }
    const invalidTags = body.tags.filter((t) => typeof t !== "string" || !TAG_PATTERN.test(t));
    if (invalidTags.length > 0) {
      return legacyErrorJson(400, "Tags must be alphanumeric with hyphens only", { extra: { invalid: invalidTags } });
    }
    cfPayload = { tags: body.tags };
  } else {
    return legacyErrorJson(400, 'Request must include "urls" array, "tags" array, or "purge_everything": true');
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
    log.error("PURGE_ERROR", err.message);
    return legacyErrorJson(502, "Failed to reach Cloudflare API");
  }

  const cfResult = await cfResponse.json();

  // Increment rate limit counter on success
  if (cfResult.success) {
    await kv.put(rateLimitKey, String(currentCount + 1), {
      expirationTtl: 60 * 60 * 24 * 2,
    });
  }

  const status = cfResult.success ? 200 : 502;

  // Audit only successful purges — failures are operational noise.
  if (cfResult.success) {
    await appendAuditLog(env, request, 'purge.execute', {
      mode: body.purge_everything ? 'everything' : (body.urls ? 'urls' : 'tags'),
      /* v8 ignore next -- validation upstream guarantees exactly one of
         purge_everything / urls / tags is set, so the `|| 0` fallback is
         a defensive guard that never fires */
      count: body.purge_everything ? null : (body.urls?.length || body.tags?.length || 0),
    });
  }

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

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Max-Age": "86400",
    },
  });
}
