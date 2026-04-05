/**
 * Shared utilities — performance-critical path.
 *
 * Optimizations:
 *   - Isolate-scoped manifest cache (zero parse after first load)
 *   - Pre-allocated hex table for HMAC (no spread/map/join)
 *   - Singleton TextEncoder (no per-stream allocation)
 *   - Streaming JSON with batched writes (fewer awaits)
 */

// ── Pre-allocated lookup table for hex encoding ──
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

// ── Singleton TextEncoder ──
const ENCODER = new TextEncoder();

// ── Manifest Cache ──
let _manifestCache = null;
let _manifestCacheTime = 0;
const MANIFEST_TTL_MS = 30_000;

export async function getManifest(env, requestUrl) {
  const now = Date.now();
  if (_manifestCache && (now - _manifestCacheTime) < MANIFEST_TTL_MS) {
    return _manifestCache;
  }
  const res = await env.ASSETS.fetch(new URL('/manifest.json', requestUrl));
  _manifestCache = await res.json();
  _manifestCacheTime = now;
  return _manifestCache;
}

export function clearManifestCache() {
  _manifestCache = null;
  _manifestCacheTime = 0;
}

// ── Streaming JSON ──

export function streamJsonArray({ envelope, arrayKey, items, headers = {} }) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const envelopeCopy = { ...envelope };
  delete envelopeCopy[arrayKey];

  // Build entire envelope prefix as a single string — one write, not N writes
  const envelopeStr = JSON.stringify(envelopeCopy);
  // Transform {"Pagination":...,"Filters":...} → {"Pagination":...,"Filters":...,"Data":[
  const prefix = envelopeStr.slice(0, -1) + // remove closing }
    (envelopeStr.length > 2 ? ',' : '') + // add comma if envelope had fields
    JSON.stringify(arrayKey) + ':[';

  (async () => {
    try {
      // Single write for entire envelope prefix — TTFB < 1ms
      await writer.write(ENCODER.encode(prefix));

      // Batch items into chunks to reduce write syscalls
      const BATCH = 20;
      let buf = '';
      let count = 0;
      let first = true;

      for (const item of items) {
        if (!first) buf += ',';
        buf += JSON.stringify(item);
        first = false;
        count++;

        if (count >= BATCH) {
          await writer.write(ENCODER.encode(buf));
          buf = '';
          count = 0;
        }
      }

      // Flush remaining + close
      if (buf) await writer.write(ENCODER.encode(buf));
      await writer.write(ENCODER.encode(']}'));
    } catch {
      // Client disconnected
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    },
  });
}

// ── Constant-time comparison ──

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ── Auth ──

const SESSION_COOKIE = 'cdn_session';

export function parseCookies(header) {
  if (!header) return {};
  const cookies = {};
  let start = 0;
  while (start < header.length) {
    const eq = header.indexOf('=', start);
    if (eq === -1) break;
    const semi = header.indexOf(';', eq);
    const end = semi === -1 ? header.length : semi;
    const key = header.slice(start, eq).trim();
    if (key) cookies[key] = header.slice(eq + 1, end).trim();
    start = end + 1;
  }
  return cookies;
}

/**
 * HMAC-SHA256 verify using pre-allocated hex table.
 * Zero spread operators, zero intermediate arrays.
 */
export async function hmacVerify(secret, data, signature) {
  const key = await crypto.subtle.importKey(
    'raw', ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(data));
  const bytes = new Uint8Array(sig);

  // Pre-allocated hex lookup — no spread, no map, no join
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX[bytes[i]];
  }
  return timingSafeEqual(hex, signature);
}

/**
 * HMAC-SHA256 sign using pre-allocated hex table.
 */
export async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(data));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX[bytes[i]];
  }
  return hex;
}

// ── HMAC key cache (per-isolate) ──
let _hmacKeyCache = null;
let _hmacKeySecret = null;

async function getCachedHmacKey(secret) {
  if (_hmacKeySecret === secret && _hmacKeyCache) return _hmacKeyCache;
  _hmacKeyCache = await crypto.subtle.importKey(
    'raw', ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  _hmacKeySecret = secret;
  return _hmacKeyCache;
}

export async function hmacVerifyCached(secret, data, signature) {
  const key = await getCachedHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(data));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += HEX[bytes[i]];
  return timingSafeEqual(hex, signature);
}

export async function authenticateAccess(request, env) {
  const accessKey = request.headers.get('AccessKey');
  if (accessKey && env.STORAGE_KEY && accessKey === env.STORAGE_KEY) return true;

  const secret = env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;
  if (secret) {
    const cookies = parseCookies(request.headers.get('Cookie'));
    const session = cookies[SESSION_COOKIE];
    if (session) {
      const dot = session.lastIndexOf('.');
      if (dot > 0) {
        const token = session.slice(0, dot);
        const sig = session.slice(dot + 1);
        if (token && sig) {
          const valid = await hmacVerifyCached(secret, token, sig);
          if (valid && parseInt(token, 10) > Date.now() / 1000) return true;
        }
      }
    }
  }

  if (!env.STORAGE_KEY && !env.DASHBOARD_SECRET && !env.DASHBOARD_PASSWORD) return true;
  return false;
}

export function authenticateAccount(request, env) {
  const key = request.headers.get('AccountKey');
  if (!env.ACCOUNT_KEY) return true;
  return key === env.ACCOUNT_KEY;
}

export async function authenticateAny(request, env) {
  if (authenticateAccount(request, env)) return true;
  return authenticateAccess(request, env);
}

// ── Rate Limiting ──
// NOTE: KV read-then-write is not atomic. Under high concurrency, bursts may
// slightly exceed limits. This is acceptable for edge KV; for stricter
// enforcement, migrate to Durable Objects with atomic counters.

export async function checkRateLimit(kv, key, limit, windowSeconds) {
  if (!kv) return { allowed: true };
  const count = parseInt(await kv.get(key) || '0', 10);
  if (count >= limit) return { allowed: false, limit, remaining: 0 };
  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, limit, remaining: limit - count - 1 };
}

// ── Fetch with timeout (for external API calls) ──

export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Structured Logging ──

/**
 * Structured JSON logger for Cloudflare Logpush compatibility.
 * Outputs one JSON line per log entry to stdout/stderr.
 */
export const log = {
  _emit(level, code, message, meta = {}) {
    const entry = {
      level,
      code,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
  info(code, message, meta) { this._emit('info', code, message, meta); },
  warn(code, message, meta) { this._emit('warn', code, message, meta); },
  error(code, message, meta) { this._emit('error', code, message, meta); },
};

// ── Request Tracing ──

/**
 * Lightweight request tracing compatible with W3C Trace Context.
 * Generates trace/span IDs and measures duration for structured logging.
 */
export function createTrace(request) {
  const traceId = crypto.randomUUID().replace(/-/g, '');
  const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const startTime = Date.now();

  return {
    traceId,
    spanId,
    startTime,
    /** Create a child span for sub-operations (AI, Vectorize, GitHub API) */
    child(name) {
      const childSpanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const childStart = Date.now();
      return {
        name,
        spanId: childSpanId,
        parentSpanId: spanId,
        traceId,
        end() {
          return { name, spanId: childSpanId, parentSpanId: spanId, traceId, durationMs: Date.now() - childStart };
        },
      };
    },
    /** Finalize the root span with duration */
    end(status = 200) {
      return {
        traceId,
        spanId,
        durationMs: Date.now() - startTime,
        status,
        url: request?.url,
        method: request?.method,
      };
    },
    /** W3C traceparent header value */
    get traceparent() {
      return `00-${traceId}-${spanId}-01`;
    },
  };
}

// ── Formatting ──

export function formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

export const CORS_JSON = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// ── API Version ──
export const API_VERSION = '2026-04-01';

/**
 * Resolve the public CDN origin from the request URL.
 * Avoids hardcoding 'https://cloudcdn.pro' throughout the codebase.
 */
export function cdnOrigin(requestUrl) {
  try { return new URL(requestUrl).origin; } catch { return 'https://cloudcdn.pro'; }
}

/**
 * Extract URLSearchParams from raw URL string without new URL().
 */
export function extractParams(rawUrl) {
  const qmark = rawUrl.indexOf('?');
  return new URLSearchParams(qmark === -1 ? '' : rawUrl.slice(qmark + 1));
}

/**
 * Extract pathname from raw URL string without new URL().
 */
export function extractPathname(rawUrl) {
  const pathStart = rawUrl.indexOf('/', rawUrl.indexOf('//') + 2);
  const qmark = rawUrl.indexOf('?', pathStart);
  return qmark === -1 ? rawUrl.slice(pathStart) : rawUrl.slice(pathStart, qmark);
}

// ── Microsoft API Guidelines: Standard Error Format ──

/**
 * Build a standards-compliant error response (RFC 9457 + Microsoft guidelines).
 *
 * @param {number} status - HTTP status code
 * @param {string} code - Machine-readable error code (e.g., "InvalidParameter")
 * @param {string} message - Human-readable message (150+ chars)
 * @param {object} [options] - Optional: target, details, innererror
 * @returns {Response}
 */
export function errorResponse(status, code, message, options = {}) {
  const requestId = crypto.randomUUID();
  const body = {
    error: {
      code,
      message,
      target: options.target || null,
      details: options.details || [],
      innererror: options.innererror || null,
    },
    HttpCode: status,
    Message: message,
    requestId,
    timestamp: new Date().toISOString(),
    apiVersion: API_VERSION,
  };

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Request-ID': requestId,
    'X-API-Version': API_VERSION,
  };

  // Rate limit headers on 429
  if (status === 429) {
    headers['Retry-After'] = options.retryAfter || '60';
    headers['X-RateLimit-Limit'] = String(options.limit || 0);
    headers['X-RateLimit-Remaining'] = '0';
  }

  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Build a standards-compliant success response with tracing headers.
 */
export function jsonResponse(body, status = 200, extraHeaders = {}) {
  const requestId = crypto.randomUUID();
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-Request-ID': requestId,
      'X-API-Version': API_VERSION,
      ...extraHeaders,
    },
  });
}

/**
 * Add pagination links (Microsoft-style nextLink).
 */
export function paginationLinks(baseUrl, page, perPage, totalItems) {
  const totalPages = Math.max(Math.ceil(totalItems / perPage), 1);
  const links = {};
  if (page < totalPages) {
    const next = new URL(baseUrl);
    next.searchParams.set('page', String(page + 1));
    next.searchParams.set('per_page', String(perPage));
    links.nextLink = next.toString();
  }
  if (page > 1) {
    const prev = new URL(baseUrl);
    prev.searchParams.set('page', String(page - 1));
    prev.searchParams.set('per_page', String(perPage));
    links.prevLink = prev.toString();
  }
  return links;
}
