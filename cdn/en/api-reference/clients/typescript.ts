// CloudCDN API Client — TypeScript
// Auto-generated from openapi.json — do not edit manually.
//
// Base URL: https://cloudcdn.pro
//
// Usage:
//   import { CloudCDNClient } from './typescript';
//   const client = new CloudCDNClient({ accessKey: process.env.CLOUDCDN_ACCESS_KEY });
//   const assets = await client.listAssets({ query: { project: 'akande' } });

export const DEFAULT_BASE_URL = "https://cloudcdn.pro";
export const BASE_URL = DEFAULT_BASE_URL;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientOptions {
  baseUrl?: string;
  accessKey?: string;
  accountKey?: string;
  purgeKey?: string;
  analyticsKey?: string;
  bearerToken?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ErrorMeta {
  status: number;
  body: unknown;
  url: string;
}

export interface AltTextGetQuery {
  url: string;
}

export interface BackgroundRemoveGetQuery {
  url: string;
}

export interface HealthCheckQuery {
  deep?: "0" | "1";
}

export interface ModerateGetQuery {
  url: string;
}

export interface SearchAssetsQuery {
  q: string;
  limit?: number;
}

export interface SmartCropGetQuery {
  url: string;
}

export interface GetAssetMetadataQuery {
  path: string;
}

export interface ListAssetsQuery {
  project?: string;
  category?: string;
  format?: string;
  q?: string;
  page?: number;
  per_page?: number;
  sort?: "name" | "size" | "project";
  order?: "asc" | "desc";
}

export interface RevokePasskeyQuery {
  id: string;
}

export interface RevokeTokenQuery {
  id: string;
}

export interface AuditLogsQuery {
  days?: number;
  action?: string;
  limit?: number;
}

export interface GetStatisticsQuery {
  days?: number;
  zone?: string;
}

export interface AutoFormatQuery {
  path: string;
  anim?: "0" | "1";
}

export interface BlurhashQuery {
  url: string;
  size?: number;
}

export interface LqipQuery {
  url: string;
  size?: number;
  blur?: number;
}

export interface StreamVideoQuery {
  video: "black" | "mount_fuji" | "nature";
  quality?: "1080" | "720" | "480";
  segment?: number;
}

export interface TransformImageQuery {
  url: string;
  w?: number;
  h?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  format?: "auto" | "webp" | "avif" | "png" | "jpeg";
  q?: number;
  blur?: number;
  sharpen?: number;
  gravity?: "center" | "north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest" | "face" | "auto";
}

export interface VerifySignedUrlQuery {
  path: string;
  expires: number;
  sig: string;
}

export interface GetAnalyticsQuery {
  days?: number;
}

export interface GetErrorsQuery {
  days?: number;
}

export interface GetGeographyQuery {
  days?: number;
}

export interface GetInsightsSummaryQuery {
  days?: number;
  zone?: string;
}

export interface GetTopAssetsQuery {
  days?: number;
  limit?: number;
}

export interface InsightsAssetQuery {
  path: string;
  days?: number;
}

export interface GetLogsQuery {
  stream?: boolean;
  limit?: number;
  since?: string;
}

export interface DeleteWebhookQuery {
  id: string;
}

export class CloudCDNError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;
  constructor(message: string, meta: ErrorMeta) {
    super(message);
    this.name = 'CloudCDNError';
    this.status = meta.status;
    this.body = meta.body;
    this.url = meta.url;
  }
}

function isJsonBody(body: unknown): boolean {
  return Boolean(body)
    && typeof body === 'object'
    && !(body instanceof Blob)
    && !(body instanceof ArrayBuffer)
    && !(body instanceof Uint8Array)
    && !(body instanceof FormData)
    && !(body instanceof URLSearchParams);
}

type Scheme = 'AccessKey' | 'AccountKey' | 'PurgeKey' | 'AnalyticsKey' | 'BearerToken';

interface InternalRequestOptions extends RequestOptions {
  scheme?: Scheme;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  raw?: boolean;
}

/**
 * Strongly-typed client for the CloudCDN REST API.
 *
 * @example
 *   const client = new CloudCDNClient({ accessKey: process.env.CLOUDCDN_ACCESS_KEY });
 *   const assets = await client.listAssets({ query: { project: 'akande' } });
 */
export class CloudCDNClient {
  readonly baseUrl: string;
  readonly accessKey: string;
  readonly accountKey: string;
  readonly purgeKey: string;
  readonly analyticsKey: string;
  readonly bearerToken: string;
  readonly timeoutMs: number;
  private readonly _fetch: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl      = opts.baseUrl      ?? DEFAULT_BASE_URL;
    this.accessKey    = opts.accessKey    ?? '';
    this.accountKey   = opts.accountKey   ?? '';
    this.purgeKey     = opts.purgeKey     ?? '';
    this.analyticsKey = opts.analyticsKey ?? '';
    this.bearerToken  = opts.bearerToken  ?? '';
    this.timeoutMs    = opts.timeoutMs    ?? 0;
    this._fetch       = opts.fetch        ?? globalThis.fetch.bind(globalThis);
  }

  private _authHeaders(scheme?: Scheme): Record<string, string> {
    if (scheme === 'AccessKey'    && this.accessKey)    return { AccessKey: this.accessKey };
    if (scheme === 'AccountKey'   && this.accountKey)   return { AccountKey: this.accountKey };
    if (scheme === 'PurgeKey'     && this.purgeKey)     return { 'x-api-key': this.purgeKey };
    if (scheme === 'AnalyticsKey' && this.analyticsKey) return { 'x-api-key': this.analyticsKey };
    if (scheme === 'BearerToken'  && this.bearerToken)  return { Authorization: `Bearer ${this.bearerToken}` };
    return {};
  }

  private async _request(method: string, path: string, opts: InternalRequestOptions = {}): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const json = isJsonBody(opts.body);
    const headers: Record<string, string> = {
      ...this._authHeaders(opts.scheme),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    };

    const t = opts.timeoutMs ?? this.timeoutMs;
    const ctrl = t > 0 ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(new Error('Request timeout')), t) : null;
    const signal = opts.signal && ctrl
      ? AbortSignal.any([opts.signal, ctrl.signal])
      : (opts.signal || ctrl?.signal);

    let res: Response;
    try {
      res = await this._fetch(url.toString(), {
        method,
        headers,
        body: json ? JSON.stringify(opts.body) : (opts.body as BodyInit | undefined),
        signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (opts.raw) return res;
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>;
      const message = (body.Message as string | undefined)
        ?? (body.error as string | undefined)
        ?? `${method} ${path} → HTTP ${res.status}`;
      throw new CloudCDNError(message, { status: res.status, body, url: url.toString() });
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res;
  }

  /**
   * Generate alt text (GET) — [GET /api/ai/alt-text]
   *
   * @throws {CloudCDNError}
   */
  async altTextGet(opts: { query?: AltTextGetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/ai/alt-text`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Generate alt text (POST) — [POST /api/ai/alt-text]
   *
   * Same as GET but accepts the asset URL in a JSON body — useful for clients that prefer POST semantics for AI calls.
   *
   * @throws {CloudCDNError}
   */
  async altTextPost(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/ai/alt-text`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Remove image background (not yet implemented) — [GET /api/ai/background-remove]
   *
   * @throws {CloudCDNError}
   */
  async backgroundRemoveGet(opts: { query?: BackgroundRemoveGetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/ai/background-remove`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Remove image background (not yet implemented) — [POST /api/ai/background-remove]
   *
   * @throws {CloudCDNError}
   */
  async backgroundRemovePost(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/ai/background-remove`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * AI Chat Concierge — [POST /api/chat]
   *
   * @throws {CloudCDNError}
   */
  async chatConcierge(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/chat`, { body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Service health and binding status — [GET /api/health]
   *
   * @throws {CloudCDNError}
   */
  async healthCheck(opts: { query?: HealthCheckQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/health`, { query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * AI image moderation (GET) — [GET /api/ai/moderate]
   *
   * @throws {CloudCDNError}
   */
  async moderateGet(opts: { query?: ModerateGetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/ai/moderate`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * AI image moderation (POST) — [POST /api/ai/moderate]
   *
   * Same as GET but accepts the asset URL in a JSON body.
   *
   * @throws {CloudCDNError}
   */
  async moderatePost(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/ai/moderate`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Semantic asset search — [GET /api/search]
   *
   * @throws {CloudCDNError}
   */
  async searchAssets(opts: { query?: SearchAssetsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/search`, { query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * AI smart-crop gravity (GET) — [GET /api/ai/smart-crop]
   *
   * @throws {CloudCDNError}
   */
  async smartCropGet(opts: { query?: SmartCropGetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/ai/smart-crop`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * AI smart-crop gravity (POST) — [POST /api/ai/smart-crop]
   *
   * Same as GET but accepts the asset URL in a JSON body.
   *
   * @throws {CloudCDNError}
   */
  async smartCropPost(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/ai/smart-crop`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Get asset metadata — [GET /api/assets/metadata]
   *
   * Returns detailed metadata for a single asset including available format variants, CDN URL, and transform URL.
   *
   * @throws {CloudCDNError}
   */
  async getAssetMetadata(opts: { query?: GetAssetMetadataQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/assets/metadata`, { scheme: 'AccessKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * List assets — [GET /api/assets]
   *
   * Paginated, filterable asset catalog. Streams JSON for sub-2ms TTFB. Supports filtering by project, category, format, and free-text search. Rate limit: none (public with AccessKey).
   *
   * @throws {CloudCDNError}
   */
  async listAssets(opts: { query?: ListAssetsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/assets`, { scheme: 'AccessKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Create a scoped API token — [POST /api/tokens]
   *
   * Mints a new API token with the given scopes. The plaintext token is returned **once** in the response — store it; it cannot be retrieved again. SHA-256 hashed at rest.
   *
   * @throws {CloudCDNError}
   */
  async createToken(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/tokens`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * List registered passkeys — [GET /api/passkeys]
   *
   * Returns metadata for every registered passkey for the authenticated user. Credential IDs are exposed; the raw public keys are not.
   *
   * @throws {CloudCDNError}
   */
  async listPasskeys(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/passkeys`, { scheme: 'SessionCookie', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * List API tokens (redacted) — [GET /api/tokens]
   *
   * Returns all tokens for the account. Full token values are never exposed — only the prefix, scopes, and timestamps.
   *
   * @throws {CloudCDNError}
   */
  async listTokens(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/tokens`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Start passkey authentication — get a challenge — [POST /api/passkeys/auth/begin]
   *
   * Returns a WebAuthn `PublicKeyCredentialRequestOptions` payload. Public endpoint (no session required).
   *
   * @throws {CloudCDNError}
   */
  async passkeyAuthBegin(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/passkeys/auth/begin`, { signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Complete passkey authentication — [POST /api/passkeys/auth/complete]
   *
   * Verifies the assertion. On success, sets the `cdn_session` cookie (HMAC-signed, HttpOnly, Secure, 7-day TTL).
   *
   * @throws {CloudCDNError}
   */
  async passkeyAuthComplete(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/passkeys/auth/complete`, { body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Start passkey registration — get a challenge — [POST /api/passkeys/register/begin]
   *
   * Returns a WebAuthn `PublicKeyCredentialCreationOptions` payload. Pass the resulting credential to `/api/passkeys/register/complete`.
   *
   * @throws {CloudCDNError}
   */
  async passkeyRegisterBegin(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/passkeys/register/begin`, { scheme: 'SessionCookie', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Complete passkey registration — [POST /api/passkeys/register/complete]
   *
   * Verifies the WebAuthn attestation, stores the credential, and returns the persisted passkey metadata.
   *
   * @throws {CloudCDNError}
   */
  async passkeyRegisterComplete(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/passkeys/register/complete`, { scheme: 'SessionCookie', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Revoke a passkey — [DELETE /api/passkeys]
   *
   * Permanently revokes a passkey by ID. The credential is removed from KV; subsequent authentication attempts with it fail.
   *
   * @throws {CloudCDNError}
   */
  async revokePasskey(opts: { query?: RevokePasskeyQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('DELETE', `/api/passkeys`, { scheme: 'SessionCookie', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Revoke an API token — [DELETE /api/tokens]
   *
   * Permanently revokes the token by ID. Subsequent requests using this token return 401.
   *
   * @throws {CloudCDNError}
   */
  async revokeToken(opts: { query?: RevokeTokenQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('DELETE', `/api/tokens`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Add custom domain to zone — [POST /api/core/zones/{id}/domains]
   *
   * Adds a custom domain to a zone via the Cloudflare Pages API. SSL certificate is provisioned automatically. Requires CNAME pointed to cloudcdn-pro.pages.dev.
   *
   * @throws {CloudCDNError}
   */
  async addDomain(id: string, opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/core/zones/${id}/domains`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Audit log reader — [GET /api/core/audit-logs]
   *
   * Read the persistent control-plane audit trail. Each entry carries timestamp, action, client IP, user agent, request trace ID, and action-specific metadata. AccountKey-gated. 90-day retention.
   *
   * @throws {CloudCDNError}
   */
  async auditLogs(opts: { query?: AuditLogsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/core/audit-logs`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Create a new zone — [POST /api/core/zones]
   *
   * Creates a new tenant zone via Git commit. Scaffolds standard v1/ directories: banners, github, icons, logos, titles. Zone name must be 2-64 lowercase alphanumeric characters with hyphens.
   *
   * @throws {CloudCDNError}
   */
  async createZone(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/core/zones`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Delete zone — [DELETE /api/core/zones/{id}]
   *
   * Deletes an entire zone and all its files via a single Git commit. Triggers async cache purge by project tag.
   *
   * @throws {CloudCDNError}
   */
  async deleteZone(id: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('DELETE', `/api/core/zones/${id}`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Read edge rules — [GET /api/core/rules]
   *
   * Returns the current contents of _headers and _redirects edge rule files.
   *
   * @throws {CloudCDNError}
   */
  async getRules(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/core/rules`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Get edge statistics — [GET /api/core/statistics]
   *
   * Returns bandwidth, requests, cache ratios, geographic distribution, and top assets from the analytics KV store. Optionally filtered by zone. Data retained for up to 90 days.
   *
   * @throws {CloudCDNError}
   */
  async getStatistics(opts: { query?: GetStatisticsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/core/statistics`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Get zone details — [GET /api/core/zones/{id}]
   *
   * Returns detailed information about a zone including all files, categories, formats, and storage usage.
   *
   * @throws {CloudCDNError}
   */
  async getZone(id: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/core/zones/${id}`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * List all zones — [GET /api/core/zones]
   *
   * Returns all tenant zones derived from the asset manifest. Each zone represents a client project with its file count, storage usage, and categories.
   *
   * @throws {CloudCDNError}
   */
  async listZones(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/core/zones`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Update edge rules — [POST /api/core/rules]
   *
   * Updates _headers or _redirects via a Git commit. Content max size: 100 KB. Changes take effect after CI/CD deploy (~60-90 seconds).
   *
   * @throws {CloudCDNError}
   */
  async updateRules(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/core/rules`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Automatic format negotiation — [GET /api/auto]
   *
   * @throws {CloudCDNError}
   */
  async autoFormat(opts: { query?: AutoFormatQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
    return this._request('GET', `/api/auto`, { query: opts.query as Record<string, string | number | boolean | undefined>, raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<Response>;
  }

  /**
   * Path-based automatic format negotiation — [GET /api/auto/{path}]
   *
   * @throws {CloudCDNError}
   */
  async autoFormatPath(path: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/auto/${path}`, { signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Content-addressable placeholder hash — [GET /api/blurhash]
   *
   * @throws {CloudCDNError}
   */
  async blurhash(opts: { query?: BlurhashQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/blurhash`, { query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Low-quality image placeholder — [GET /api/lqip]
   *
   * @throws {CloudCDNError}
   */
  async lqip(opts: { query?: LqipQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/lqip`, { query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Scaffold a zone or stock asset from a single SVG — [POST /api/pipeline]
   *
   * @throws {CloudCDNError}
   */
  async pipelineIngest(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/pipeline`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Purge CDN cache — [POST /api/purge]
   *
   * @throws {CloudCDNError}
   */
  async purgeCache(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/purge`, { scheme: 'PurgeKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * HLS video streaming — [GET /api/stream]
   *
   * @throws {CloudCDNError}
   */
  async streamVideo(opts: { query?: StreamVideoQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
    return this._request('GET', `/api/stream`, { query: opts.query as Record<string, string | number | boolean | undefined>, raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<Response>;
  }

  /**
   * Transform image — [GET /api/transform]
   *
   * @throws {CloudCDNError}
   */
  async transformImage(opts: { query?: TransformImageQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
    return this._request('GET', `/api/transform`, { query: opts.query as Record<string, string | number | boolean | undefined>, raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<Response>;
  }

  /**
   * Verify signed URL — [GET /api/signed]
   *
   * @throws {CloudCDNError}
   */
  async verifySignedUrl(opts: { query?: VerifySignedUrlQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
    return this._request('GET', `/api/signed`, { query: opts.query as Record<string, string | number | boolean | undefined>, raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<Response>;
  }

  /**
   * Get analytics report — [GET /api/analytics]
   *
   * Returns daily analytics data including hits, bandwidth, top assets, geographic distribution, and cache ratios. Auth: x-api-key header (ANALYTICS_KEY). Data retained for 35 days in KV.
   *
   * @throws {CloudCDNError}
   */
  async getAnalytics(opts: { query?: GetAnalyticsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/analytics`, { scheme: 'AnalyticsKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Error tracking — [GET /api/insights/errors]
   *
   * Returns 4xx/5xx error counts grouped by status code with the top 10 paths per code. Error data populates automatically from middleware analytics. Accepts either AccountKey or AccessKey.
   *
   * @throws {CloudCDNError}
   */
  async getErrors(opts: { query?: GetErrorsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/insights/errors`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Geographic distribution — [GET /api/insights/geography]
   *
   * Returns request counts by country (ISO 3166-1 alpha-2 codes), sorted descending by volume. Accepts either AccountKey or AccessKey.
   *
   * @throws {CloudCDNError}
   */
  async getGeography(opts: { query?: GetGeographyQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/insights/geography`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Analytics summary — [GET /api/insights/summary]
   *
   * Aggregate analytics summary: total requests, bandwidth, cache hit rate, and unique countries. Accepts either AccountKey or AccessKey for authentication.
   *
   * @throws {CloudCDNError}
   */
  async getInsightsSummary(opts: { query?: GetInsightsSummaryQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/insights/summary`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Top requested assets — [GET /api/insights/top-assets]
   *
   * Returns the most-requested assets over the specified period, ranked by request count. Accepts either AccountKey or AccessKey.
   *
   * @throws {CloudCDNError}
   */
  async getTopAssets(opts: { query?: GetTopAssetsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/insights/top-assets`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Per-asset analytics — [GET /api/insights/asset]
   *
   * @throws {CloudCDNError}
   */
  async insightsAsset(opts: { query?: InsightsAssetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/insights/asset`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Record analytics hit — [POST /api/analytics]
   *
   * @throws {CloudCDNError}
   */
  async trackAnalytics(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/analytics`, { body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Stream or fetch operational logs — [GET /api/logs]
   *
   * Returns the worker request log buffered in KV. Use `?stream=1` for SSE; otherwise a JSON page is returned. Useful for live debugging and post-incident analysis.
   *
   * @throws {CloudCDNError}
   */
  async getLogs(opts: { query?: GetLogsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/logs`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Batch upload files — [POST /api/storage/batch]
   *
   * Uploads multiple files in a single Git commit using the GitHub Git Database API (Trees + Commits). Avoids 409 conflicts from concurrent Contents API calls. Max 50 files per batch, 25 MB per file.
   *
   * @throws {CloudCDNError}
   */
  async storageBatchUpload(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/storage/batch`, { scheme: 'AccessKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Delete file — [DELETE /api/storage/{path}]
   *
   * Deletes a file from storage via GitHub API commit. Triggers async cache purge.
   *
   * @throws {CloudCDNError}
   */
  async storageDelete(path: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('DELETE', `/api/storage/${path}`, { scheme: 'AccessKey', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * List directory or download file — [GET /api/storage/{path}]
   *
   * If the path ends with `/` or has no file extension, lists directory contents in Bunny.net-compatible JSON. Otherwise, downloads the file. Auth: AccessKey header or dashboard session cookie.
   *
   * @throws {CloudCDNError}
   */
  async storageGetOrList(path: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/storage/${path}`, { scheme: 'AccessKey', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * File metadata (HEAD) — [HEAD /api/storage/{path}]
   *
   * Returns Content-Length and Content-Type headers for a file without downloading the body.
   *
   * @throws {CloudCDNError}
   */
  async storageHead(path: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
    return this._request('HEAD', `/api/storage/${path}`, { scheme: 'AccessKey', raw: true, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<Response>;
  }

  /**
   * Upload file — [PUT /api/storage/{path}]
   *
   * @throws {CloudCDNError}
   */
  async storageUpload(path: string, opts: { body?: Blob | ArrayBuffer | Uint8Array; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('PUT', `/api/storage/${path}`, { scheme: 'AccessKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Delete a webhook — [DELETE /api/webhooks]
   *
   * Permanently removes a webhook by ID. Future deliveries for the subscribed events stop immediately.
   *
   * @throws {CloudCDNError}
   */
  async deleteWebhook(opts: { query?: DeleteWebhookQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('DELETE', `/api/webhooks`, { scheme: 'AccountKey', query: opts.query as Record<string, string | number | boolean | undefined>, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * List registered webhooks — [GET /api/webhooks]
   *
   * Returns metadata for every webhook registered against the account: id, target URL, subscribed events, creation timestamp, and active flag.
   *
   * @throws {CloudCDNError}
   */
  async listWebhooks(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('GET', `/api/webhooks`, { scheme: 'AccountKey', signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

  /**
   * Register a webhook — [POST /api/webhooks]
   *
   * @throws {CloudCDNError}
   */
  async registerWebhook(opts: { body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this._request('POST', `/api/webhooks`, { scheme: 'AccountKey', body: opts.body, signal: opts.signal, timeoutMs: opts.timeoutMs }) as Promise<unknown>;
  }

}

// ---------------------------------------------------------------------------
// Module-level convenience wrappers
// ---------------------------------------------------------------------------

/** Generate alt text (GET) [GET /api/ai/alt-text] */
export async function altTextGet(opts: { baseUrl?: string; accountKey?: string; query?: AltTextGetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.altTextGet(opts);
}

/** Generate alt text (POST) [POST /api/ai/alt-text] */
export async function altTextPost(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.altTextPost(opts);
}

/** Remove image background (not yet implemented) [GET /api/ai/background-remove] */
export async function backgroundRemoveGet(opts: { baseUrl?: string; accountKey?: string; query?: BackgroundRemoveGetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.backgroundRemoveGet(opts);
}

/** Remove image background (not yet implemented) [POST /api/ai/background-remove] */
export async function backgroundRemovePost(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.backgroundRemovePost(opts);
}

/** AI Chat Concierge [POST /api/chat] */
export async function chatConcierge(opts: { baseUrl?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.chatConcierge(opts);
}

/** Service health and binding status [GET /api/health] */
export async function healthCheck(opts: { baseUrl?: string; query?: HealthCheckQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.healthCheck(opts);
}

/** AI image moderation (GET) [GET /api/ai/moderate] */
export async function moderateGet(opts: { baseUrl?: string; accountKey?: string; query?: ModerateGetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.moderateGet(opts);
}

/** AI image moderation (POST) [POST /api/ai/moderate] */
export async function moderatePost(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.moderatePost(opts);
}

/** Semantic asset search [GET /api/search] */
export async function searchAssets(opts: { baseUrl?: string; query?: SearchAssetsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.searchAssets(opts);
}

/** AI smart-crop gravity (GET) [GET /api/ai/smart-crop] */
export async function smartCropGet(opts: { baseUrl?: string; accountKey?: string; query?: SmartCropGetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.smartCropGet(opts);
}

/** AI smart-crop gravity (POST) [POST /api/ai/smart-crop] */
export async function smartCropPost(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.smartCropPost(opts);
}

/** Get asset metadata [GET /api/assets/metadata] */
export async function getAssetMetadata(opts: { baseUrl?: string; accessKey?: string; query?: GetAssetMetadataQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.getAssetMetadata(opts);
}

/** List assets [GET /api/assets] */
export async function listAssets(opts: { baseUrl?: string; accessKey?: string; query?: ListAssetsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.listAssets(opts);
}

/** Create a scoped API token [POST /api/tokens] */
export async function createToken(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.createToken(opts);
}

/** List registered passkeys [GET /api/passkeys] */
export async function listPasskeys(opts: { baseUrl?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.listPasskeys(opts);
}

/** List API tokens (redacted) [GET /api/tokens] */
export async function listTokens(opts: { baseUrl?: string; accountKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.listTokens(opts);
}

/** Start passkey authentication — get a challenge [POST /api/passkeys/auth/begin] */
export async function passkeyAuthBegin(opts: { baseUrl?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.passkeyAuthBegin(opts);
}

/** Complete passkey authentication [POST /api/passkeys/auth/complete] */
export async function passkeyAuthComplete(opts: { baseUrl?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.passkeyAuthComplete(opts);
}

/** Start passkey registration — get a challenge [POST /api/passkeys/register/begin] */
export async function passkeyRegisterBegin(opts: { baseUrl?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.passkeyRegisterBegin(opts);
}

/** Complete passkey registration [POST /api/passkeys/register/complete] */
export async function passkeyRegisterComplete(opts: { baseUrl?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.passkeyRegisterComplete(opts);
}

/** Revoke a passkey [DELETE /api/passkeys] */
export async function revokePasskey(opts: { baseUrl?: string; query?: RevokePasskeyQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.revokePasskey(opts);
}

/** Revoke an API token [DELETE /api/tokens] */
export async function revokeToken(opts: { baseUrl?: string; accountKey?: string; query?: RevokeTokenQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.revokeToken(opts);
}

/** Add custom domain to zone [POST /api/core/zones/{id}/domains] */
export async function addDomain(id: string, opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.addDomain(id, opts);
}

/** Audit log reader [GET /api/core/audit-logs] */
export async function auditLogs(opts: { baseUrl?: string; accountKey?: string; query?: AuditLogsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.auditLogs(opts);
}

/** Create a new zone [POST /api/core/zones] */
export async function createZone(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.createZone(opts);
}

/** Delete zone [DELETE /api/core/zones/{id}] */
export async function deleteZone(id: string, opts: { baseUrl?: string; accountKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.deleteZone(id, opts);
}

/** Read edge rules [GET /api/core/rules] */
export async function getRules(opts: { baseUrl?: string; accountKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getRules(opts);
}

/** Get edge statistics [GET /api/core/statistics] */
export async function getStatistics(opts: { baseUrl?: string; accountKey?: string; query?: GetStatisticsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getStatistics(opts);
}

/** Get zone details [GET /api/core/zones/{id}] */
export async function getZone(id: string, opts: { baseUrl?: string; accountKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getZone(id, opts);
}

/** List all zones [GET /api/core/zones] */
export async function listZones(opts: { baseUrl?: string; accountKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.listZones(opts);
}

/** Update edge rules [POST /api/core/rules] */
export async function updateRules(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.updateRules(opts);
}

/** Automatic format negotiation [GET /api/auto] */
export async function autoFormat(opts: { baseUrl?: string; query?: AutoFormatQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.autoFormat(opts);
}

/** Path-based automatic format negotiation [GET /api/auto/{path}] */
export async function autoFormatPath(path: string, opts: { baseUrl?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.autoFormatPath(path, opts);
}

/** Content-addressable placeholder hash [GET /api/blurhash] */
export async function blurhash(opts: { baseUrl?: string; query?: BlurhashQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.blurhash(opts);
}

/** Low-quality image placeholder [GET /api/lqip] */
export async function lqip(opts: { baseUrl?: string; query?: LqipQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.lqip(opts);
}

/** Scaffold a zone or stock asset from a single SVG [POST /api/pipeline] */
export async function pipelineIngest(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.pipelineIngest(opts);
}

/** Purge CDN cache [POST /api/purge] */
export async function purgeCache(opts: { baseUrl?: string; purgeKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, purgeKey: opts.purgeKey });
  return c.purgeCache(opts);
}

/** HLS video streaming [GET /api/stream] */
export async function streamVideo(opts: { baseUrl?: string; query?: StreamVideoQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.streamVideo(opts);
}

/** Transform image [GET /api/transform] */
export async function transformImage(opts: { baseUrl?: string; query?: TransformImageQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.transformImage(opts);
}

/** Verify signed URL [GET /api/signed] */
export async function verifySignedUrl(opts: { baseUrl?: string; query?: VerifySignedUrlQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.verifySignedUrl(opts);
}

/** Get analytics report [GET /api/analytics] */
export async function getAnalytics(opts: { baseUrl?: string; analyticsKey?: string; query?: GetAnalyticsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, analyticsKey: opts.analyticsKey });
  return c.getAnalytics(opts);
}

/** Error tracking [GET /api/insights/errors] */
export async function getErrors(opts: { baseUrl?: string; accountKey?: string; query?: GetErrorsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getErrors(opts);
}

/** Geographic distribution [GET /api/insights/geography] */
export async function getGeography(opts: { baseUrl?: string; accountKey?: string; query?: GetGeographyQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getGeography(opts);
}

/** Analytics summary [GET /api/insights/summary] */
export async function getInsightsSummary(opts: { baseUrl?: string; accountKey?: string; query?: GetInsightsSummaryQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getInsightsSummary(opts);
}

/** Top requested assets [GET /api/insights/top-assets] */
export async function getTopAssets(opts: { baseUrl?: string; accountKey?: string; query?: GetTopAssetsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getTopAssets(opts);
}

/** Per-asset analytics [GET /api/insights/asset] */
export async function insightsAsset(opts: { baseUrl?: string; accountKey?: string; query?: InsightsAssetQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.insightsAsset(opts);
}

/** Record analytics hit [POST /api/analytics] */
export async function trackAnalytics(opts: { baseUrl?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl });
  return c.trackAnalytics(opts);
}

/** Stream or fetch operational logs [GET /api/logs] */
export async function getLogs(opts: { baseUrl?: string; accountKey?: string; query?: GetLogsQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.getLogs(opts);
}

/** Batch upload files [POST /api/storage/batch] */
export async function storageBatchUpload(opts: { baseUrl?: string; accessKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageBatchUpload(opts);
}

/** Delete file [DELETE /api/storage/{path}] */
export async function storageDelete(path: string, opts: { baseUrl?: string; accessKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageDelete(path, opts);
}

/** List directory or download file [GET /api/storage/{path}] */
export async function storageGetOrList(path: string, opts: { baseUrl?: string; accessKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageGetOrList(path, opts);
}

/** File metadata (HEAD) [HEAD /api/storage/{path}] */
export async function storageHead(path: string, opts: { baseUrl?: string; accessKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageHead(path, opts);
}

/** Upload file [PUT /api/storage/{path}] */
export async function storageUpload(path: string, opts: { baseUrl?: string; accessKey?: string; body?: Blob | ArrayBuffer | Uint8Array; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accessKey: opts.accessKey });
  return c.storageUpload(path, opts);
}

/** Delete a webhook [DELETE /api/webhooks] */
export async function deleteWebhook(opts: { baseUrl?: string; accountKey?: string; query?: DeleteWebhookQuery; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.deleteWebhook(opts);
}

/** List registered webhooks [GET /api/webhooks] */
export async function listWebhooks(opts: { baseUrl?: string; accountKey?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.listWebhooks(opts);
}

/** Register a webhook [POST /api/webhooks] */
export async function registerWebhook(opts: { baseUrl?: string; accountKey?: string; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const c = new CloudCDNClient({ baseUrl: opts.baseUrl, accountKey: opts.accountKey });
  return c.registerWebhook(opts);
}
