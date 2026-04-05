/**
 * Edge analytics tracking and reporting endpoint.
 *
 * GET /api/analytics?days=7  — reporting (api-key protected)
 * POST /api/analytics        — record a hit (called by trackRequest helper)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const KV_TTL = 60 * 60 * 24 * 35; // 35 days

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Increment a numeric counter stored in KV.
 * KV doesn't have atomic increment, so we read-then-write.
 */
async function incrementCounter(kv, key, amount = 1) {
  const current = parseInt(await kv.get(key) || "0", 10);
  const next = current + amount;
  await kv.put(key, String(next), { expirationTtl: KV_TTL });
  return next;
}

/**
 * Increment a field inside a JSON object stored in KV.
 * Keeps only the top `limit` entries by value.
 *
 * Optimized: only triggers eviction when size exceeds limit * 1.5
 * (amortized O(1) per request instead of O(n log n) sort every time).
 */
async function incrementJsonField(kv, key, field, amount = 1, limit = 0) {
  const raw = await kv.get(key);
  const obj = raw ? JSON.parse(raw) : {};
  obj[field] = (obj[field] || 0) + amount;

  let result = obj;
  // Defer sorting — only evict when object grows 50% past the limit.
  // This amortizes the O(n log n) sort across many requests.
  if (limit > 0) {
    const keys = Object.keys(obj);
    if (keys.length > limit + (limit >> 1)) {
      // Eviction needed — sort and trim
      const sorted = keys
        .map(k => [k, obj[k]])
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
      result = {};
      for (let i = 0; i < sorted.length; i++) result[sorted[i][0]] = sorted[i][1];
    }
  }

  await kv.put(key, JSON.stringify(result), { expirationTtl: KV_TTL });
  return result;
}

/**
 * Track a single request. Exported so middleware/other functions can call it.
 *
 * @param {object} env       - context.env with RATE_KV binding
 * @param {Request} request  - the inbound request
 * @param {Response} response - the outbound response (used for cache status & content-length)
 */
/**
 * @param {object} env
 * @param {Request} request
 * @param {Response} response
 * @param {string} [pathname] - pre-extracted pathname (avoids new URL() allocation)
 */
export async function trackRequest(env, request, response, pathname) {
  const kv = env.RATE_KV;
  if (!kv) return;

  const date = today();
  // Use pre-extracted pathname if available — avoids 50µs URL parse
  const path = pathname || new URL(request.url).pathname;
  const country = request.cf?.country || request.headers.get("cf-ipcountry") || "XX";
  const bytes = parseInt(response.headers.get("content-length") || "0", 10);
  const cacheStatus = (request.cf?.cacheStatus || response.headers.get("cf-cache-status") || "MISS").toUpperCase();
  const isHit = cacheStatus === "HIT" ? "hit" : "miss";

  const tasks = [
    incrementCounter(kv, `analytics:hits:${date}`),
    incrementCounter(kv, `analytics:bandwidth:${date}`, bytes),
    incrementJsonField(kv, `analytics:top:${date}`, path, 1, 100),
    incrementJsonField(kv, `analytics:geo:${date}`, country),
    incrementJsonField(kv, `analytics:cache:${date}`, isHit),
  ];

  // Track errors (4xx/5xx) for the insights/errors endpoint
  const status = response.status;
  if (status >= 400) {
    tasks.push(trackError(kv, date, status, path));
  }

  await Promise.all(tasks);
}

/**
 * Track an error response in KV.
 * Schema: analytics:errors:{date} → { "404": { "count": N, "paths": { "/path": N } } }
 */
async function trackError(kv, date, status, path) {
  const key = `analytics:errors:${date}`;
  const raw = await kv.get(key);
  const errors = raw ? JSON.parse(raw) : {};
  const code = String(status);

  if (!errors[code]) errors[code] = { count: 0, paths: {} };
  errors[code].count++;
  errors[code].paths[path] = (errors[code].paths[path] || 0) + 1;

  // Keep only top 50 paths per status code
  const sorted = Object.entries(errors[code].paths).sort((a, b) => b[1] - a[1]).slice(0, 50);
  errors[code].paths = Object.fromEntries(sorted);

  await kv.put(key, JSON.stringify(errors), { expirationTtl: KV_TTL });
}

/**
 * GET /api/analytics?days=7
 */
export async function onRequestGet(context) {
  const { env, request } = context;

  // Auth check
  if (env.ANALYTICS_KEY) {
    const key = request.headers.get("x-api-key");
    if (key !== env.ANALYTICS_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }
  }

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "7", 10), 1), 30);
  const kv = env.RATE_KV;

  const results = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);

    const [hits, bandwidth, topRaw, geoRaw, cacheRaw] = await Promise.all([
      kv.get(`analytics:hits:${date}`),
      kv.get(`analytics:bandwidth:${date}`),
      kv.get(`analytics:top:${date}`),
      kv.get(`analytics:geo:${date}`),
      kv.get(`analytics:cache:${date}`),
    ]);

    const bandwidthBytes = parseInt(bandwidth || "0", 10);
    const cache = cacheRaw ? JSON.parse(cacheRaw) : { hit: 0, miss: 0 };
    const cacheTotal = (cache.hit || 0) + (cache.miss || 0);

    results.push({
      date,
      hits: parseInt(hits || "0", 10),
      bandwidth: {
        bytes: bandwidthBytes,
        human: formatBytes(bandwidthBytes),
      },
      top_assets: topRaw ? JSON.parse(topRaw) : {},
      geo: geoRaw ? JSON.parse(geoRaw) : {},
      cache: {
        ...cache,
        ratio: cacheTotal > 0 ? `${((cache.hit || 0) / cacheTotal * 100).toFixed(1)}%` : "N/A",
      },
    });
  }

  return new Response(JSON.stringify({ days, data: results }, null, 2), {
    headers: CORS_HEADERS,
  });
}

/**
 * POST /api/analytics — programmatic tracking endpoint.
 * Body: { "path": "/img/foo.webp", "bytes": 12345, "country": "US", "cache": "HIT" }
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const body = await request.json();
    const date = today();
    const kv = env.RATE_KV;
    const path = body.path || "/";
    const bytes = parseInt(body.bytes || "0", 10);
    const country = body.country || "XX";
    const isHit = (body.cache || "MISS").toUpperCase() === "HIT" ? "hit" : "miss";

    await Promise.all([
      incrementCounter(kv, `analytics:hits:${date}`),
      incrementCounter(kv, `analytics:bandwidth:${date}`, bytes),
      incrementJsonField(kv, `analytics:top:${date}`, path, 1, 100),
      incrementJsonField(kv, `analytics:geo:${date}`, country),
      incrementJsonField(kv, `analytics:cache:${date}`, isHit),
    ]);

    return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
}
