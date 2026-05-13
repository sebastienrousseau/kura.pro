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
//
// Two backends, picked at runtime:
//
//   1. Durable Object (preferred) — atomic increment-if-below via
//      blockConcurrencyWhile. Bind a `RATE_LIMITER` DO namespace
//      (see functions/api/rate_limiter_do.js) to get this path.
//
//   2. KV fallback — read-then-write, NOT atomic. Under burst concurrency
//      bursts can exceed the limit by a small multiple. Kept as the default
//      so existing deployments continue to work without a DO migration.
//
// Both backends return the same shape: { allowed, limit, remaining, resetAt? }.
//
// Callers may pass either an env object (preferred — enables DO detection) or
// a bare KV namespace (legacy signature, retained for backwards compatibility
// in tests). The helper sniffs the shape and dispatches accordingly.

function looksLikeKv(x) {
  return !!x && typeof x.get === 'function' && typeof x.put === 'function';
}

export async function checkRateLimit(envOrKv, key, limit, windowSeconds) {
  // Permissive when nothing is wired up — keeps local dev painless.
  if (!envOrKv) return { allowed: true };

  // Legacy signature: caller passed a KV namespace directly.
  if (looksLikeKv(envOrKv)) {
    return checkRateLimitKv(envOrKv, key, limit, windowSeconds);
  }

  // Modern signature: caller passed env. Prefer the DO when available.
  if (envOrKv.RATE_LIMITER && typeof envOrKv.RATE_LIMITER.idFromName === 'function') {
    try {
      const id = envOrKv.RATE_LIMITER.idFromName(key);
      const stub = envOrKv.RATE_LIMITER.get(id);
      const res = await stub.fetch('https://rate-limiter.internal/increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit, windowSeconds }),
      });
      if (res.ok) return await res.json();
      // Fall through to KV if the DO call returned a non-2xx — degraded but safe.
    } catch { /* DO unavailable — fall through */ }
  }

  return checkRateLimitKv(envOrKv.RATE_KV, key, limit, windowSeconds);
}

// ── Audit log ──
//
// Persistent append-only trail for sensitive control-plane operations:
// token create/revoke, webhook register/remove, zone delete, purge.
// Entries land in RATE_KV under `audit:YYYY-MM-DD` keys with a 90-day TTL,
// then can be read by GET /api/core/audit-logs (AccountKey gated).
//
// The append is bounded — at most 5,000 entries per day, oldest dropped
// first — so the value at a single key cannot grow unboundedly. KV's
// per-value cap is 25 MiB which gives us roughly that headroom anyway.
//
// Write-side is best-effort: KV failures swallow silently because we do
// NOT want to fail the user's mutation just because the audit trail is
// briefly unavailable. The user-facing operation has already succeeded
// by the time we get here.

const AUDIT_KEY_PREFIX = 'audit:';
const AUDIT_MAX_PER_DAY = 5000;
const AUDIT_TTL_SECONDS = 86400 * 90; // 90 days

/**
 * Append a new audit-log entry to today's bucket.
 *
 * @param {object} env     Worker env containing RATE_KV
 * @param {Request} request Original request (used to extract IP + UA)
 * @param {string} action   One of: token.create, token.revoke,
 *                          webhook.create, webhook.delete, zone.create,
 *                          zone.delete, purge.execute, etc.
 * @param {object} meta     Operation-specific metadata. Do NOT pass secrets.
 */
export async function appendAuditLog(env, request, action, meta = {}) {
  const kv = env?.RATE_KV;
  if (!kv) return;
  const date = new Date().toISOString().slice(0, 10);
  const key = AUDIT_KEY_PREFIX + date;
  try {
    const raw = await kv.get(key);
    const entries = raw ? JSON.parse(raw) : [];
    entries.push({
      timestamp: new Date().toISOString(),
      action,
      ip: request?.headers?.get('cf-connecting-ip') || 'unknown',
      userAgent: (request?.headers?.get('user-agent') || '').slice(0, 256),
      requestId: env.data?.trace?.traceId || null,
      meta,
    });
    if (entries.length > AUDIT_MAX_PER_DAY) {
      entries.splice(0, entries.length - AUDIT_MAX_PER_DAY);
    }
    await kv.put(key, JSON.stringify(entries), { expirationTtl: AUDIT_TTL_SECONDS });
  } catch { /* audit is best-effort */ }
}

/**
 * Read audit-log entries from the most recent N days, newest first.
 * Returns a flat array; the caller is expected to gate with AccountKey
 * before calling this.
 */
export async function queryAuditLog(env, { days = 7, action = null, limit = 500 } = {}) {
  const kv = env?.RATE_KV;
  if (!kv) return [];
  const cappedDays = Math.min(Math.max(parseInt(days, 10) || 1, 1), 90);
  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 5000);
  const out = [];
  for (let i = 0; i < cappedDays; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = AUDIT_KEY_PREFIX + d.toISOString().slice(0, 10);
    let raw;
    try { raw = await kv.get(key); } catch { continue; }
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    for (const entry of parsed) out.push(entry);
  }
  out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  if (action) {
    return out.filter((e) => e.action === action).slice(0, cappedLimit);
  }
  return out.slice(0, cappedLimit);
}

async function checkRateLimitKv(kv, key, limit, windowSeconds) {
  if (!kv) return { allowed: true };
  const count = parseInt(await kv.get(key) || '0', 10);
  if (count >= limit) return { allowed: false, limit, remaining: 0 };
  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, limit, remaining: limit - count - 1 };
}

// ── Workers AI quota guard ──
// Workers AI free tier ≈ 10k neurons/day. When exhausted, calls throw 429-style
// errors. We track usage in KV per UTC day and trip a short-lived circuit
// breaker so downstream requests can switch to a degraded path immediately
// without re-issuing failing AI calls.
//
// Approximated per-call costs (neurons). Real costs vary by token count;
// these are conservative averages chosen to avoid under-counting bursts.
export const AI_COST = {
  embed_bge_base: 0.05,
  llama_8b_fast: 6,
};

const AI_DAILY_BUDGET_DEFAULT = 9000;
const AI_CB_TTL_SEC_DEFAULT = 60;

function aiBudgetKeys() {
  const d = new Date();
  const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { usageKey: `ai:neurons:${day}`, breakerKey: 'ai:cb:open' };
}

function aiBudgetCapacity(env) {
  const raw = env?.AI_DAILY_BUDGET;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : AI_DAILY_BUDGET_DEFAULT;
}

function aiBudgetBreakerTtl(env) {
  const raw = env?.AI_CB_TTL_SEC;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : AI_CB_TTL_SEC_DEFAULT;
}

/**
 * Returns current quota state without mutating it.
 * Cheap enough to call on every AI-dependent request.
 */
export async function aiBudgetState(env) {
  const kv = env?.RATE_KV;
  const capacity = aiBudgetCapacity(env);
  if (!kv) return { used: 0, capacity, circuitOpen: false, exhausted: false };
  const { usageKey, breakerKey } = aiBudgetKeys();
  let used = 0;
  let circuitOpen = false;
  try {
    const [u, b] = await Promise.all([kv.get(usageKey), kv.get(breakerKey)]);
    used = parseFloat(u) || 0;
    circuitOpen = b === '1';
  } catch { /* KV transient — treat as available */ }
  return { used, capacity, circuitOpen, exhausted: circuitOpen || used >= capacity };
}

/**
 * Charge neurons against today's budget. Non-blocking semantics — callers should
 * await but ignore failures; KV write errors must not fail the user request.
 */
export async function aiBudgetCharge(env, neurons) {
  const kv = env?.RATE_KV;
  if (!kv || !(neurons > 0)) return;
  const { usageKey } = aiBudgetKeys();
  try {
    const prior = parseFloat(await kv.get(usageKey)) || 0;
    // 2-day TTL handles cross-day requests in flight at midnight UTC.
    await kv.put(usageKey, String(prior + neurons), { expirationTtl: 86400 * 2 });
  } catch { /* swallow */ }
}

/**
 * Open the circuit so subsequent requests in the next window skip the AI
 * call entirely. Called when a request observes a quota error directly.
 */
export async function aiBudgetTrip(env, reason = 'quota') {
  const kv = env?.RATE_KV;
  if (!kv) return;
  const { breakerKey } = aiBudgetKeys();
  try {
    await kv.put(breakerKey, '1', { expirationTtl: aiBudgetBreakerTtl(env) });
  } catch { /* swallow */ }
  log.warn('ai_circuit_open', 'Workers AI circuit breaker tripped', { reason });
}

/**
 * Heuristically detect Workers AI quota / capacity errors so we can trip the
 * breaker on them specifically rather than on every transient failure.
 *
 * Workers AI surfaces quota issues through several shapes: thrown Errors with
 * status 429, AiError instances with codes 3040/7006/9001, or messages
 * containing "capacity", "quota", "rate", or "too many".
 */
export function isAiQuotaError(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? err.code;
  if (status === 429 || status === '429') return true;
  if (status === 3040 || status === 7006 || status === 9001) return true;
  const msg = String(err.message || err).toLowerCase();
  return msg.includes('quota')
    || msg.includes('capacity')
    || msg.includes('too many')
    || msg.includes('rate limit')
    || msg.includes('exceeded');
}

// ── Response cache (Workers Cache API) ──
// Cheap edge-local cache for idempotent AI/search responses. Keyed by a
// caller-supplied path under a synthetic origin so it never collides with
// the public CDN cache. Day-rotated key path so curated knowledge changes
// take effect within 24h without manual purge.

const CACHE_ORIGIN = 'https://cache.cloudcdn.internal';

export function normalizeQuery(s) {
  if (!s) return '';
  // Lowercase, replace any non-alphanumeric run with a single space, trim.
  let out = '';
  let lastSpace = true;
  const lower = String(s).toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    const isAlnum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
    if (isAlnum) {
      out += lower[i];
      lastSpace = false;
    } else if (!lastSpace) {
      out += ' ';
      lastSpace = true;
    }
  }
  return out.trim();
}

export async function hashString(s) {
  const buf = await crypto.subtle.digest('SHA-256', ENCODER.encode(s));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += HEX[bytes[i]];
  return hex;
}

function dayBucket() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function buildCacheKey(namespace, hash) {
  return `${CACHE_ORIGIN}/${namespace}/${dayBucket()}/${hash}`;
}

/**
 * Read a previously cached JSON response. Returns null on miss or when the
 * Cache API isn't bound (workerd test runner).
 */
export async function cacheGet(cacheKey) {
  const cache = globalThis.caches?.default;
  if (!cache) return null;
  try {
    const res = await cache.match(new Request(cacheKey));
    if (!res) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Persist a JSON payload under cacheKey with a short TTL.
 * `ttlSec` is advisory — Cache API honours it via max-age.
 */
export async function cacheSet(cacheKey, payload, ttlSec) {
  const cache = globalThis.caches?.default;
  if (!cache) return;
  try {
    const res = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${Math.max(1, ttlSec | 0)}`,
      },
    });
    await cache.put(new Request(cacheKey), res);
  } catch { /* cache write failures are non-fatal */ }
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

// ── Workers Analytics Engine emitter ──
//
// recordMetric() writes a single data point to a Cloudflare Workers
// Analytics Engine (WAE) dataset, if bound. WAE is the right place for
// high-cardinality per-request signals (endpoint × status × region ×
// region × AI cost) — it's cheap, indexed, queryable via SQL, and won't
// rate-limit a hot request path.
//
// The binding (env.METRICS) is optional. When it's absent — which is the
// case in tests and local dev — this function is a no-op. That keeps the
// hot path zero-overhead and means no caller has to gate on env shape.
//
// WAE schema (12 indexes max, ~20 blobs max, 1 double):
//   blobs:    [endpoint, status, source(ai|cached|curated|fuzzy), trace]
//   doubles:  [durationMs]
//   indexes:  [endpoint]   — high-cardinality index for filtering
export function recordMetric(env, { endpoint, status, source, durationMs, traceId }) {
  const wae = env?.METRICS;
  if (!wae || typeof wae.writeDataPoint !== 'function') return;
  try {
    wae.writeDataPoint({
      blobs: [
        String(endpoint || 'unknown'),
        String(status ?? 0),
        String(source || ''),
        String(traceId || ''),
      ],
      doubles: [Number.isFinite(durationMs) ? durationMs : 0],
      indexes: [String(endpoint || 'unknown')],
    });
  } catch { /* WAE write failures must never affect the user response */ }
}

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
