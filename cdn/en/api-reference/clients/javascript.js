// CloudCDN API Client — JavaScript (ES Module)
// Auto-generated from openapi.json — do not edit manually.
//
// Base URL: https://cloudcdn.pro
//
// Usage:
//   import { CloudCDNClient } from './javascript.js';
//   const client = new CloudCDNClient({ accessKey: process.env.CLOUDCDN_ACCESS_KEY });
//   const assets = await client.listAssets({ query: { project: 'akande' } });
//
// Each method returns parsed JSON for `application/json` responses,
// or the raw `Response` otherwise (binary endpoints like /api/transform).
// Errors throw `CloudCDNError` carrying `.status`, `.body`, and `.url`.

export const DEFAULT_BASE_URL = "https://cloudcdn.pro";
// Kept as a top-level export for backward compatibility with
// existing snippets that imported `BASE_URL`.
export const BASE_URL = DEFAULT_BASE_URL;

/**
 * Error thrown for any non-2xx response. Inspect `.status` to branch on
 * rate limits (429), auth failures (401/403), quota errors (503), etc.
 */
export class CloudCDNError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, body: unknown, url: string }} meta
   */
  constructor(message, { status, body, url }) {
    super(message);
    this.name = 'CloudCDNError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/** True for plain-object bodies that should be JSON-serialised. */
function _isJsonBody(body) {
  return body && typeof body === 'object'
    && !(body instanceof Blob)
    && !(body instanceof ArrayBuffer)
    && !(body instanceof Uint8Array)
    && !(body instanceof FormData)
    && !(body instanceof URLSearchParams);
}

/**
 * Production-quality client for the CloudCDN REST API.
 *
 * Configure auth keys once via the constructor; methods take only
 * the per-call inputs (path params, query, body). Every method accepts
 * `{ signal, timeoutMs }` overrides for cancellation and timeout.
 *
 * @example
 *   const client = new CloudCDNClient({
 *     accessKey: process.env.CLOUDCDN_ACCESS_KEY,
 *     accountKey: process.env.CLOUDCDN_ACCOUNT_KEY,
 *     timeoutMs: 15_000,
 *   });
 *   try {
 *     const summary = await client.getInsightsSummary({ query: { days: 30 } });
 *     console.log(summary.totalRequests);
 *   } catch (err) {
 *     if (err instanceof CloudCDNError && err.status === 429) {
 *       // back off and retry
 *     } else {
 *       throw err;
 *     }
 *   }
 */
export class CloudCDNClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl]      - Defaults to `DEFAULT_BASE_URL`.
   * @param {string} [opts.accessKey]    - Storage/Assets/Insights `AccessKey` header.
   * @param {string} [opts.accountKey]   - Core / control-plane `AccountKey` header.
   * @param {string} [opts.purgeKey]     - Cache purge `x-api-key` header.
   * @param {string} [opts.analyticsKey] - Analytics `x-api-key` header.
   * @param {string} [opts.bearerToken]  - Scoped token (`cdnsk_…`) used as `Authorization: Bearer …`.
   * @param {number} [opts.timeoutMs]    - Default per-call timeout. `0` or undefined disables it.
   * @param {typeof fetch} [opts.fetch]  - Override the fetch implementation (tests / proxies).
   */
  constructor(opts = {}) {
    this.baseUrl      = opts.baseUrl      || DEFAULT_BASE_URL;
    this.accessKey    = opts.accessKey    || '';
    this.accountKey   = opts.accountKey   || '';
    this.purgeKey     = opts.purgeKey     || '';
    this.analyticsKey = opts.analyticsKey || '';
    this.bearerToken  = opts.bearerToken  || '';
    this.timeoutMs    = opts.timeoutMs    || 0;
    this._fetch       = opts.fetch        || globalThis.fetch.bind(globalThis);
  }

  /** Build the auth header dict for the given security scheme name. */
  _authHeaders(scheme) {
    if (scheme === 'AccessKey'    && this.accessKey)    return { AccessKey: this.accessKey };
    if (scheme === 'AccountKey'   && this.accountKey)   return { AccountKey: this.accountKey };
    if (scheme === 'PurgeKey'     && this.purgeKey)     return { 'x-api-key': this.purgeKey };
    if (scheme === 'AnalyticsKey' && this.analyticsKey) return { 'x-api-key': this.analyticsKey };
    if (scheme === 'BearerToken'  && this.bearerToken)  return { Authorization: `Bearer ${this.bearerToken}` };
    return {};
  }

  /**
   * Internal request driver. Centralises body shaping, header merging,
   * timeout, JSON parsing, and `CloudCDNError` construction.
   *
   * @param {string} method
   * @param {string} path
   * @param {object} [opts]
   * @param {string} [opts.scheme]      - OpenAPI security scheme name.
   * @param {Record<string, unknown>} [opts.headers]
   * @param {unknown} [opts.body]
   * @param {Record<string, unknown>} [opts.query]
   * @param {boolean} [opts.raw]        - Return the raw `Response` (binary).
   * @param {AbortSignal} [opts.signal] - External cancellation.
   * @param {number} [opts.timeoutMs]   - Per-call timeout override.
   * @returns {Promise<unknown>}
   */
  async _request(method, path, opts = {}) {
    const url = new URL(path, this.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const isJson = _isJsonBody(opts.body);
    const headers = {
      ...this._authHeaders(opts.scheme),
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    };

    // Timeout via AbortController; combine with any externally supplied signal.
    const t = opts.timeoutMs ?? this.timeoutMs;
    const ctrl = (t > 0) ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(new Error('Request timeout')), t) : null;
    const signal = opts.signal && ctrl
      ? AbortSignal.any([opts.signal, ctrl.signal])
      : (opts.signal || ctrl?.signal);

    let res;
    try {
      res = await this._fetch(url.toString(), {
        method,
        headers,
        body: isJson ? JSON.stringify(opts.body) : opts.body,
        signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (opts.raw) return res;
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const message = body?.Message || body?.error || `${method} ${path} → HTTP ${res.status}`;
      throw new CloudCDNError(message, { status: res.status, body, url: url.toString() });
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res;
  }

  /**
   * Generate alt text (GET) — [GET /api/ai/alt-text]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async altTextGet(opts = {}) {
    return this._request('GET', `/api/ai/alt-text`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Generate alt text (POST) — [POST /api/ai/alt-text]
   *
   * Same as GET but accepts the asset URL in a JSON body — useful for clients that prefer POST semantics for AI calls.
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async altTextPost(opts = {}) {
    return this._request('POST', `/api/ai/alt-text`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Remove image background (not yet implemented) — [GET /api/ai/background-remove]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async backgroundRemoveGet(opts = {}) {
    return this._request('GET', `/api/ai/background-remove`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Remove image background (not yet implemented) — [POST /api/ai/background-remove]
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async backgroundRemovePost(opts = {}) {
    return this._request('POST', `/api/ai/background-remove`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * AI Chat Concierge — [POST /api/chat]
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async chatConcierge(opts = {}) {
    return this._request('POST', `/api/chat`, { body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Service health and binding status — [GET /api/health]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async healthCheck(opts = {}) {
    return this._request('GET', `/api/health`, { query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * AI image moderation (GET) — [GET /api/ai/moderate]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async moderateGet(opts = {}) {
    return this._request('GET', `/api/ai/moderate`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * AI image moderation (POST) — [POST /api/ai/moderate]
   *
   * Same as GET but accepts the asset URL in a JSON body.
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async moderatePost(opts = {}) {
    return this._request('POST', `/api/ai/moderate`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Semantic asset search — [GET /api/search]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async searchAssets(opts = {}) {
    return this._request('GET', `/api/search`, { query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * AI smart-crop gravity (GET) — [GET /api/ai/smart-crop]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async smartCropGet(opts = {}) {
    return this._request('GET', `/api/ai/smart-crop`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * AI smart-crop gravity (POST) — [POST /api/ai/smart-crop]
   *
   * Same as GET but accepts the asset URL in a JSON body.
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async smartCropPost(opts = {}) {
    return this._request('POST', `/api/ai/smart-crop`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Get asset metadata — [GET /api/assets/metadata]
   *
   * Returns detailed metadata for a single asset including available format variants, CDN URL, and transform URL.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getAssetMetadata(opts = {}) {
    return this._request('GET', `/api/assets/metadata`, { scheme: 'AccessKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * List assets — [GET /api/assets]
   *
   * Paginated, filterable asset catalog. Streams JSON for sub-2ms TTFB. Supports filtering by project, category, format, and free-text search. Rate limit: none (public with AccessKey).
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async listAssets(opts = {}) {
    return this._request('GET', `/api/assets`, { scheme: 'AccessKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Create a scoped API token — [POST /api/tokens]
   *
   * Mints a new API token with the given scopes. The plaintext token is returned **once** in the response — store it; it cannot be retrieved again. SHA-256 hashed at rest.
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async createToken(opts = {}) {
    return this._request('POST', `/api/tokens`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * List registered passkeys — [GET /api/passkeys]
   *
   * Returns metadata for every registered passkey for the authenticated user. Credential IDs are exposed; the raw public keys are not.
   *
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async listPasskeys(opts = {}) {
    return this._request('GET', `/api/passkeys`, { scheme: 'SessionCookie', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * List API tokens (redacted) — [GET /api/tokens]
   *
   * Returns all tokens for the account. Full token values are never exposed — only the prefix, scopes, and timestamps.
   *
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async listTokens(opts = {}) {
    return this._request('GET', `/api/tokens`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Start passkey authentication — get a challenge — [POST /api/passkeys/auth/begin]
   *
   * Returns a WebAuthn `PublicKeyCredentialRequestOptions` payload. Public endpoint (no session required).
   *
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async passkeyAuthBegin(opts = {}) {
    return this._request('POST', `/api/passkeys/auth/begin`, { signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Complete passkey authentication — [POST /api/passkeys/auth/complete]
   *
   * Verifies the assertion. On success, sets the `cdn_session` cookie (HMAC-signed, HttpOnly, Secure, 7-day TTL).
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async passkeyAuthComplete(opts = {}) {
    return this._request('POST', `/api/passkeys/auth/complete`, { body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Start passkey registration — get a challenge — [POST /api/passkeys/register/begin]
   *
   * Returns a WebAuthn `PublicKeyCredentialCreationOptions` payload. Pass the resulting credential to `/api/passkeys/register/complete`.
   *
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async passkeyRegisterBegin(opts = {}) {
    return this._request('POST', `/api/passkeys/register/begin`, { scheme: 'SessionCookie', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Complete passkey registration — [POST /api/passkeys/register/complete]
   *
   * Verifies the WebAuthn attestation, stores the credential, and returns the persisted passkey metadata.
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async passkeyRegisterComplete(opts = {}) {
    return this._request('POST', `/api/passkeys/register/complete`, { scheme: 'SessionCookie', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Revoke a passkey — [DELETE /api/passkeys]
   *
   * Permanently revokes a passkey by ID. The credential is removed from KV; subsequent authentication attempts with it fail.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async revokePasskey(opts = {}) {
    return this._request('DELETE', `/api/passkeys`, { scheme: 'SessionCookie', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Revoke an API token — [DELETE /api/tokens]
   *
   * Permanently revokes the token by ID. Subsequent requests using this token return 401.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async revokeToken(opts = {}) {
    return this._request('DELETE', `/api/tokens`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Add custom domain to zone — [POST /api/core/zones/{id}/domains]
   *
   * Adds a custom domain to a zone via the Cloudflare Pages API. SSL certificate is provisioned automatically. Requires CNAME pointed to cloudcdn-pro.pages.dev.
   *
   * @param {string} id - Zone identifier
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async addDomain(id, opts = {}) {
    return this._request('POST', `/api/core/zones/${id}/domains`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Audit log reader — [GET /api/core/audit-logs]
   *
   * Read the persistent control-plane audit trail. Each entry carries timestamp, action, client IP, user agent, request trace ID, and action-specific metadata. AccountKey-gated. 90-day retention.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async auditLogs(opts = {}) {
    return this._request('GET', `/api/core/audit-logs`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Create a new zone — [POST /api/core/zones]
   *
   * Creates a new tenant zone via Git commit. Scaffolds standard v1/ directories: banners, github, icons, logos, titles. Zone name must be 2-64 lowercase alphanumeric characters with hyphens.
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async createZone(opts = {}) {
    return this._request('POST', `/api/core/zones`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Delete zone — [DELETE /api/core/zones/{id}]
   *
   * Deletes an entire zone and all its files via a single Git commit. Triggers async cache purge by project tag.
   *
   * @param {string} id - Zone identifier to delete
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async deleteZone(id, opts = {}) {
    return this._request('DELETE', `/api/core/zones/${id}`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Read edge rules — [GET /api/core/rules]
   *
   * Returns the current contents of _headers and _redirects edge rule files.
   *
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getRules(opts = {}) {
    return this._request('GET', `/api/core/rules`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Get edge statistics — [GET /api/core/statistics]
   *
   * Returns bandwidth, requests, cache ratios, geographic distribution, and top assets from the analytics KV store. Optionally filtered by zone. Data retained for up to 90 days.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getStatistics(opts = {}) {
    return this._request('GET', `/api/core/statistics`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Get zone details — [GET /api/core/zones/{id}]
   *
   * Returns detailed information about a zone including all files, categories, formats, and storage usage.
   *
   * @param {string} id - Zone identifier (project name)
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getZone(id, opts = {}) {
    return this._request('GET', `/api/core/zones/${id}`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * List all zones — [GET /api/core/zones]
   *
   * Returns all tenant zones derived from the asset manifest. Each zone represents a client project with its file count, storage usage, and categories.
   *
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async listZones(opts = {}) {
    return this._request('GET', `/api/core/zones`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Update edge rules — [POST /api/core/rules]
   *
   * Updates _headers or _redirects via a Git commit. Content max size: 100 KB. Changes take effect after CI/CD deploy (~60-90 seconds).
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async updateRules(opts = {}) {
    return this._request('POST', `/api/core/rules`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Automatic format negotiation — [GET /api/auto]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async autoFormat(opts = {}) {
    return this._request('GET', `/api/auto`, { query: opts.query, raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Path-based automatic format negotiation — [GET /api/auto/{path}]
   *
   * @param {string} path - Asset path without file extension (e.g., bankingonai/images/logos/logo). Supports multiple path segments via catch-all routing.
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async autoFormatPath(path, opts = {}) {
    return this._request('GET', `/api/auto/${path}`, { signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Content-addressable placeholder hash — [GET /api/blurhash]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async blurhash(opts = {}) {
    return this._request('GET', `/api/blurhash`, { query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Low-quality image placeholder — [GET /api/lqip]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async lqip(opts = {}) {
    return this._request('GET', `/api/lqip`, { query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Scaffold a zone or stock asset from a single SVG — [POST /api/pipeline]
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async pipelineIngest(opts = {}) {
    return this._request('POST', `/api/pipeline`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Purge CDN cache — [POST /api/purge]
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async purgeCache(opts = {}) {
    return this._request('POST', `/api/purge`, { scheme: 'PurgeKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * HLS video streaming — [GET /api/stream]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async streamVideo(opts = {}) {
    return this._request('GET', `/api/stream`, { query: opts.query, raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Transform image — [GET /api/transform]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async transformImage(opts = {}) {
    return this._request('GET', `/api/transform`, { query: opts.query, raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Verify signed URL — [GET /api/signed]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async verifySignedUrl(opts = {}) {
    return this._request('GET', `/api/signed`, { query: opts.query, raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Get analytics report — [GET /api/analytics]
   *
   * Returns daily analytics data including hits, bandwidth, top assets, geographic distribution, and cache ratios. Auth: x-api-key header (ANALYTICS_KEY). Data retained for 35 days in KV.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getAnalytics(opts = {}) {
    return this._request('GET', `/api/analytics`, { scheme: 'AnalyticsKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Error tracking — [GET /api/insights/errors]
   *
   * Returns 4xx/5xx error counts grouped by status code with the top 10 paths per code. Error data populates automatically from middleware analytics. Accepts either AccountKey or AccessKey.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getErrors(opts = {}) {
    return this._request('GET', `/api/insights/errors`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Geographic distribution — [GET /api/insights/geography]
   *
   * Returns request counts by country (ISO 3166-1 alpha-2 codes), sorted descending by volume. Accepts either AccountKey or AccessKey.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getGeography(opts = {}) {
    return this._request('GET', `/api/insights/geography`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Analytics summary — [GET /api/insights/summary]
   *
   * Aggregate analytics summary: total requests, bandwidth, cache hit rate, and unique countries. Accepts either AccountKey or AccessKey for authentication.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getInsightsSummary(opts = {}) {
    return this._request('GET', `/api/insights/summary`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Top requested assets — [GET /api/insights/top-assets]
   *
   * Returns the most-requested assets over the specified period, ranked by request count. Accepts either AccountKey or AccessKey.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getTopAssets(opts = {}) {
    return this._request('GET', `/api/insights/top-assets`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Per-asset analytics — [GET /api/insights/asset]
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async insightsAsset(opts = {}) {
    return this._request('GET', `/api/insights/asset`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Record analytics hit — [POST /api/analytics]
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async trackAnalytics(opts = {}) {
    return this._request('POST', `/api/analytics`, { body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Stream or fetch operational logs — [GET /api/logs]
   *
   * Returns the worker request log buffered in KV. Use `?stream=1` for SSE; otherwise a JSON page is returned. Useful for live debugging and post-incident analysis.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async getLogs(opts = {}) {
    return this._request('GET', `/api/logs`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Batch upload files — [POST /api/storage/batch]
   *
   * Uploads multiple files in a single Git commit using the GitHub Git Database API (Trees + Commits). Avoids 409 conflicts from concurrent Contents API calls. Max 50 files per batch, 25 MB per file.
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async storageBatchUpload(opts = {}) {
    return this._request('POST', `/api/storage/batch`, { scheme: 'AccessKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Delete file — [DELETE /api/storage/{path}]
   *
   * Deletes a file from storage via GitHub API commit. Triggers async cache purge.
   *
   * @param {string} path - File path to delete
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async storageDelete(path, opts = {}) {
    return this._request('DELETE', `/api/storage/${path}`, { scheme: 'AccessKey', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * List directory or download file — [GET /api/storage/{path}]
   *
   * If the path ends with `/` or has no file extension, lists directory contents in Bunny.net-compatible JSON. Otherwise, downloads the file. Auth: AccessKey header or dashboard session cookie.
   *
   * @param {string} path - Storage path. Trailing slash = directory listing. File extension = download.
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async storageGetOrList(path, opts = {}) {
    return this._request('GET', `/api/storage/${path}`, { scheme: 'AccessKey', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * File metadata (HEAD) — [HEAD /api/storage/{path}]
   *
   * Returns Content-Length and Content-Type headers for a file without downloading the body.
   *
   * @param {string} path - File path
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async storageHead(path, opts = {}) {
    return this._request('HEAD', `/api/storage/${path}`, { scheme: 'AccessKey', raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Upload file — [PUT /api/storage/{path}]
   *
   * @param {string} path - Destination file path
   * @param {object} [opts]
   * @param {Blob|ArrayBuffer|Uint8Array} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async storageUpload(path, opts = {}) {
    return this._request('PUT', `/api/storage/${path}`, { scheme: 'AccessKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Delete a webhook — [DELETE /api/webhooks]
   *
   * Permanently removes a webhook by ID. Future deliveries for the subscribed events stop immediately.
   *
   * @param {object} [opts]
   * @param {object} [opts.query] - Query parameters.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async deleteWebhook(opts = {}) {
    return this._request('DELETE', `/api/webhooks`, { scheme: 'AccountKey', query: opts.query, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * List registered webhooks — [GET /api/webhooks]
   *
   * Returns metadata for every webhook registered against the account: id, target URL, subscribed events, creation timestamp, and active flag.
   *
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async listWebhooks(opts = {}) {
    return this._request('GET', `/api/webhooks`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

  /**
   * Register a webhook — [POST /api/webhooks]
   *
   * @param {object} [opts]
   * @param {object} [opts.body] - Request body.
   * @param {AbortSignal} [opts.signal]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<unknown>}
   * @throws {CloudCDNError}
   */
  async registerWebhook(opts = {}) {
    return this._request('POST', `/api/webhooks`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs });
  }

}

// ---------------------------------------------------------------------------
// Module-level convenience wrappers
// ---------------------------------------------------------------------------
// Each function takes the same opts as the corresponding client method,
// plus the auth key(s) the operation needs. They're shorthand for
// `new CloudCDNClient({...}).operationId(...)` — fine for one-shot calls.

/** Generate alt text (GET) [GET /api/ai/alt-text] */
export async function altTextGet(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.altTextGet(opts);
}

/** Generate alt text (POST) [POST /api/ai/alt-text] */
export async function altTextPost(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.altTextPost(opts);
}

/** Remove image background (not yet implemented) [GET /api/ai/background-remove] */
export async function backgroundRemoveGet(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.backgroundRemoveGet(opts);
}

/** Remove image background (not yet implemented) [POST /api/ai/background-remove] */
export async function backgroundRemovePost(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.backgroundRemovePost(opts);
}

/** AI Chat Concierge [POST /api/chat] */
export async function chatConcierge(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.chatConcierge(opts);
}

/** Service health and binding status [GET /api/health] */
export async function healthCheck(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.healthCheck(opts);
}

/** AI image moderation (GET) [GET /api/ai/moderate] */
export async function moderateGet(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.moderateGet(opts);
}

/** AI image moderation (POST) [POST /api/ai/moderate] */
export async function moderatePost(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.moderatePost(opts);
}

/** Semantic asset search [GET /api/search] */
export async function searchAssets(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.searchAssets(opts);
}

/** AI smart-crop gravity (GET) [GET /api/ai/smart-crop] */
export async function smartCropGet(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.smartCropGet(opts);
}

/** AI smart-crop gravity (POST) [POST /api/ai/smart-crop] */
export async function smartCropPost(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.smartCropPost(opts);
}

/** Get asset metadata [GET /api/assets/metadata] */
export async function getAssetMetadata(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.getAssetMetadata(opts);
}

/** List assets [GET /api/assets] */
export async function listAssets(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.listAssets(opts);
}

/** Create a scoped API token [POST /api/tokens] */
export async function createToken(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.createToken(opts);
}

/** List registered passkeys [GET /api/passkeys] */
export async function listPasskeys(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.listPasskeys(opts);
}

/** List API tokens (redacted) [GET /api/tokens] */
export async function listTokens(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.listTokens(opts);
}

/** Start passkey authentication — get a challenge [POST /api/passkeys/auth/begin] */
export async function passkeyAuthBegin(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.passkeyAuthBegin(opts);
}

/** Complete passkey authentication [POST /api/passkeys/auth/complete] */
export async function passkeyAuthComplete(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.passkeyAuthComplete(opts);
}

/** Start passkey registration — get a challenge [POST /api/passkeys/register/begin] */
export async function passkeyRegisterBegin(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.passkeyRegisterBegin(opts);
}

/** Complete passkey registration [POST /api/passkeys/register/complete] */
export async function passkeyRegisterComplete(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.passkeyRegisterComplete(opts);
}

/** Revoke a passkey [DELETE /api/passkeys] */
export async function revokePasskey(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.revokePasskey(opts);
}

/** Revoke an API token [DELETE /api/tokens] */
export async function revokeToken(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.revokeToken(opts);
}

/** Add custom domain to zone [POST /api/core/zones/{id}/domains] */
export async function addDomain(id, opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.addDomain(id, opts);
}

/** Audit log reader [GET /api/core/audit-logs] */
export async function auditLogs(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.auditLogs(opts);
}

/** Create a new zone [POST /api/core/zones] */
export async function createZone(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.createZone(opts);
}

/** Delete zone [DELETE /api/core/zones/{id}] */
export async function deleteZone(id, opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.deleteZone(id, opts);
}

/** Read edge rules [GET /api/core/rules] */
export async function getRules(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getRules(opts);
}

/** Get edge statistics [GET /api/core/statistics] */
export async function getStatistics(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getStatistics(opts);
}

/** Get zone details [GET /api/core/zones/{id}] */
export async function getZone(id, opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getZone(id, opts);
}

/** List all zones [GET /api/core/zones] */
export async function listZones(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.listZones(opts);
}

/** Update edge rules [POST /api/core/rules] */
export async function updateRules(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.updateRules(opts);
}

/** Automatic format negotiation [GET /api/auto] */
export async function autoFormat(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.autoFormat(opts);
}

/** Path-based automatic format negotiation [GET /api/auto/{path}] */
export async function autoFormatPath(path, opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.autoFormatPath(path, opts);
}

/** Content-addressable placeholder hash [GET /api/blurhash] */
export async function blurhash(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.blurhash(opts);
}

/** Low-quality image placeholder [GET /api/lqip] */
export async function lqip(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.lqip(opts);
}

/** Scaffold a zone or stock asset from a single SVG [POST /api/pipeline] */
export async function pipelineIngest(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.pipelineIngest(opts);
}

/** Purge CDN cache [POST /api/purge] */
export async function purgeCache(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, purgeKey: opts.purgeKey });
  return c.purgeCache(opts);
}

/** HLS video streaming [GET /api/stream] */
export async function streamVideo(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.streamVideo(opts);
}

/** Transform image [GET /api/transform] */
export async function transformImage(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.transformImage(opts);
}

/** Verify signed URL [GET /api/signed] */
export async function verifySignedUrl(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.verifySignedUrl(opts);
}

/** Get analytics report [GET /api/analytics] */
export async function getAnalytics(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, analyticsKey: opts.analyticsKey });
  return c.getAnalytics(opts);
}

/** Error tracking [GET /api/insights/errors] */
export async function getErrors(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getErrors(opts);
}

/** Geographic distribution [GET /api/insights/geography] */
export async function getGeography(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getGeography(opts);
}

/** Analytics summary [GET /api/insights/summary] */
export async function getInsightsSummary(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getInsightsSummary(opts);
}

/** Top requested assets [GET /api/insights/top-assets] */
export async function getTopAssets(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getTopAssets(opts);
}

/** Per-asset analytics [GET /api/insights/asset] */
export async function insightsAsset(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.insightsAsset(opts);
}

/** Record analytics hit [POST /api/analytics] */
export async function trackAnalytics(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.trackAnalytics(opts);
}

/** Stream or fetch operational logs [GET /api/logs] */
export async function getLogs(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getLogs(opts);
}

/** Batch upload files [POST /api/storage/batch] */
export async function storageBatchUpload(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageBatchUpload(opts);
}

/** Delete file [DELETE /api/storage/{path}] */
export async function storageDelete(path, opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageDelete(path, opts);
}

/** List directory or download file [GET /api/storage/{path}] */
export async function storageGetOrList(path, opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageGetOrList(path, opts);
}

/** File metadata (HEAD) [HEAD /api/storage/{path}] */
export async function storageHead(path, opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageHead(path, opts);
}

/** Upload file [PUT /api/storage/{path}] */
export async function storageUpload(path, opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageUpload(path, opts);
}

/** Delete a webhook [DELETE /api/webhooks] */
export async function deleteWebhook(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.deleteWebhook(opts);
}

/** List registered webhooks [GET /api/webhooks] */
export async function listWebhooks(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.listWebhooks(opts);
}

/** Register a webhook [POST /api/webhooks] */
export async function registerWebhook(opts = {}) {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.registerWebhook(opts);
}
