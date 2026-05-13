/**
 * Insights — Per-asset request analytics.
 *
 * GET /api/insights/asset?path=clients/akande/v1/logos/logo.svg&days=7
 *
 * Auth: any control-plane key (AccountKey, AccessKey, or a scoped token with
 * insights:read).
 *
 * Reads daily aggregates from RATE_KV (the same keyspace populated by
 * functions/api/analytics.js#trackRequest):
 *   analytics:top:YYYY-MM-DD     — { path: requestCount }
 *   analytics:errors:YYYY-MM-DD  — { "404": { count, paths: { "/p": N }, ... }
 *
 * Returns a daily breakdown for one path so dashboards can answer
 * "how is THIS asset performing", not just rolled-up totals.
 */
import { authenticateAny, checkRateLimit, errorResponse, CORS_JSON } from '../_shared.js';

function utcDateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await authenticateAny(request, env))) {
    return errorResponse(401, 'Unauthorized', 'Authentication required. Provide AccountKey, AccessKey, or a scoped Bearer token with "insights:read".');
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env, `rl:insights:${ip}`, 200, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', 'Rate limit exceeded. Maximum 200 requests per minute per IP address.', { retryAfter: '60', limit: rl.limit });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path || typeof path !== 'string' || path.length === 0) {
    return errorResponse(400, 'MissingPath', 'The "path" query parameter is required. Provide the asset path you want analytics for (e.g. ?path=clients/acme/v1/logos/logo.svg).');
  }
  if (path.length > 2048) {
    return errorResponse(400, 'PathTooLong', 'Path exceeds the 2048-character maximum.');
  }
  if (path.includes('\0') || path.includes('..') || path.includes('//')) {
    return errorResponse(400, 'InvalidPath', 'Path contains disallowed sequences. Use a clean asset path without traversal or empty segments.');
  }

  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10), 1), 90);

  const kv = env.RATE_KV;
  if (!kv) {
    return errorResponse(503, 'KvUnavailable', 'The analytics namespace is currently unavailable. Verify the RATE_KV binding is configured.');
  }

  // The analytics writer stores top-asset paths with a leading slash even
  // when the manifest stores them without — match both forms so callers
  // don't need to know which.
  const candidates = path.startsWith('/') ? [path, path.slice(1)] : [path, '/' + path];

  const topReads = [];
  const errorReads = [];
  const dates = [];
  for (let i = 0; i < days; i++) {
    const date = utcDateNDaysAgo(i);
    dates.push(date);
    topReads.push(kv.get(`analytics:top:${date}`));
    errorReads.push(kv.get(`analytics:errors:${date}`));
  }
  const [tops, errs] = await Promise.all([Promise.all(topReads), Promise.all(errorReads)]);

  function readCount(rawJson) {
    if (!rawJson) return 0;
    let parsed;
    try { parsed = JSON.parse(rawJson); } catch { return 0; }
    for (const c of candidates) {
      if (typeof parsed[c] === 'number') return parsed[c];
    }
    return 0;
  }

  function readErrorCount(rawJson) {
    if (!rawJson) return {};
    let parsed;
    try { parsed = JSON.parse(rawJson); } catch { return {}; }
    const out = {};
    for (const [status, info] of Object.entries(parsed)) {
      const paths = info?.paths || {};
      for (const c of candidates) {
        if (typeof paths[c] === 'number') {
          out[status] = (out[status] || 0) + paths[c];
        }
      }
    }
    return out;
  }

  const daily = [];
  let totalRequests = 0;
  const errorTotals = {};
  for (let i = 0; i < days; i++) {
    const requests = readCount(tops[i]);
    const errors = readErrorCount(errs[i]);
    totalRequests += requests;
    for (const [status, n] of Object.entries(errors)) {
      errorTotals[status] = (errorTotals[status] || 0) + n;
    }
    daily.push({ Date: dates[i], Requests: requests, Errors: errors });
  }

  return new Response(JSON.stringify({
    Path: path,
    Period: { Days: days },
    TotalRequests: totalRequests,
    Errors: errorTotals,
    Daily: daily,
    DateFetched: new Date().toISOString(),
  }), { headers: CORS_JSON });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_JSON,
      'Access-Control-Allow-Headers': 'AccountKey, AccessKey, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
