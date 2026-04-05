// CloudCDN API Client — JavaScript (ES Module)
// Auto-generated from openapi.json — do not edit manually
//
// Base URL: https://cloudcdn.pro

const BASE_URL = "https://cloudcdn.pro";

/**
 * Internal helper — sends a request and returns parsed JSON or raw Response.
 */
async function _request(method, path, { headers = {}, body, query, raw = false } = {}) {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: { ...headers, ...(body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}) },
    body: body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array) ? JSON.stringify(body) : body,
  });
  if (raw) return res;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.Message || err.error || "Request failed"), { status: res.status, body: err });
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

/** List assets [GET /api/assets] */
export async function listAssets(query = {}, apiKey) {
  return _request("GET", `/api/assets`, { headers: { "AccessKey": apiKey }, query });
}

/** Get asset metadata [GET /api/assets/metadata] */
export async function getAssetMetadata(query = {}, apiKey) {
  return _request("GET", `/api/assets/metadata`, { headers: { "AccessKey": apiKey }, query });
}

/** List directory or download file [GET /api/storage/{path}] */
export async function storageGetOrList(path, apiKey) {
  return _request("GET", `/api/storage/${path}`, { headers: { "AccessKey": apiKey } });
}

/** Upload file [PUT /api/storage/{path}] */
export async function storageUpload(path, body, apiKey) {
  return _request("PUT", `/api/storage/${path}`, { headers: { "AccessKey": apiKey, "Content-Type": "application/octet-stream" }, body });
}

/** Delete file [DELETE /api/storage/{path}] */
export async function storageDelete(path, apiKey) {
  return _request("DELETE", `/api/storage/${path}`, { headers: { "AccessKey": apiKey } });
}

/** File metadata (HEAD) [HEAD /api/storage/{path}] */
export async function storageHead(path, apiKey) {
  return _request("HEAD", `/api/storage/${path}`, { headers: { "AccessKey": apiKey }, raw: true });
}

/** Batch upload files [POST /api/storage/batch] */
export async function storageBatchUpload(body, apiKey) {
  return _request("POST", `/api/storage/batch`, { headers: { "AccessKey": apiKey }, body });
}

/** List all zones [GET /api/core/zones] */
export async function listZones(apiKey) {
  return _request("GET", `/api/core/zones`, { headers: { "AccountKey": apiKey } });
}

/** Create a new zone [POST /api/core/zones] */
export async function createZone(body, apiKey) {
  return _request("POST", `/api/core/zones`, { headers: { "AccountKey": apiKey }, body });
}

/** Get zone details [GET /api/core/zones/{id}] */
export async function getZone(id, apiKey) {
  return _request("GET", `/api/core/zones/${id}`, { headers: { "AccountKey": apiKey } });
}

/** Delete zone [DELETE /api/core/zones/{id}] */
export async function deleteZone(id, apiKey) {
  return _request("DELETE", `/api/core/zones/${id}`, { headers: { "AccountKey": apiKey } });
}

/** Add custom domain to zone [POST /api/core/zones/{id}/domains] */
export async function addDomain(id, body, apiKey) {
  return _request("POST", `/api/core/zones/${id}/domains`, { headers: { "AccountKey": apiKey }, body });
}

/** Get edge statistics [GET /api/core/statistics] */
export async function getStatistics(query = {}, apiKey) {
  return _request("GET", `/api/core/statistics`, { headers: { "AccountKey": apiKey }, query });
}

/** Read edge rules [GET /api/core/rules] */
export async function getRules(apiKey) {
  return _request("GET", `/api/core/rules`, { headers: { "AccountKey": apiKey } });
}

/** Update edge rules [POST /api/core/rules] */
export async function updateRules(body, apiKey) {
  return _request("POST", `/api/core/rules`, { headers: { "AccountKey": apiKey }, body });
}

/** Analytics summary [GET /api/insights/summary] */
export async function getInsightsSummary(query = {}, apiKey) {
  return _request("GET", `/api/insights/summary`, { headers: { "AccountKey": apiKey }, query });
}

/** Top requested assets [GET /api/insights/top-assets] */
export async function getTopAssets(query = {}, apiKey) {
  return _request("GET", `/api/insights/top-assets`, { headers: { "AccountKey": apiKey }, query });
}

/** Geographic distribution [GET /api/insights/geography] */
export async function getGeography(query = {}, apiKey) {
  return _request("GET", `/api/insights/geography`, { headers: { "AccountKey": apiKey }, query });
}

/** Error tracking [GET /api/insights/errors] */
export async function getErrors(query = {}, apiKey) {
  return _request("GET", `/api/insights/errors`, { headers: { "AccountKey": apiKey }, query });
}

/** Transform image [GET /api/transform] */
export async function transformImage(query = {}) {
  return _request("GET", `/api/transform`, { headers: {}, query, raw: true });
}

/** Automatic format negotiation [GET /api/auto] */
export async function autoFormat(query = {}) {
  return _request("GET", `/api/auto`, { headers: {}, query, raw: true });
}

/** Verify signed URL [GET /api/signed] */
export async function verifySignedUrl(query = {}) {
  return _request("GET", `/api/signed`, { headers: {}, query, raw: true });
}

/** HLS video streaming [GET /api/stream] */
export async function streamVideo(query = {}) {
  return _request("GET", `/api/stream`, { headers: {}, query, raw: true });
}

/** Purge CDN cache [POST /api/purge] */
export async function purgeCache(body, apiKey) {
  return _request("POST", `/api/purge`, { headers: { "x-api-key": apiKey }, body });
}

/** Get analytics report [GET /api/analytics] */
export async function getAnalytics(query = {}, apiKey) {
  return _request("GET", `/api/analytics`, { headers: { "x-api-key": apiKey }, query });
}

/** Record analytics hit [POST /api/analytics] */
export async function trackAnalytics(body) {
  return _request("POST", `/api/analytics`, { headers: {}, body });
}

/** Semantic asset search [GET /api/search] */
export async function searchAssets(query = {}) {
  return _request("GET", `/api/search`, { headers: {}, query });
}

/** AI Chat Concierge [POST /api/chat] */
export async function chatConcierge(body) {
  return _request("POST", `/api/chat`, { headers: {}, body });
}
