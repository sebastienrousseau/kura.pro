#!/usr/bin/env node
/**
 * transform-image.mjs — build an on-the-fly image transform URL.
 *
 * `/api/transform` is the resize/format/blur/sharpen endpoint. It returns
 * the transformed image bytes directly; we only need the URL most of the
 * time (you bake it into an `<img src>` and let the browser fetch it).
 *
 * This example builds the URL locally and then sends a HEAD-equivalent
 * GET so you can see the status the edge would return.
 *
 * Usage:
 *   node examples/transform-image.mjs /akande/v1/logos/logo.svg
 */

import { BASE_URL, get } from '../lib/api-client.js';

const asset = process.argv[2] || '/akande/v1/logos/akande.svg';

// 1. Construct the URL — agents can return this without ever fetching.
const url = new URL('/api/transform', BASE_URL);
url.searchParams.set('url', asset);
url.searchParams.set('w', '400');
url.searchParams.set('format', 'webp');
url.searchParams.set('q', '80');

console.log('Transform URL:', url.toString());

// 2. Verify it resolves at the edge.
const { ok, status } = await get('/api/transform', {
  params: { url: asset, w: 400, format: 'webp', q: 80 },
});

console.log(`Edge responded HTTP ${status} (ok=${ok})`);
