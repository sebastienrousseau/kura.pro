#!/usr/bin/env node
/**
 * cache-purge.mjs — purge a single URL from the edge cache.
 *
 * `/api/purge` accepts one of three shapes: `{ urls: [...] }`,
 * `{ tags: [...] }`, or `{ purge_everything: true }`. Rate-limited to
 * 100/day per account. Sends the `x-api-key` header from
 * `CLOUDCDN_PURGE_KEY`.
 *
 * Usage:
 *   export CLOUDCDN_PURGE_KEY=pk_live_...
 *   node examples/cache-purge.mjs https://cloudcdn.pro/akande/v1/logos/logo.svg
 */

import { post } from '../lib/api-client.js';

const target = process.argv[2];
if (!target) {
  console.error('Usage: cache-purge.mjs <https://cloudcdn.pro/path>');
  process.exit(1);
}

const { ok, status, data } = await post(
  '/api/purge',
  { urls: [target] },
  { auth: 'purge' }
);

if (!ok) {
  console.error(`Purge failed: HTTP ${status}`);
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(`Purged ${target}`);
console.log(JSON.stringify(data, null, 2));
