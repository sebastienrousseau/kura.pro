// CloudCDN API Client — TypeScript
// Auto-generated from openapi.json — do not edit manually
//
// Base URL: https://cloudcdn.pro

const BASE_URL = "https://cloudcdn.pro";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListAssetsQuery {
  project?: string;
  category?: string;
  format?: string;
  q?: string;
  page?: number;
  per_page?: number;
  sort?: string;
  order?: string;
}

export interface GetAssetMetadataQuery {
  path: string;
}

export interface GetStatisticsQuery {
  days?: number;
  zone?: string;
}

export interface GetInsightsSummaryQuery {
  days?: number;
  zone?: string;
}

export interface GetTopAssetsQuery {
  days?: number;
  limit?: number;
}

export interface GetGeographyQuery {
  days?: number;
}

export interface GetErrorsQuery {
  days?: number;
}

export interface TransformImageQuery {
  url: string;
  w?: number;
  h?: number;
  fit?: string;
  format?: string;
  q?: number;
  blur?: number;
  sharpen?: number;
  gravity?: string;
}

export interface AutoFormatQuery {
  path: string;
}

export interface VerifySignedUrlQuery {
  path: string;
  expires: number;
  sig: string;
}

export interface StreamVideoQuery {
  video: string;
  quality?: string;
  segment?: number;
}

export interface GetAnalyticsQuery {
  days?: number;
}

export interface SearchAssetsQuery {
  q: string;
  limit?: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  raw?: boolean;
}

async function _request(method: string, path: string, opts: RequestOptions = {}): Promise<unknown> {
  const url = new URL(path, BASE_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const isJson = opts.body && typeof opts.body === 'object' && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer) && !(opts.body instanceof Uint8Array);
  const res = await fetch(url.toString(), {
    method,
    headers: { ...opts.headers, ...(isJson ? { "Content-Type": "application/json" } : {}) },
    body: isJson ? JSON.stringify(opts.body) : (opts.body as BodyInit | undefined),
  });
  if (opts.raw) return res;
  if (!res.ok) {
    const err: Record<string, unknown> = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error((err.Message || err.error || "Request failed") as string), { status: res.status, body: err });
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

/** List assets [GET /api/assets] */
export async function listAssets(query?: Partial<ListAssetsQuery>, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/assets`, { headers: { "AccessKey": apiKey }, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** Get asset metadata [GET /api/assets/metadata] */
export async function getAssetMetadata(query?: Partial<GetAssetMetadataQuery>, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/assets/metadata`, { headers: { "AccessKey": apiKey }, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** List directory or download file [GET /api/storage/{path}] */
export async function storageGetOrList(path: string, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/storage/${path}`, { headers: { "AccessKey": apiKey } }) as Promise<unknown>;
}

/** Upload file [PUT /api/storage/{path}] */
export async function storageUpload(path: string, body: Blob | ArrayBuffer | Uint8Array, apiKey: string): Promise<unknown> {
  return _request("PUT", `/api/storage/${path}`, { headers: { "AccessKey": apiKey, "Content-Type": "application/octet-stream" }, body }) as Promise<unknown>;
}

/** Delete file [DELETE /api/storage/{path}] */
export async function storageDelete(path: string, apiKey: string): Promise<unknown> {
  return _request("DELETE", `/api/storage/${path}`, { headers: { "AccessKey": apiKey } }) as Promise<unknown>;
}

/** File metadata (HEAD) [HEAD /api/storage/{path}] */
export async function storageHead(path: string, apiKey: string): Promise<Response> {
  return _request("HEAD", `/api/storage/${path}`, { headers: { "AccessKey": apiKey }, raw: true }) as Promise<Response>;
}

/** Batch upload files [POST /api/storage/batch] */
export async function storageBatchUpload(body: Record<string, unknown>, apiKey: string): Promise<unknown> {
  return _request("POST", `/api/storage/batch`, { headers: { "AccessKey": apiKey }, body }) as Promise<unknown>;
}

/** List all zones [GET /api/core/zones] */
export async function listZones(apiKey: string): Promise<unknown> {
  return _request("GET", `/api/core/zones`, { headers: { "AccountKey": apiKey } }) as Promise<unknown>;
}

/** Create a new zone [POST /api/core/zones] */
export async function createZone(body: Record<string, unknown>, apiKey: string): Promise<unknown> {
  return _request("POST", `/api/core/zones`, { headers: { "AccountKey": apiKey }, body }) as Promise<unknown>;
}

/** Get zone details [GET /api/core/zones/{id}] */
export async function getZone(id: string, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/core/zones/${id}`, { headers: { "AccountKey": apiKey } }) as Promise<unknown>;
}

/** Delete zone [DELETE /api/core/zones/{id}] */
export async function deleteZone(id: string, apiKey: string): Promise<unknown> {
  return _request("DELETE", `/api/core/zones/${id}`, { headers: { "AccountKey": apiKey } }) as Promise<unknown>;
}

/** Add custom domain to zone [POST /api/core/zones/{id}/domains] */
export async function addDomain(id: string, body: Record<string, unknown>, apiKey: string): Promise<unknown> {
  return _request("POST", `/api/core/zones/${id}/domains`, { headers: { "AccountKey": apiKey }, body }) as Promise<unknown>;
}

/** Get edge statistics [GET /api/core/statistics] */
export async function getStatistics(query?: Partial<GetStatisticsQuery>, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/core/statistics`, { headers: { "AccountKey": apiKey }, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** Read edge rules [GET /api/core/rules] */
export async function getRules(apiKey: string): Promise<unknown> {
  return _request("GET", `/api/core/rules`, { headers: { "AccountKey": apiKey } }) as Promise<unknown>;
}

/** Update edge rules [POST /api/core/rules] */
export async function updateRules(body: Record<string, unknown>, apiKey: string): Promise<unknown> {
  return _request("POST", `/api/core/rules`, { headers: { "AccountKey": apiKey }, body }) as Promise<unknown>;
}

/** Analytics summary [GET /api/insights/summary] */
export async function getInsightsSummary(query?: Partial<GetInsightsSummaryQuery>, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/insights/summary`, { headers: { "AccountKey": apiKey }, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** Top requested assets [GET /api/insights/top-assets] */
export async function getTopAssets(query?: Partial<GetTopAssetsQuery>, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/insights/top-assets`, { headers: { "AccountKey": apiKey }, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** Geographic distribution [GET /api/insights/geography] */
export async function getGeography(query?: Partial<GetGeographyQuery>, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/insights/geography`, { headers: { "AccountKey": apiKey }, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** Error tracking [GET /api/insights/errors] */
export async function getErrors(query?: Partial<GetErrorsQuery>, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/insights/errors`, { headers: { "AccountKey": apiKey }, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** Transform image [GET /api/transform] */
export async function transformImage(query?: Partial<TransformImageQuery>): Promise<Response> {
  return _request("GET", `/api/transform`, { headers: {}, query: query as Record<string, string | number | boolean | undefined>, raw: true }) as Promise<Response>;
}

/** Automatic format negotiation [GET /api/auto] */
export async function autoFormat(query?: Partial<AutoFormatQuery>): Promise<Response> {
  return _request("GET", `/api/auto`, { headers: {}, query: query as Record<string, string | number | boolean | undefined>, raw: true }) as Promise<Response>;
}

/** Verify signed URL [GET /api/signed] */
export async function verifySignedUrl(query?: Partial<VerifySignedUrlQuery>): Promise<Response> {
  return _request("GET", `/api/signed`, { headers: {}, query: query as Record<string, string | number | boolean | undefined>, raw: true }) as Promise<Response>;
}

/** HLS video streaming [GET /api/stream] */
export async function streamVideo(query?: Partial<StreamVideoQuery>): Promise<Response> {
  return _request("GET", `/api/stream`, { headers: {}, query: query as Record<string, string | number | boolean | undefined>, raw: true }) as Promise<Response>;
}

/** Purge CDN cache [POST /api/purge] */
export async function purgeCache(body: Record<string, unknown>, apiKey: string): Promise<unknown> {
  return _request("POST", `/api/purge`, { headers: { "x-api-key": apiKey }, body }) as Promise<unknown>;
}

/** Get analytics report [GET /api/analytics] */
export async function getAnalytics(query?: Partial<GetAnalyticsQuery>, apiKey: string): Promise<unknown> {
  return _request("GET", `/api/analytics`, { headers: { "x-api-key": apiKey }, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** Record analytics hit [POST /api/analytics] */
export async function trackAnalytics(body: Record<string, unknown>): Promise<unknown> {
  return _request("POST", `/api/analytics`, { headers: {}, body }) as Promise<unknown>;
}

/** Semantic asset search [GET /api/search] */
export async function searchAssets(query?: Partial<SearchAssetsQuery>): Promise<unknown> {
  return _request("GET", `/api/search`, { headers: {}, query: query as Record<string, string | number | boolean | undefined> }) as Promise<unknown>;
}

/** AI Chat Concierge [POST /api/chat] */
export async function chatConcierge(body: Record<string, unknown>): Promise<unknown> {
  return _request("POST", `/api/chat`, { headers: {}, body }) as Promise<unknown>;
}
