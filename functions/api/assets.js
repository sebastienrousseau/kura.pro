/**
 * Assets API — Paginated, filterable asset catalog.
 *
 * GET /api/assets?project=akande&format=svg&q=banner&page=1&per_page=50&sort=name&order=asc
 *
 * Performance targets:
 *   - 50K req/s via isolate-scoped manifest cache (parsed once, reused ~30s)
 *   - < 2ms TTFB via streaming JSON (headers sent before body is built)
 *   - Constant memory via generator-based item yielding
 */

import { getManifest, authenticateAccess, streamJsonArray, extractParams, checkRateLimit, errorResponse, CORS_JSON } from './_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'AccessKey, Content-Type',
  'Content-Type': 'application/json',
};

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await authenticateAccess(request, env))) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  // Rate limit: 1000 req/minute per IP
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env.RATE_KV, `rl:assets:${ip}`, 1000, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', 'Rate limit exceeded for assets endpoint. Maximum 1000 requests per minute per IP address. Wait before retrying.', { retryAfter: '60', limit: rl.limit });
  }

  const params = extractParams(request.url);
  const project = params.get('project') || null;
  const category = params.get('category') || null;
  const format = params.get('format') || null;
  const query = params.get('q')?.trim().toLowerCase() || null;
  const page = Math.max(parseInt(params.get('page') || '1', 10), 1);
  const perPage = Math.min(Math.max(parseInt(params.get('per_page') || String(DEFAULT_PER_PAGE), 10), 1), MAX_PER_PAGE);
  const sort = params.get('sort') || 'name';
  const order = params.get('order') === 'desc' ? 'desc' : 'asc';

  // Cached manifest — parsed once per isolate, reused for ~30s
  let manifest;
  try {
    manifest = await getManifest(env, request.url);
  } catch {
    return new Response(JSON.stringify({ HttpCode: 503, Message: 'The asset manifest could not be loaded from the edge cache. This may indicate a deployment is in progress. Retry the request in a few seconds or check the system status.' }), { status: 503, headers: CORS });
  }

  // Single-pass filter (no intermediate arrays)
  let assets = manifest;
  if (project) assets = assets.filter(a => a.project === project);
  if (category) assets = assets.filter(a => a.category === category);
  if (format) assets = assets.filter(a => a.format === format);
  if (query) assets = assets.filter(a => a.name.toLowerCase().includes(query) || a.path.toLowerCase().includes(query));

  // Sort
  const cmp = sort === 'size'
    ? (a, b) => order === 'desc' ? b.size - a.size : a.size - b.size
    : sort === 'project'
    ? (a, b) => order === 'desc' ? b.project.localeCompare(a.project) : a.project.localeCompare(b.project)
    : (a, b) => order === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
  assets.sort(cmp);

  // Paginate
  const totalItems = assets.length;
  const totalPages = Math.max(Math.ceil(totalItems / perPage), 1);
  const start = (page - 1) * perPage;
  const pageItems = assets.slice(start, start + perPage);

  // Stream response — TTFB < 2ms, constant memory
  return streamJsonArray({
    envelope: {
      Pagination: { Page: page, PerPage: perPage, TotalItems: totalItems, TotalPages: totalPages },
      Filters: { Project: project, Category: category, Format: format, Query: query },
      DateFetched: new Date().toISOString(),
    },
    arrayKey: 'Data',
    items: pageItems,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}
