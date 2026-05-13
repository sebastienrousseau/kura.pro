/**
 * Automatic format negotiation endpoint.
 *
 * GET /api/auto?path=/bankingonai/images/logos/logo
 * GET /api/auto/bankingonai/images/logos/logo
 *
 * Reads the Accept header to serve the best image format,
 * with fallback chain: avif → webp → png → svg.
 */

import { legacyErrorJson } from './_shared.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const FORMAT_CHAIN = [
  { ext: 'jxl', mime: 'image/jxl' },
  { ext: 'avif', mime: 'image/avif' },
  { ext: 'webp', mime: 'image/webp' },
  { ext: 'png', mime: 'image/png' },
  { ext: 'svg', mime: 'image/svg+xml' },
];

// Connection types we treat as "slow"; matches transform.js's SLOW_ECT.
const SLOW_ECT = new Set(['slow-2g', '2g', '3g']);

/**
 * Determine the preferred format index based on the Accept header.
 * Priority: JXL > AVIF > WebP > PNG > SVG
 */
function preferredStartIndex(accept) {
  if (accept.includes('image/jxl')) return 0;
  if (accept.includes('image/avif')) return 1;
  if (accept.includes('image/webp')) return 2;
  return 3; // start at png
}

/**
 * Detect a low-bandwidth client signal. Mirrors transform.js for consistency
 * but kept here as a separate function so auto.js stays self-contained.
 */
function isLowBandwidth(request) {
  const h = request?.headers;
  /* v8 ignore next -- callers always pass a Request-shaped object */
  if (!h || typeof h.get !== 'function') return false;
  if ((h.get('save-data') || '').toLowerCase() === 'on') return true;
  const ect = h.get('sec-ch-effective-connection-type');
  if (ect && SLOW_ECT.has(ect.toLowerCase())) return true;
  return false;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  // Support both query param and path-based routing
  // Path format: /api/auto/some/path → context.params or URL parsing
  let path = url.searchParams.get('path');

  if (!path) {
    // Try path-based: strip /api/auto prefix
    const pathname = url.pathname;
    const prefix = '/api/auto/';
    if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
      path = '/' + pathname.slice(prefix.length);
    }
  }

  if (!path) {
    return legacyErrorJson(400, 'Missing required parameter: path');
  }

  // Path validation (SSRF / traversal protection)
  if (path.includes('..') || path.includes('\0') || path.includes('//')) {
    return legacyErrorJson(400, 'Invalid path: contains disallowed sequences.');
  }

  const accept = context.request.headers.get('Accept') || '';
  let startIdx = preferredStartIndex(accept);

  // Network-aware: on slow/Save-Data clients, skip JXL and AVIF — both have
  // heavier decoders and benefit slow CPUs less than WebP's size win does.
  const networkAware = isLowBandwidth(context.request);
  if (networkAware && startIdx < 2) {
    startIdx = 2; // jump to WebP
  }

  // Try each format in the fallback chain starting from preferred
  for (let i = startIdx; i < FORMAT_CHAIN.length; i++) {
    const { ext, mime } = FORMAT_CHAIN[i];
    const assetUrl = new URL(`${path}.${ext}`, url.origin).toString();

    try {
      const response = await fetch(assetUrl);

      if (response.ok) {
        const headers = new Headers(response.headers);
        headers.set('Content-Type', mime);
        headers.set('Vary', 'Accept, Save-Data, Sec-CH-Effective-Connection-Type');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');
        if (networkAware) headers.set('X-Network-Aware', 'slow');

        return new Response(response.body, {
          status: 200,
          headers,
        });
      }
      // 404 or other error — try next format
    } catch {
      // fetch failed — try next format
    }
  }

  return legacyErrorJson(404, 'No suitable format found for the given path');
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' },
  });
}
