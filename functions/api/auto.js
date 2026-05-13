/**
 * Automatic format negotiation endpoint.
 *
 * GET /api/auto?path=/bankingonai/images/logos/logo          — still image
 * GET /api/auto?path=/banner/loop&anim=1                     — animated
 * GET /api/auto/bankingonai/images/logos/logo                — path-style
 *
 * Stills chain (best → fallback):
 *   JXL → AVIF → HEIF/HEIC → WebP → PNG → SVG
 *
 * Animated chain (?anim=1):
 *   AVIF-sequence (.avifs) → WebP → APNG → GIF
 *
 * Each entry is gated by the Accept header: a format is probed only when the
 * client signals it can decode the MIME (or when the format has no Accept
 * requirement, e.g. PNG/SVG/GIF which every UA can render). This avoids
 * wasted probes for niche formats like HEIF on non-Apple clients.
 */

import { legacyErrorJson } from './_shared.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// Gating predicates per format:
//   - PNG/SVG/GIF: universal — always probed as last-resort fallbacks.
//   - WebP: probed when the client lists image/webp OR a wildcard
//     (image-star or full-wildcard), since wildcard-tolerant clients should
//     still get the bandwidth win.
//   - JXL/AVIF/HEIF/APNG/AVIFs: opt-in only — must appear explicitly in
//     Accept. Wildcards do NOT promote these (non-decoders shouldn't waste a
//     probe on a niche format they likely can't render).
const hasWildcard = (a) => a.includes('*/*') || a.includes('image/*');
const explicit = (mime) => (a) => a.includes(mime);
const universal = () => true;
const webpAccepted = (a) => a.includes('image/webp') || hasWildcard(a);

const FORMAT_CHAIN_STILL = [
  { ext: 'jxl',  mime: 'image/jxl',     accepted: explicit('image/jxl') },
  { ext: 'avif', mime: 'image/avif',    accepted: explicit('image/avif') },
  { ext: 'heic', mime: 'image/heic',    accepted: explicit('image/heic') },
  { ext: 'heif', mime: 'image/heif',    accepted: explicit('image/heif') },
  { ext: 'webp', mime: 'image/webp',    accepted: webpAccepted },
  { ext: 'png',  mime: 'image/png',     accepted: universal },
  { ext: 'svg',  mime: 'image/svg+xml', accepted: universal },
];

const FORMAT_CHAIN_ANIM = [
  { ext: 'avifs', mime: 'image/avif-sequence', accepted: explicit('image/avif') },
  { ext: 'webp',  mime: 'image/webp',          accepted: webpAccepted },
  { ext: 'apng',  mime: 'image/apng',          accepted: explicit('image/apng') },
  { ext: 'gif',   mime: 'image/gif',           accepted: universal },
];

// Connection types we treat as "slow"; matches transform.js's SLOW_ECT.
const SLOW_ECT = new Set(['slow-2g', '2g', '3g']);

/**
 * Build the format probe list for this request by evaluating each entry's
 * `accepted` predicate against the Accept header. See the predicates above
 * for the per-format gating rationale.
 */
function selectChain(accept, anim) {
  const base = anim ? FORMAT_CHAIN_ANIM : FORMAT_CHAIN_STILL;
  return base.filter(({ accepted }) => accepted(accept));
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
  const anim = url.searchParams.get('anim') === '1';
  let chain = selectChain(accept, anim);

  // Network-aware: on slow/Save-Data clients, skip JXL and AVIF — both have
  // heavier decoders and benefit slow CPUs less than WebP's size win does.
  // Animated chains don't include JXL/AVIF-still, so this only affects stills.
  const networkAware = isLowBandwidth(context.request);
  if (networkAware && !anim) {
    chain = chain.filter(({ ext }) => ext !== 'jxl' && ext !== 'avif');
  }

  // Try each format in the fallback chain starting from preferred
  for (let i = 0; i < chain.length; i++) {
    const { ext, mime } = chain[i];
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
