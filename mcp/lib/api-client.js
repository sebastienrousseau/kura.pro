/**
 * CloudCDN API client — thin HTTP wrapper for MCP tool handlers.
 *
 * Reads configuration from environment variables:
 *   CLOUDCDN_BASE_URL     — API base URL (default: https://cloudcdn.pro)
 *   CLOUDCDN_ACCESS_KEY   — AccessKey header (storage, assets, insights)
 *   CLOUDCDN_ACCOUNT_KEY  — AccountKey header (core, insights)
 *   CLOUDCDN_PURGE_KEY    — x-api-key header (cache purge)
 *   CLOUDCDN_ANALYTICS_KEY — x-api-key header (analytics)
 */

const BASE_URL = process.env.CLOUDCDN_BASE_URL || 'https://cloudcdn.pro';

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

function buildUrl(path, params = {}) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

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

  // Non-JSON — return metadata only (binary responses)
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

export function get(path, opts) {
  return request('GET', path, opts);
}

export function post(path, body, opts = {}) {
  return request('POST', path, { ...opts, body });
}

export function put(path, body, opts = {}) {
  return request('PUT', path, { ...opts, body });
}

export function del(path, opts) {
  return request('DELETE', path, opts);
}

export function head(path, opts) {
  return request('HEAD', path, opts);
}

export { BASE_URL };
