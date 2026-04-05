/**
 * Insights — Summary statistics.
 * GET /api/insights/summary?days=7&zone=akande
 */
import { authenticateAny, formatBytes, checkRateLimit, errorResponse, CORS_JSON } from '../_shared.js';

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
  const zone = url.searchParams.get('zone') || '';
  const kv = env.RATE_KV;

  if (!kv) return new Response(JSON.stringify({ HttpCode: 503, Message: 'The analytics data store (Cloudflare KV) is currently unavailable. This may be a temporary issue with the edge network. Retry the request in a few seconds or check system status.' }), { status: 503, headers: CORS_JSON });

  // Parallel KV reads for all days at once
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const reads = dates.flatMap(date => [
    kv.get(`analytics:hits:${date}`),
    kv.get(`analytics:bandwidth:${date}`),
    kv.get(`analytics:geo:${date}`),
    kv.get(`analytics:cache:${date}`),
    kv.get(`analytics:top:${date}`),
  ]);
  const results = await Promise.all(reads);

  let totalHits = 0, totalBw = 0, totalCacheHit = 0, totalCacheMiss = 0;
  const allGeo = {};

  for (let i = 0; i < dates.length; i++) {
    const base = i * 5;
    let dayHits = parseInt(results[base] || '0', 10);
    const dayBw = parseInt(results[base + 1] || '0', 10);
    const geo = results[base + 2] ? JSON.parse(results[base + 2]) : {};
    const cache = results[base + 3] ? JSON.parse(results[base + 3]) : {};
    const top = results[base + 4] ? JSON.parse(results[base + 4]) : {};

    if (zone) {
      dayHits = 0;
      for (const [path, count] of Object.entries(top)) {
        if (path.startsWith(`/${zone}/`) || path.startsWith(`/${zone}`)) dayHits += count;
      }
    }

    totalHits += dayHits;
    totalBw += dayBw;
    totalCacheHit += (cache.hit || 0);
    totalCacheMiss += (cache.miss || 0);
    for (const [k, v] of Object.entries(geo)) allGeo[k] = (allGeo[k] || 0) + v;
  }

  const cacheTotal = totalCacheHit + totalCacheMiss;

  return new Response(JSON.stringify({
    Period: { Days: days, Zone: zone || 'all' },
    TotalRequests: totalHits,
    TotalBandwidth: formatBytes(totalBw),
    TotalBandwidthBytes: totalBw,
    CacheHitRate: cacheTotal > 0 ? ((totalCacheHit / cacheTotal) * 100).toFixed(1) + '%' : 'N/A',
    UniqueCountries: Object.keys(allGeo).length,
    DateFetched: new Date().toISOString(),
  }), { headers: CORS_JSON });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS_JSON, 'Access-Control-Allow-Headers': 'AccountKey, AccessKey', 'Access-Control-Max-Age': '86400' } });
}
