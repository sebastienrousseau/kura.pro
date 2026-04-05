import { log } from '../_shared.js';

/**
 * Core API — Edge Rules Management.
 *
 * GET  /api/core/rules          — Read current _headers and _redirects
 * POST /api/core/rules          — Update _headers or _redirects via Git commit
 *
 * Auth: AccountKey header (env.ACCOUNT_KEY).
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type',
  'Content-Type': 'application/json',
};

const ALLOWED_FILES = new Set(['_headers', '_redirects']);

function authenticate(request, env) {
  const key = request.headers.get('AccountKey');
  if (!env.ACCOUNT_KEY) return true;
  return key === env.ACCOUNT_KEY;
}

function ghHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'CloudCDN-Core' };
}

async function ghFetch(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * GET /api/core/rules — Read current edge rules.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authenticate(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  const rules = {};
  for (const file of ALLOWED_FILES) {
    try {
      const res = await env.ASSETS.fetch(new URL(`/${file}`, request.url));
      rules[file] = res.ok ? await res.text() : null;
    } catch {
      rules[file] = null;
    }
  }

  return new Response(JSON.stringify({
    Headers: rules['_headers'],
    Redirects: rules['_redirects'],
    Editable: [...ALLOWED_FILES],
    DateFetched: new Date().toISOString(),
  }, null, 2), { headers: CORS });
}

/**
 * POST /api/core/rules — Update an edge rule file.
 * Body: { "File": "_headers", "Content": "/*.webp\n  Cache-Control: ..." }
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authenticate(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return new Response(JSON.stringify({ HttpCode: 501, Message: 'This operation requires the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings to enable GitOps mutations.' }), { status: 501, headers: CORS });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The request body contains invalid JSON and could not be parsed. Verify the payload is well-formed JSON with correct syntax, including matching brackets and properly quoted strings.' }), { status: 400, headers: CORS });
  }

  const file = body.File;
  const content = body.Content;

  if (!ALLOWED_FILES.has(file)) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: `The "File" field must be one of: ${[...ALLOWED_FILES].join(', ')}. Only Cloudflare Pages edge configuration files are supported. Provide the filename as a string in the request body JSON under the "File" key.` }), { status: 400, headers: CORS });
  }
  if (typeof content !== 'string') {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The "Content" field must be a string containing the file contents. For _headers and _redirects files, provide the full file content as a single string with newline characters.' }), { status: 400, headers: CORS });
  }
  if (new TextEncoder().encode(content).length > 100000) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The submitted content exceeds the 100 KB size limit for edge configuration files. Reduce the content size by removing unnecessary rules or consolidating duplicate entries.' }), { status: 400, headers: CORS });
  }

  const repo = env.GITHUB_REPO;
  const headers = ghHeaders(env.GITHUB_TOKEN);

  try {
    // Get current file SHA
    let sha;
    try {
      const existing = await ghFetch(`https://api.github.com/repos/${repo}/contents/${file}`, { headers });
      if (existing.ok) sha = (await existing.json()).sha;
    } catch {}

    const base64Content = btoa(unescape(encodeURIComponent(content)));

    const payload = {
      message: `chore: update ${file} via Core API [skip ci]`,
      content: base64Content,
      branch: 'main',
    };
    if (sha) payload.sha = sha;

    const res = await ghFetch(`https://api.github.com/repos/${repo}/contents/${file}`, {
      method: 'PUT', headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ HttpCode: 502, Message: 'The edge configuration update failed. Verify your credentials and try again.' }), { status: 502, headers: CORS });
    }

    const result = await res.json();

    return new Response(JSON.stringify({
      HttpCode: 200,
      Message: `${file} updated successfully. The change has been committed to the repository and will be deployed to all edge locations after the CI/CD pipeline completes (approximately 60-90 seconds).`,
      File: file,
      Commit: result.commit?.sha,
      EdgeStatus: 'pending',
      EdgeNote: 'Edge rules will take effect after CI/CD deploy (~60-90 seconds).',
      DateModified: new Date().toISOString(),
    }, null, 2), { status: 200, headers: CORS });
  } catch (err) {
    log.error('RULES_UPDATE_ERROR', err.message);
    return new Response(JSON.stringify({ HttpCode: 500, Message: 'The edge rules update failed due to an unexpected error. Verify your credentials and try again.' }), { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}
