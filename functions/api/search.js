/**
 * Semantic asset search endpoint.
 *
 * GET /api/search?q=dark+blue+banking+background&limit=20
 *
 * Tries vector search (namespace: "assets") first, then falls back
 * to token-scored fuzzy matching against the asset manifest.
 */

import manifest from '../../manifest.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60',
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const VECTOR_SCORE_THRESHOLD = 0.5;

/**
 * Tokenize a string into lowercase alphanumeric tokens.
 */
function tokenize(str) {
  return str
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Score a manifest entry against a set of query tokens.
 * Matches against name, path, project, category, and format fields.
 */
function scoreEntry(entry, queryTokens) {
  const haystack = [
    entry.name,
    entry.path,
    entry.project,
    entry.category,
    entry.format,
  ]
    .join(' ')
    .toLowerCase();

  let matched = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      matched++;
    }
  }
  return queryTokens.length > 0 ? matched / queryTokens.length : 0;
}

/**
 * Fuzzy text search against the manifest.
 */
function fuzzySearch(query, limit) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return manifest
    .map((entry) => ({ ...entry, score: scoreEntry(entry, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function onRequestGet(context) {
  const { AI, VECTOR_INDEX } = context.env;
  const url = new URL(context.request.url);
  const query = url.searchParams.get('q')?.trim();
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  if (!query) {
    return Response.json(
      { error: 'Query parameter "q" is required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    // 1. Try vector search with "assets" namespace
    let results = [];

    if (AI && VECTOR_INDEX) {
      try {
        const { data: queryVector } = await AI.run(
          '@cf/baai/bge-base-en-v1.5',
          { text: [query] }
        );

        const matches = await VECTOR_INDEX.query(queryVector[0], {
          topK: limit,
          namespace: 'assets',
          returnMetadata: 'all',
        });

        results = matches.matches
          .filter((m) => m.score > VECTOR_SCORE_THRESHOLD)
          .map((m) => ({
            name: m.metadata?.name || m.id,
            path: m.metadata?.path || '',
            project: m.metadata?.project || '',
            category: m.metadata?.category || '',
            format: m.metadata?.format || '',
            size: m.metadata?.size || 0,
            score: Math.round(m.score * 1000) / 1000,
          }));
      } catch {
        // Vector search failed (e.g. no assets indexed yet) — fall through
      }
    }

    // 2. Fall back to fuzzy text matching if vector search yielded nothing
    if (results.length === 0) {
      results = fuzzySearch(query, limit);
    }

    return Response.json(
      { results, query, count: results.length },
      { headers: CORS_HEADERS }
    );
  } catch {
    return Response.json(
      { error: 'Search failed. Please try again.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
