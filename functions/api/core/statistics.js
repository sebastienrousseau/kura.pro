/**
 * Core API — Edge Statistics.
 *
 * GET /api/core/statistics?days=7&zone=akande
 *
 * Returns bandwidth, requests, cache ratios, and geo distribution
 * from the analytics KV store, optionally filtered by zone.
 *
 * Auth: AccountKey header (env.ACCOUNT_KEY).
 */

import { checkRateLimit, errorResponse } from '../_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey',
  'Content-Type': 'application/json',
};

function authenticate(request, env) {
  const key = request.headers.get('AccountKey');
  if (!env.ACCOUNT_KEY) return true;
  return key === env.ACCOUNT_KEY;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authenticate(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  // Rate limit: 60 req/minute per IP
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env.RATE_KV, `rl:stats:${ip}`, 60, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', 'Rate limit exceeded for statistics endpoint. Maximum 60 requests per minute per IP address. Wait before retrying.', { retryAfter: '60', limit: rl.limit });
  }

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10), 1), 90);
  const zone = url.searchParams.get('zone') || '';
  const kv = env.RATE_KV;

  if (!kv) {
    return new Response(JSON.stringify({ HttpCode: 503, Message: 'The analytics data store (Cloudflare KV) is currently unavailable. This may be a temporary issue with the edge network. Retry the request in a few seconds or check system status.' }), { status: 503, headers: CORS });
  }

  const daily = [];
  let totalHits = 0, totalBandwidth = 0, totalCacheHit = 0, totalCacheMiss = 0;
  const allGeo = {};
  const allAssets = {};

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

    const dayHits = parseInt(hits || '0', 10);
    const dayBw = parseInt(bandwidth || '0', 10);
    const cache = cacheRaw ? JSON.parse(cacheRaw) : {};
    const top = topRaw ? JSON.parse(topRaw) : {};
    const geo = geoRaw ? JSON.parse(geoRaw) : {};

    // Filter by zone if specified
    let filteredHits = dayHits;
    let filteredTop = top;
    if (zone) {
      filteredTop = {};
      filteredHits = 0;
      for (const [path, count] of Object.entries(top)) {
        if (path.startsWith(`/${zone}/`) || path.startsWith(`/${zone}`)) {
          filteredTop[path] = count;
          filteredHits += count;
        }
      }
    }

    totalHits += filteredHits;
    totalBandwidth += dayBw;
    totalCacheHit += (cache.hit || 0);
    totalCacheMiss += (cache.miss || 0);

    for (const [k, v] of Object.entries(geo)) allGeo[k] = (allGeo[k] || 0) + v;
    for (const [k, v] of Object.entries(filteredTop)) allAssets[k] = (allAssets[k] || 0) + v;

    daily.push({
      Date: date,
      TotalRequests: filteredHits,
      Bandwidth: dayBw,
      BandwidthHuman: formatBytes(dayBw),
      CacheHit: cache.hit || 0,
      CacheMiss: cache.miss || 0,
    });
  }

  const cacheTotal = totalCacheHit + totalCacheMiss;
  const topAssets = Object.entries(allAssets).sort((a, b) => b[1] - a[1]).slice(0, 50);
  const geoSorted = Object.entries(allGeo).sort((a, b) => b[1] - a[1]);

  return new Response(JSON.stringify({
    Period: { Days: days, Zone: zone || 'all' },
    Summary: {
      TotalRequests: totalHits,
      TotalBandwidth: totalBandwidth,
      TotalBandwidthHuman: formatBytes(totalBandwidth),
      CacheHitRate: cacheTotal > 0 ? ((totalCacheHit / cacheTotal) * 100).toFixed(1) + '%' : 'N/A',
      UniqueCountries: Object.keys(allGeo).length,
    },
    Daily: daily.reverse(),
    TopAssets: topAssets.map(([path, count]) => ({ Path: path, Requests: count })),
    GeoDistribution: geoSorted.map(([country, count]) => ({ CountryCode: country, Requests: count })),
  }, null, 2), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

function formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
