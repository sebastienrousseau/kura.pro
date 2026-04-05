/**
 * Insights — Error tracking (4xx/5xx).
 * GET /api/insights/errors?days=7
 */
import { authenticateAny, checkRateLimit, errorResponse, CORS_JSON } from '../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await authenticateAny(request, env))) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS_JSON });
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env.RATE_KV, `rl:insights:${ip}`, 200, 60);
  if (!rl.allowed) return errorResponse(429, 'TooManyRequests', 'Rate limit exceeded. Maximum 200 requests per minute.', { retryAfter: '60', limit: rl.limit });

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10), 1), 90);
  const kv = env.RATE_KV;

  if (!kv) return new Response(JSON.stringify({ HttpCode: 503, Message: 'The analytics data store (Cloudflare KV) is currently unavailable. This may be a temporary issue with the edge network. Retry the request in a few seconds or check system status.' }), { status: 503, headers: CORS_JSON });

  const reads = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
    reads.push(kv.get(`analytics:errors:${d.toISOString().slice(0, 10)}`));
  }
  const results = await Promise.all(reads);

  const merged = {};
  for (const raw of results) {
    if (!raw) continue;
    const dayErrors = JSON.parse(raw);
    for (const [code, data] of Object.entries(dayErrors)) {
      if (!merged[code]) merged[code] = { count: 0, paths: {} };
      merged[code].count += data.count || 0;
      for (const [path, count] of Object.entries(data.paths || {})) {
        merged[code].paths[path] = (merged[code].paths[path] || 0) + count;
      }
    }
  }

  const errors = Object.entries(merged)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([code, data]) => ({
      StatusCode: parseInt(code, 10),
      Count: data.count,
      TopPaths: Object.entries(data.paths).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([path, count]) => ({ Path: path, Count: count })),
    }));

  return new Response(JSON.stringify({
    Period: { Days: days },
    Errors: errors,
    Note: errors.length === 0 ? 'Error tracking populates automatically from middleware analytics.' : undefined,
    DateFetched: new Date().toISOString(),
  }), { headers: CORS_JSON });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS_JSON, 'Access-Control-Allow-Headers': 'AccountKey, AccessKey', 'Access-Control-Max-Age': '86400' } });
}
