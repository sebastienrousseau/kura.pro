import { legacyErrorJson, checkRateLimit, authenticateAny } from './_shared.js';
import { hasAccountsDB, getCurrentSession } from './auth/_lib.js';
import { addUsageIfBelow } from './usage_meter_do.js';

const MONTHLY_LIMIT = 50000;

// Per-IP rate limits for /api/transform. The monthly cap above is
// GLOBAL — a single bot can burn the entire 50k/month allowance in
// minutes (confirmed 2026-06-23: 6+ GB in 15 minutes from one US IP).
//
// Three tiers stop different attack shapes:
//   - PER_IP_MIN (60/min)  — burst attacks (today's pattern)
//   - PER_IP_HOUR (1k/hr)  — sustained at-the-cap (bot pacing 60/min)
//   - PER_IP_DAY (5k/day)  — very-slow-drip (bot pacing 200/hr)
//
// A normal browser loading a page fires 5-15 transforms; even
// aggressive eager-preloads stay under 20/min. The minute cap is the
// hot path; the hour + day tiers catch adaptive bots that pace just
// below the per-minute cap.
const PER_IP_MIN  = 60;
const PER_IP_HOUR = 1000;
const PER_IP_DAY  = 5000;

// Allowed Referer hostnames. Empty Referer is ALSO allowed
// (no-referrer-policy clients, direct API users) — see isAllowedReferer.
// Hotlink Protection at the WAF level (enabled in Cloudflare dashboard)
// provides the primary defence; this code-level check is belt-and-braces
// in case the WAF rule is accidentally disabled.
const REFERER_ALLOWED_HOSTS = new Set([
  'cloudcdn.pro',
]);
const REFERER_ALLOWED_SUFFIXES = [
  '.cloudcdn.pro',  // multi-tenant subdomains
];

// Returns true when the Referer header is missing OR matches an allowed
// host. Returns false only for explicit external Referers.
// Exported for unit tests.
export function isAllowedReferer(refererHeader) {
  if (!refererHeader) return true; // no-referrer-policy / API clients
  let host;
  try { host = new URL(refererHeader).hostname.toLowerCase(); }
  catch { return false; } // malformed Referer — block as a precaution
  if (REFERER_ALLOWED_HOSTS.has(host)) return true;
  for (const suffix of REFERER_ALLOWED_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

// Known AI-training + scraper bot User-Agent substrings. Match is
// case-insensitive, substring (matches "Mozilla/5.0 (compatible;
// GPTBot/1.2)" etc.). Maintained list — see also
// https://darkvisitors.com for a fuller registry.
const BOT_UA_BLOCKLIST = [
  'gptbot', 'chatgpt-user', 'oai-searchbot',     // OpenAI
  'claudebot', 'anthropic-ai', 'claude-web',     // Anthropic
  'perplexitybot', 'perplexity-user',            // Perplexity
  'google-extended', 'googleother',              // Google AI training (NOT Googlebot)
  'bytespider', 'bytedance',                     // ByteDance / TikTok
  'ccbot',                                       // Common Crawl
  'meta-externalagent', 'facebookbot',           // Meta AI
  'cohere-ai', 'cohere-training-data-crawler',   // Cohere
  'youbot',                                      // You.com
  'amazonbot', 'applebot-extended',              // Amazon, Apple AI training
  'mistralai-user',                              // Mistral
  'omgili', 'omgilibot',                         // Webz.io
  'diffbot',                                     // Diffbot
  'magpie-crawler',                              // Brandwatch
  'panscient.com',                               // PanScient
];

// Returns the blocklist substring matched, or null if none.
export function matchedBotUa(uaHeader) {
  if (!uaHeader) return null;
  const ua = uaHeader.toLowerCase();
  for (const needle of BOT_UA_BLOCKLIST) {
    if (ua.includes(needle)) return needle;
  }
  return null;
}

const VALID_FIT = new Set(['cover', 'contain', 'fill', 'inside', 'outside']);
const VALID_FORMAT = new Set(['auto', 'webp', 'avif', 'png', 'jpeg']);
const VALID_GRAVITY = new Set([
  'center', 'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest',
  'face', 'auto',
]);

// Connection types that mean "go easy on this client". Anything in this set
// triggers Save-Data-style defaults (lower quality, lighter format).
const SLOW_ECT = new Set(['slow-2g', '2g', '3g']);

// Quality ceiling applied when network-aware downgrade kicks in.
const LOW_NETWORK_QUALITY_CEILING = 60;

function clamp(val, min, max) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < min || n > max) return undefined;
  return n;
}

/**
 * Detect whether the client has signalled it's on a slow or metered network.
 *
 * Reads three signals, in priority order:
 *   1. Save-Data: on — explicit user preference for reduced data.
 *   2. Sec-CH-Effective-Connection-Type — Chrome's client hint for ECT.
 *   3. CF-Worker connection.effective_type — Cloudflare's edge measurement.
 *
 * Returns true if any indicates the client should get lighter assets.
 */
export function isLowBandwidthClient(request) {
  const headers = request?.headers;
  if (headers && typeof headers.get === 'function') {
    if ((headers.get('save-data') || '').toLowerCase() === 'on') return true;
    const ect = headers.get('sec-ch-effective-connection-type');
    if (ect && SLOW_ECT.has(ect.toLowerCase())) return true;
  }
  // Cloudflare also surfaces an `ect` field on the cf object when available.
  const cfEct = request?.cf?.clientAcceptEncoding && request?.cf?.connectionType;
  if (cfEct && SLOW_ECT.has(String(request.cf.connectionType).toLowerCase())) return true;
  return false;
}

/**
 * Mutate the imageOpts in place to apply network-aware defaults when the
 * client has signalled a slow or metered connection. Pure server-side
 * preference — caller-supplied values for quality/format always win.
 *
 * @returns true when defaults were applied (so we can stamp the right Vary
 * headers on the response).
 */
function applyNetworkAwareDefaults(request, imageOpts, explicitFormatProvided) {
  if (!isLowBandwidthClient(request)) return false;

  // Clamp quality to the slow-network ceiling. If the caller asked for less,
  // honour that — we never want to UP-quality against an explicit q=.
  if (imageOpts.quality === undefined || imageOpts.quality > LOW_NETWORK_QUALITY_CEILING) {
    imageOpts.quality = LOW_NETWORK_QUALITY_CEILING;
  }

  // Prefer WebP over AVIF on slow connections (cheaper to decode, slightly
  // larger but in the noise once we've capped quality). Only set when the
  // caller didn't pin a format explicitly.
  if (!explicitFormatProvided) {
    imageOpts.format = 'webp';
  }
  return true;
}

export async function onRequestGet(context) {
  const { USAGE_METER } = context.env;
  const url = new URL(context.request.url);
  const params = url.searchParams;

  // --- Layer 0: authentication required ---
  //
  // /api/transform is no longer a public endpoint. Two ways to
  // authenticate:
  //   1. cdn_session cookie — set by /api/auth/* (passkey, OAuth,
  //      email+password). Browser users signed into cloudcdn.pro
  //      (including the dashboard) get this for free.
  //   2. AccountKey or AccessKey header — programmatic API users
  //      using the documented client libraries.
  //
  // Public pages no longer reference /api/transform programmatically
  // (PR #105 + #106 shipped pre-rendered responsive variants under
  // /stocks/images/ and /clients/**/banners/ for all viewport-sized
  // images). The only remaining caller is the dashboard's Transform
  // Playground, which already runs behind a session.
  //
  // Behaviour:
  //   - With cdn_session cookie OR AccountKey/AccessKey: proceed.
  //   - Without either: 401 unauthenticated.
  //
  // This kills the entire bot-attack class for /api/transform: a
  // crawler with no session + no API key gets 401 in ~50µs (one D1
  // cookie lookup if cookie present, zero work if absent).
  let authed = await authenticateAny(context.request, context.env);
  if (!authed && hasAccountsDB(context.env)) {
    const session = await getCurrentSession(context.env, context.request);
    authed = !!session;
  }
  if (!authed) {
    return legacyErrorJson(401, 'unauthenticated', {
      extra: { message: 'Sign in (cdn_session cookie) or supply an AccountKey/AccessKey header. Public pages should use the pre-generated /stocks/.../-{320,640,1200,1920}.webp variants instead — see /api-reference/.' },
    });
  }

  // --- Layer 1: known AI-training/scraper bot blocklist ---
  //
  // These crawlers have NO legitimate need for image transformations
  // (they want raw assets for training, not resized versions). Block
  // them BEFORE counting toward the monthly cap so they can't burn
  // the global allowance by spinning prefix-only requests.
  const ua = context.request.headers?.get?.('user-agent') || '';
  const botMatch = matchedBotUa(ua);
  if (botMatch) {
    return legacyErrorJson(403, 'bot_blocked', {
      extra: { message: `User-Agent "${botMatch}" is blocked from this endpoint. Image transformations are for human-facing CDN traffic.` },
    });
  }

  // --- Layer 2: code-level Referer check (defence-in-depth) ---
  //
  // Cloudflare's Hotlink Protection (enabled at the WAF layer
  // 2026-06-23) is the primary defence against off-domain hotlinks;
  // this is the belt-and-braces version that runs even if Hotlink
  // Protection is accidentally disabled. Allow:
  //   - Empty Referer (no-referrer-policy clients, direct API)
  //   - cloudcdn.pro + *.cloudcdn.pro
  // Block any explicit external Referer.
  const referer = context.request.headers?.get?.('referer') || '';
  if (!isAllowedReferer(referer)) {
    return legacyErrorJson(403, 'hotlink_blocked', {
      extra: { message: 'Off-domain hotlinking of /api/transform is not allowed.' },
    });
  }

  // --- Layer 3: multi-tier per-IP rate limit ---
  //
  // Three sequential checks stop three attack shapes:
  //   60/min  — bursts (today's pattern, ~10k/min from 1 IP)
  //   1k/hr   — sustained-at-cap (60/min × 60 min = 3600/hr, blocked)
  //   5k/day  — slow drip (200/hr would sneak past 1k/hr but caps at 5k/day)
  // All checks route through checkRateLimit (DO-preferred, KV-fallback),
  // atomic + free of KV write quota.
  const ip = context.request.headers?.get?.('cf-connecting-ip') || 'unknown';
  const tiers = [
    { key: `rl:transform:m:${ip}`, limit: PER_IP_MIN,  window: 60,    label: 'minute' },
    { key: `rl:transform:h:${ip}`, limit: PER_IP_HOUR, window: 3600,  label: 'hour'   },
    { key: `rl:transform:d:${ip}`, limit: PER_IP_DAY,  window: 86400, label: 'day'    },
  ];
  for (const t of tiers) {
    const rl = await checkRateLimit(context.env, t.key, t.limit, t.window);
    if (!rl.allowed) {
      return legacyErrorJson(429, `rate_limit_exceeded_${t.label}`, {
        extra: { message: `Too many transform requests from this IP. Limit: ${t.limit}/${t.label}.` },
        retryAfter: t.window,
      });
    }
  }

  // --- Layer 4: atomic monthly soft limit via UsageMeterDO ---
  //
  // Previously hand-rolled `RATE_KV.get → check → put` (banned
  // ADR-11 pattern; 50,000 writes/month would exhaust the
  // 1000/day Free-tier KV write quota in under 30 minutes on a
  // hot zone). addIfBelow does the check-and-increment in one
  // atomic RPC hop with zero KV writes.
  //
  // Degrades open when USAGE_METER isn't bound (local dev).
  if (USAGE_METER) {
    const result = await addUsageIfBelow(context.env, 'global-transform', 1, MONTHLY_LIMIT);
    if (result && !result.accepted) {
      return legacyErrorJson(429, 'limit_reached', {
        extra: { message: 'Monthly transform limit reached.' },
        limit: MONTHLY_LIMIT,
        retryAfter: 86400,
      });
    }
  }

  // --- Validate required param ---
  const assetUrl = params.get('url');
  if (!assetUrl) {
    return legacyErrorJson(400, 'Missing required parameter: url');
  }

  // --- Build image options ---
  const imageOpts = {};

  const w = params.get('w');
  if (w !== null) {
    const val = clamp(w, 1, 8192);
    if (val === undefined) {
      return legacyErrorJson(400, 'Invalid parameter: w must be 1-8192');
    }
    imageOpts.width = val;
  }

  const h = params.get('h');
  if (h !== null) {
    const val = clamp(h, 1, 8192);
    if (val === undefined) {
      return legacyErrorJson(400, 'Invalid parameter: h must be 1-8192');
    }
    imageOpts.height = val;
  }

  const fit = params.get('fit');
  if (fit !== null) {
    if (!VALID_FIT.has(fit)) {
      return legacyErrorJson(400, `Invalid parameter: fit must be one of ${[...VALID_FIT].join(', ')}`);
    }
    imageOpts.fit = fit;
  }

  const format = params.get('format');
  const explicitFormatProvided = format !== null && format !== 'auto';
  if (format !== null && format !== 'auto') {
    if (!VALID_FORMAT.has(format)) {
      return legacyErrorJson(400, `Invalid parameter: format must be one of ${[...VALID_FORMAT].join(', ')}`);
    }
    imageOpts.format = format;
  }
  // format=auto: omit format to let Cloudflare negotiate via Accept header

  const q = params.get('q');
  if (q !== null) {
    const val = clamp(q, 1, 100);
    if (val === undefined) {
      return legacyErrorJson(400, 'Invalid parameter: q must be 1-100');
    }
    imageOpts.quality = val;
  }

  const blur = params.get('blur');
  if (blur !== null) {
    const val = clamp(blur, 1, 250);
    if (val === undefined) {
      return legacyErrorJson(400, 'Invalid parameter: blur must be 1-250');
    }
    imageOpts.blur = val;
  }

  const sharpen = params.get('sharpen');
  if (sharpen !== null) {
    const val = clamp(sharpen, 1, 10);
    if (val === undefined) {
      return legacyErrorJson(400, 'Invalid parameter: sharpen must be 1-10');
    }
    imageOpts.sharpen = val;
  }

  const gravity = params.get('gravity');
  if (gravity !== null) {
    if (!VALID_GRAVITY.has(gravity)) {
      return legacyErrorJson(400, `Invalid parameter: gravity must be one of ${[...VALID_GRAVITY].join(', ')}`);
    }
    imageOpts.gravity = gravity;
  }

  // --- Network-aware defaults ---
  // When Save-Data or a slow ECT is signalled, clamp quality and prefer
  // WebP over AVIF unless the caller pinned format/quality explicitly.
  const networkAware = applyNetworkAwareDefaults(context.request, imageOpts, explicitFormatProvided);

  // --- Resolve origin URL (SSRF protection: reject absolute URLs) ---
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    return legacyErrorJson(400, 'Absolute URLs are not allowed. Use a relative path (e.g., /project/v1/logos/logo.webp).');
  }
  if (assetUrl.includes('..') || assetUrl.includes('\0') || assetUrl.includes('//')) {
    return legacyErrorJson(400, 'Invalid path: contains disallowed sequences.');
  }
  const originUrl = new URL(assetUrl, url.origin).toString();

  // --- Fetch with Cloudflare Image Resizing ---
  try {
    const response = await fetch(originUrl, {
      cf: { image: imageOpts },
    });

    if (!response.ok) {
      const proxyStatus = response.status >= 400 && response.status < 500 ? 400 : 502;
      return legacyErrorJson(proxyStatus, `Upstream returned ${response.status}`);
    }

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    // Vary on every signal we read so intermediate caches don't serve a
    // high-quality variant to a Save-Data client (or vice versa).
    headers.set('Vary', 'Accept, Save-Data, Sec-CH-Effective-Connection-Type');
    headers.set('Access-Control-Allow-Origin', '*');
    if (networkAware) {
      headers.set('X-Network-Aware', 'slow');
    }

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    return legacyErrorJson(500, 'Failed to transform image');
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}
