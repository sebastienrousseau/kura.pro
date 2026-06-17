#!/usr/bin/env node
/**
 * semantic-search.mjs — natural-language asset search via the API client.
 *
 * Demonstrates calling the underlying REST endpoint directly, outside an
 * MCP context. Useful for scripts, cron jobs, or any one-shot query
 * where spinning up an MCP server would be overkill.
 *
 * The endpoint annotates every response with `mode: vector | fuzzy | cached`
 * so the caller can tell which fallback layer answered. When AI quota is
 * exhausted, `mode` becomes `fuzzy` and `degraded` flips to true — no
 * error is returned, results just degrade gracefully.
 *
 * Usage:
 *   node examples/semantic-search.mjs "dark blue banking background"
 */

import { get } from '../lib/api-client.js';

const query = process.argv[2] || 'dark blue banking background';

const { ok, status, data } = await get('/api/search', {
  params: { q: query, limit: 10 },
});

if (!ok) {
  console.error(`Search failed: HTTP ${status}`);
  process.exit(1);
}

console.log(`mode=${data.mode}  degraded=${data.degraded ?? false}`);
console.log(`Found ${data.results?.length ?? 0} matches for: ${query}\n`);
for (const r of data.results ?? []) {
  console.log(`  ${(r.score ?? 0).toFixed(3)}  ${r.path ?? r.name}`);
}
