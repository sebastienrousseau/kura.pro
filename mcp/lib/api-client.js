/**
 * CloudCDN API client — a small `fetch` wrapper used by every MCP tool.
 *
 * Reads configuration from environment variables (the MCP host populates
 * them via the `env` block in its config file):
 *
 *   CLOUDCDN_BASE_URL       — API base URL (default: https://cloudcdn.pro)
 *   CLOUDCDN_ACCESS_KEY     — AccessKey header (storage, assets, insights)
 *   CLOUDCDN_ACCOUNT_KEY    — AccountKey header (core, pipeline, audit, …)
 *   CLOUDCDN_PURGE_KEY      — x-api-key header (cache purge)
 *   CLOUDCDN_ANALYTICS_KEY  — x-api-key header (analytics endpoints)
 *
 * Public surface:
 *
 *   get(path, opts)           — GET
 *   post(path, body, opts)    — POST  (JSON body if not a typed array)
 *   put(path, body, opts)     — PUT
 *   del(path, opts)           — DELETE
 *   head(path, opts)          — HEAD
 *   BASE_URL                  — resolved base URL (read-only)
 *
 * Each helper returns `{ ok: boolean, status: number, data: unknown }`.
 * For non-JSON responses, `data` is `{ contentType, contentLength, url }`
 * (no body parsing — useful for binary endpoints like /api/transform).
 *
 * @module @cloudcdn/mcp-server/api-client
 */

const BASE_URL = process.env.CLOUDCDN_BASE_URL || 'https://cloudcdn.pro';

/**
 * Resolves the auth headers for a request, based on which auth name the
 * caller picked. Each entry is a thunk so the env vars are read at call
 * time (not at module load) — keeps tests reliable.
 *
 * @type {Record<'access'|'account'|'purge'|'analytics'|'none', () => Record<string, string>>}
 */
const AUTH_HEADERS = {
  access: () => {
    const key = process.env.CLOUDCDN_ACCESS_KEY;
    return key ? { AccessKey: key } : {};
  },
  account: () => {
    const key = process.env.CLOUDCDN_ACCOUNT_KEY;
    return key ? { AccountKey: key } : {};
  },
  purge: () => {
    const key = process.env.CLOUDCDN_PURGE_KEY;
    return key ? { 'x-api-key': key } : {};
  },
  analytics: () => {
    const key = process.env.CLOUDCDN_ANALYTICS_KEY;
    return key ? { 'x-api-key': key } : {};
  },
  none: () => ({}),
};

/**
 * Builds an absolute URL with serialized query params.
 *
 * Undefined and null param values are silently dropped — that lets call
 * sites pass `{ project, format }` even when one of them is unset.
 *
 * @param {string} path - Relative API path (e.g. `/api/assets`).
 * @param {Record<string, unknown>} [params] - Query string parameters.
 * @returns {string} Fully qualified URL.
 */
function buildUrl(path, params = {}) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Issues a request and returns the structured response shape used by every
 * MCP tool handler. Internal — call {@link get}/{@link post}/etc. instead.
 *
 * @param {string} method - HTTP verb.
 * @param {string} path - Relative API path.
 * @param {object} [opts]
 * @param {'access'|'account'|'purge'|'analytics'|'none'} [opts.auth='none'] - Auth profile.
 * @param {Record<string, unknown>} [opts.params] - Query string parameters.
 * @param {unknown} [opts.body] - Request body (JSON-serialized unless ArrayBuffer/Uint8Array).
 * @param {Record<string, string>} [opts.headers] - Extra request headers.
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
async function request(method, path, { auth = 'none', params, body, headers: extra } = {}) {
  const url = buildUrl(path, params);
  const authHeaders = AUTH_HEADERS[auth]?.() || {};

  const headers = {
    ...authHeaders,
    ...extra,
  };

  const opts = { method, headers };

  if (body !== undefined) {
    if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
      opts.body = body;
    } else {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url, opts);
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  }

  // Non-JSON — return metadata only (binary responses are not buffered).
  return {
    ok: res.ok,
    status: res.status,
    data: {
      contentType,
      contentLength: res.headers.get('content-length'),
      url,
    },
  };
}

/**
 * GET — no request body.
 * @param {string} path
 * @param {Parameters<typeof request>[2]} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export function get(path, opts) {
  return request('GET', path, opts);
}

/**
 * POST — JSON-serialised body unless a typed array is given.
 * @param {string} path
 * @param {unknown} body
 * @param {Parameters<typeof request>[2]} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export function post(path, body, opts = {}) {
  return request('POST', path, { ...opts, body });
}

/**
 * PUT — JSON body by default, raw bytes if `body` is an ArrayBuffer / Uint8Array.
 * @param {string} path
 * @param {unknown} body
 * @param {Parameters<typeof request>[2]} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export function put(path, body, opts = {}) {
  return request('PUT', path, { ...opts, body });
}

/**
 * DELETE — no request body.
 * @param {string} path
 * @param {Parameters<typeof request>[2]} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export function del(path, opts) {
  return request('DELETE', path, opts);
}

/**
 * HEAD — no request body, no response body.
 * @param {string} path
 * @param {Parameters<typeof request>[2]} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export function head(path, opts) {
  return request('HEAD', path, opts);
}

export { BASE_URL };
