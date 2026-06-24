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

import { legacyErrorJson, checkRateLimit, authenticateAny, headFromGet } from './_shared.js';
import { hasAccountsDB, getCurrentSession } from './auth/_lib.js';
import { matchedBotUa, isAllowedReferer } from './transform.js';

// Mirror of /api/transform's per-IP rate limit tiers — same attack
// surface (public delivery endpoint, can be hammered with arbitrary
// path values to evade cache).
const PER_IP_MIN  = 60;
const PER_IP_HOUR = 1000;
const PER_IP_DAY  = 5000;

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

/**
 * Map a user-facing path to the deploy-internal asset URL.
 *
 * Subrequests issued by a Pages Function bypass the middleware chain, so
 * the path rewrites that work on first-hop requests (e.g. /foo/bar.svg →
 * /clients/foo/bar.svg) do NOT apply when this handler calls fetch on
 * its own. We replicate the routing here against the canonical paths:
 *
 *   /stocks/<path>   → /stocks/<path>   (stocks pillar — direct)
 *   /shared/<path>   → /cdn/shared/<path>
 *   anything else    → /clients/<path>  (clients pillar — default)
 *
 * Geo (/global/*) is intentionally not handled — /api/auto doesn't
 * expose geo paths today, and adding it would require Cloudflare cf.continent
 * resolution that doesn't belong in this hot path.
 */
function resolveAssetPath(userPath) {
  if (userPath.startsWith('/stocks/')) return userPath;
  if (userPath.startsWith('/shared/')) return '/cdn' + userPath;
  return '/clients' + userPath;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  // --- Layer 0: authentication required ---
  // Same gate as /api/transform (PR #107). Public pages now use the
  // pre-rendered /stocks/.../-{320,640,1200,1920}.webp variants and
  // never need /api/auto. The only documented callers are programmatic
  // (stratos CLI, server-side asset pipelines), all of which can send
  // AccountKey or sign in via cdn_session.
  let authed = await authenticateAny(context.request, context.env);
  if (!authed && hasAccountsDB(context.env)) {
    const session = await getCurrentSession(context.env, context.request);
    authed = !!session;
  }
  if (!authed) {
    return legacyErrorJson(401, 'unauthenticated', {
      extra: { message: 'Sign in (cdn_session cookie) or supply an AccountKey/AccessKey header. For public pages, use the pre-generated /stocks/.../-{320,640,1200,1920}.webp variants instead.' },
    });
  }

  // --- Layer 1: AI-crawler User-Agent blocklist ---
  const ua = context.request.headers?.get?.('user-agent') || '';
  const botMatch = matchedBotUa(ua);
  if (botMatch) {
    return legacyErrorJson(403, 'bot_blocked', {
      extra: { message: `User-Agent "${botMatch}" is blocked from this endpoint.` },
    });
  }

  // --- Layer 2: Referer hotlink check ---
  const referer = context.request.headers?.get?.('referer') || '';
  if (!isAllowedReferer(referer)) {
    return legacyErrorJson(403, 'hotlink_blocked', {
      extra: { message: 'Off-domain hotlinking of /api/auto is not allowed.' },
    });
  }

  // --- Layer 3: multi-tier per-IP rate limit ---
  const ip = context.request.headers?.get?.('cf-connecting-ip') || 'unknown';
  const tiers = [
    { key: `rl:auto:m:${ip}`, limit: PER_IP_MIN,  window: 60,    label: 'minute' },
    { key: `rl:auto:h:${ip}`, limit: PER_IP_HOUR, window: 3600,  label: 'hour'   },
    { key: `rl:auto:d:${ip}`, limit: PER_IP_DAY,  window: 86400, label: 'day'    },
  ];
  for (const t of tiers) {
    const rl = await checkRateLimit(context.env, t.key, t.limit, t.window);
    if (!rl.allowed) {
      return legacyErrorJson(429, `rate_limit_exceeded_${t.label}`, {
        extra: { message: `Too many /api/auto requests from this IP. Limit: ${t.limit}/${t.label}.` },
        retryAfter: t.window,
      });
    }
  }

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
  const basePath = resolveAssetPath(path);
  for (let i = 0; i < chain.length; i++) {
    const { ext, mime } = chain[i];
    const assetUrl = new URL(`${basePath}.${ext}`, url.origin).toString();

    try {
      // env.ASSETS.fetch hits the static asset binding directly and skips
      // the workers chain — exactly the right shape for a subrequest that
      // wants the deployed file by its canonical path. Tests that hand-roll
      // a ctx without env still work via the global fetch fallback.
      const fetcher = context.env?.ASSETS?.fetch ?? fetch;
      const response = await fetcher(assetUrl);

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

export const onRequestHead = headFromGet(onRequestGet);

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400' },
  });
}
