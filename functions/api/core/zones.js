/**
 * Core API — Zone Management (GitOps)
 *
 * GET  /api/core/zones          — List all tenant zones
 * POST /api/core/zones          — Create a new zone (Git commit)
 *
 * Auth: AccountKey header (env.ACCOUNT_KEY) — separated from StorageKey.
 */

import { checkRateLimit, errorResponse } from '../_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type',
  'Content-Type': 'application/json',
};

const STANDARD_DIRS = ['banners', 'github', 'icons', 'logos', 'titles'];

const RESERVED_NAMES = new Set(['stocks', 'shared', 'website', 'functions', 'api', 'dashboard', 'dist', 'content', 'global', 'clients', 'node_modules', '.git', '.github']);

function authenticate(request, env) {
  const key = request.headers.get('AccountKey');
  if (!env.ACCOUNT_KEY) return true; // dev mode
  return key === env.ACCOUNT_KEY;
}

function ghHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'CloudCDN-Core' };
}

/**
 * GET /api/core/zones — List all zones from manifest.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authenticate(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide your AccountKey in the request header to access zone management, analytics, and configuration endpoints. Contact support if you need a key.' }), { status: 401, headers: CORS });
  }

  // Rate limit: 60 req/minute per IP
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env.RATE_KV, `rl:zones:${ip}`, 60, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', 'Rate limit exceeded for zones endpoint. Maximum 60 requests per minute per IP address. Wait before retrying.', { retryAfter: '60', limit: rl.limit });
  }

  let manifest = [];
  try {
    const res = await env.ASSETS.fetch(new URL('/manifest.json', request.url));
    manifest = await res.json();
  } catch {}

  // Group by project (zone)
  const zones = {};
  for (const asset of manifest) {
    if (asset.project === 'stocks' || asset.project === 'shared') continue;
    if (!zones[asset.project]) {
      zones[asset.project] = { Id: asset.project, Name: asset.project, FileCount: 0, TotalSize: 0, Categories: new Set() };
    }
    zones[asset.project].FileCount++;
    zones[asset.project].TotalSize += asset.size;
    zones[asset.project].Categories.add(asset.category);
  }

  const result = Object.values(zones).map(z => ({
    Id: z.Id,
    Name: z.Name,
    StorageZoneName: 'cloudcdn',
    OriginUrl: `https://cloudcdn.pro/${z.Name}/`,
    FileCount: z.FileCount,
    StorageUsed: z.TotalSize,
    StorageUsedHuman: formatBytes(z.TotalSize),
    Categories: [...z.Categories].sort(),
    DateCreated: new Date().toISOString(),
    Enabled: true,
    Suspended: false,
  }));

  return new Response(JSON.stringify(result, null, 2), { headers: CORS });
}

/**
 * POST /api/core/zones — Create a new zone.
 * Body: { "Name": "newclient" }
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authenticate(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  // Rate limit: 60 req/minute per IP
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env.RATE_KV, `rl:zones:${ip}`, 60, 60);
  if (!rl.allowed) {
    return errorResponse(429, 'TooManyRequests', 'Rate limit exceeded for zones endpoint. Maximum 60 requests per minute per IP address. Wait before retrying.', { retryAfter: '60', limit: rl.limit });
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return new Response(JSON.stringify({ HttpCode: 501, Message: 'This operation requires the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings to enable GitOps mutations.' }), { status: 501, headers: CORS });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The request body contains invalid JSON and could not be parsed. Verify the payload is well-formed JSON with correct syntax, including matching brackets and properly quoted strings.' }), { status: 400, headers: CORS });
  }

  const name = (body.Name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!name || name.length < 2 || name.length > 64) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The zone name must be between 2 and 64 characters long and contain only lowercase alphanumeric characters and hyphens. Special characters, spaces, and uppercase letters are not allowed. Example valid names: "my-project", "acme-corp", "client2026".' }), { status: 400, headers: CORS });
  }

  if (RESERVED_NAMES.has(name)) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: `The zone name '${name}' is reserved and cannot be used. Reserved names include system directories and internal service paths. Choose a different name for your zone.` }), { status: 400, headers: CORS });
  }

  const repo = env.GITHUB_REPO;
  const headers = ghHeaders(env.GITHUB_TOKEN);

  try {
    // Check if zone already exists
    const check = await fetch(`https://api.github.com/repos/${repo}/contents/clients/${name}`, { headers });
    if (check.ok) {
      return new Response(JSON.stringify({ HttpCode: 409, Message: `Zone '${name}' already exists. A project directory with this name is already present in the repository. Choose a different name or use GET /api/core/zones/${name} to view the existing zone details.` }), { status: 409, headers: CORS });
    }

    // Get HEAD
    const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers });
    const headSha = (await refRes.json()).object.sha;
    const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits/${headSha}`, { headers });
    const baseTree = (await commitRes.json()).tree.sha;

    // Create tree with standard v1/ directories (.gitkeep in each)
    const treeEntries = STANDARD_DIRS.map(dir => ({
      path: `clients/${name}/v1/${dir}/.gitkeep`,
      mode: '100644',
      type: 'blob',
      content: '',
    }));

    const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
      method: 'POST', headers,
      body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }),
    });
    const treeSha = (await treeRes.json()).sha;

    // Commit
    const newCommit = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
      method: 'POST', headers,
      body: JSON.stringify({ message: `feat: create zone '${name}' via Core API [skip ci]`, parents: [headSha], tree: treeSha }),
    });
    const commitSha = (await newCommit.json()).sha;

    // Update ref
    await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/main`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ sha: commitSha }),
    });

    return new Response(JSON.stringify({
      HttpCode: 201,
      Message: `Zone '${name}' created successfully. The zone directory structure has been committed to the repository and will be available at the edge after the CI/CD pipeline completes deployment (approximately 60-90 seconds).`,
      Id: name,
      Name: name,
      OriginUrl: `https://cloudcdn.pro/${name}/`,
      Commit: commitSha,
      Directories: STANDARD_DIRS,
      EdgeStatus: 'pending',
      EdgeNote: 'Zone will be live after CI/CD deploy (~60-90 seconds).',
      DateCreated: new Date().toISOString(),
    }, null, 2), { status: 201, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ HttpCode: 500, Message: 'The zone creation failed due to an unexpected error while committing the directory structure to the repository. Verify your GITHUB_TOKEN has write permissions and try again. Detail: ' + err.message }), { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
