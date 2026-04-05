/**
 * Semantic asset search — vector + fuzzy hybrid.
 *
 * GET /api/search?q=dark+blue+banking+background&limit=20
 *
 * Optimizations:
 *   - Cached manifest (shared isolate cache)
 *   - Pre-built search index (lowercase haystack per entry, built once)
 *   - Single-pass scored selection (no intermediate arrays)
 *   - No new URL() — pathname extracted from raw string
 */

import { getManifest, checkRateLimit, errorResponse } from './_shared.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60',
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const VECTOR_SCORE_THRESHOLD = 0.5;

// ── Pre-built search index (isolate-scoped) ──
let _indexCache = null;
let _indexManifest = null;

function getSearchIndex(manifest) {
  // Rebuild only when manifest reference changes
  if (_indexManifest === manifest && _indexCache) return _indexCache;

  _indexCache = manifest.map(entry => ({
    entry,
    // Pre-compute lowercase haystack once — not per query
    haystack: (entry.name + ' ' + entry.path + ' ' + entry.project + ' ' + entry.category + ' ' + entry.format).toLowerCase(),
  }));
  _indexManifest = manifest;
  return _indexCache;
}

function tokenize(str) {
  const tokens = [];
  let start = -1;
  const lower = str.toLowerCase();
  for (let i = 0; i <= lower.length; i++) {
    const c = i < lower.length ? lower.charCodeAt(i) : 0;
    const isAlnum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
    if (isAlnum) {
      if (start === -1) start = i;
    } else {
      if (start !== -1 && (i - start) > 1) {
        tokens.push(lower.slice(start, i));
      }
      start = -1;
    }
  }
  return tokens;
}

/**
 * Single-pass scored selection — O(n) with no intermediate arrays.
 * Uses a min-heap-like approach: maintain top-K scored items.
 */
function fuzzySearch(index, query, limit) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const invLen = 1 / tokens.length;

  // Pre-allocate results array
  const results = [];
  let minScore = 0;
  let minIdx = 0;

  for (let i = 0; i < index.length; i++) {
    const { entry, haystack } = index[i];

    // Count matching tokens
    let matched = 0;
    for (let t = 0; t < tokens.length; t++) {
      if (haystack.includes(tokens[t])) matched++;
    }

    if (matched === 0) continue;
    const score = matched * invLen;

    if (results.length < limit) {
      results.push({ ...entry, score: Math.round(score * 1000) / 1000 });
      if (results.length === limit) {
        // Find minimum for eviction
        minScore = results[0].score;
        minIdx = 0;
        for (let r = 1; r < results.length; r++) {
          if (results[r].score < minScore) { minScore = results[r].score; minIdx = r; }
        }
      }
    } else if (score > minScore) {
      results[minIdx] = { ...entry, score: Math.round(score * 1000) / 1000 };
      // Recompute min
      minScore = results[0].score;
      minIdx = 0;
      for (let r = 1; r < results.length; r++) {
        if (results[r].score < minScore) { minScore = results[r].score; minIdx = r; }
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { AI, VECTOR_INDEX } = env;

  // Rate limit: 100 req/minute per IP
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env.RATE_KV, `rl:search:${ip}`, 100, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', 'Rate limit exceeded for search endpoint. Maximum 100 requests per minute per IP address. Wait before retrying.', { retryAfter: '60', limit: rl.limit });
  }

  // Extract query params without new URL()
  const rawUrl = request.url;
  const qmark = rawUrl.indexOf('?');
  const params = new URLSearchParams(qmark === -1 ? '' : rawUrl.slice(qmark + 1));
  const query = params.get('q')?.trim();
  const limit = Math.min(Math.max(parseInt(params.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  if (!query) {
    return new Response(JSON.stringify({ error: 'Query parameter "q" is required' }), { status: 400, headers: CORS_HEADERS });
  }

  try {
    let results = [];

    // 1. Vector search
    if (AI && VECTOR_INDEX) {
      try {
        const { data: queryVector } = await AI.run('@cf/baai/bge-base-en-v1.5', { text: [query] });
        const matches = await VECTOR_INDEX.query(queryVector[0], { topK: limit, namespace: 'assets', returnMetadata: 'all' });

        for (const m of matches.matches) {
          if (m.score > VECTOR_SCORE_THRESHOLD) {
            results.push({
              name: m.metadata?.name || m.id,
              path: m.metadata?.path || '',
              project: m.metadata?.project || '',
              category: m.metadata?.category || '',
              format: m.metadata?.format || '',
              size: m.metadata?.size || 0,
              score: Math.round(m.score * 1000) / 1000,
            });
          }
        }
      } catch {}
    }

    // 2. Fuzzy fallback
    if (results.length === 0) {
      const manifest = await getManifest(env, rawUrl);
      const index = getSearchIndex(manifest);
      results = fuzzySearch(index, query, limit);
    }

    return new Response(JSON.stringify({ results, query, count: results.length }), { headers: CORS_HEADERS });
  } catch {
    return new Response(JSON.stringify({ error: 'Search failed. Please try again.' }), { status: 500, headers: CORS_HEADERS });
  }
}
