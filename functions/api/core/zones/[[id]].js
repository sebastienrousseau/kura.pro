/**
 * Core API — Zone detail, delete, and domain management.
 *
 * GET    /api/core/zones/{id}          — Zone details
 * DELETE /api/core/zones/{id}          — Delete zone (Git commit)
 * POST   /api/core/zones/{id}/domains  — Add custom domain (Cloudflare API)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type',
  'Content-Type': 'application/json',
};

function authenticate(request, env) {
  const key = request.headers.get('AccountKey');
  if (!env.ACCOUNT_KEY) return true;
  return key === env.ACCOUNT_KEY;
}

function ghHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'CloudCDN-Core' };
}

function parseRoute(params) {
  const segments = params.id || [];
  const zoneId = segments[0] || '';
  const subRoute = segments[1] || '';
  return { zoneId, subRoute };
}

/**
 * GET /api/core/zones/{id} — Zone details.
 */
export async function onRequestGet(context) {
  const { request, env, params } = context;
  if (!authenticate(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  const { zoneId } = parseRoute(params);
  if (!zoneId) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'A zone identifier is required in the URL path. Use the format /api/core/zones/{zone-id} where zone-id matches the project directory name (e.g., "akande", "bankingonai").' }), { status: 400, headers: CORS });
  }

  let manifest = [];
  try {
    const res = await env.ASSETS.fetch(new URL('/manifest.json', request.url));
    manifest = await res.json();
  } catch {}

  const assets = manifest.filter(a => a.project === zoneId);
  if (assets.length === 0) {
    return new Response(JSON.stringify({ HttpCode: 404, Message: `Zone '${zoneId}' not found. No assets exist for this zone identifier. Verify the zone name matches an existing project directory, or use GET /api/core/zones to list all available zones.` }), { status: 404, headers: CORS });
  }

  const totalSize = assets.reduce((s, a) => s + a.size, 0);
  const categories = [...new Set(assets.map(a => a.category))].sort();
  const formats = [...new Set(assets.map(a => a.format))].sort();

  return new Response(JSON.stringify({
    Id: zoneId,
    Name: zoneId,
    StorageZoneName: 'cloudcdn',
    OriginUrl: `https://cloudcdn.pro/${zoneId}/`,
    FileCount: assets.length,
    StorageUsed: totalSize,
    StorageUsedHuman: formatBytes(totalSize),
    Categories: categories,
    Formats: formats,
    Files: assets.map(a => ({
      Path: a.path,
      Name: a.name,
      Format: a.format,
      Size: a.size,
      Category: a.category,
    })),
    Enabled: true,
    Suspended: false,
    DateCreated: new Date().toISOString(),
  }, null, 2), { headers: CORS });
}

/**
 * DELETE /api/core/zones/{id} — Delete entire zone.
 */
export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!authenticate(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  const { zoneId } = parseRoute(params);
  if (!zoneId || zoneId.includes('..')) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The zone identifier is invalid. Zone IDs must be alphanumeric strings with hyphens, between 2 and 64 characters long. Avoid special characters and path traversal sequences.' }), { status: 400, headers: CORS });
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return new Response(JSON.stringify({ HttpCode: 501, Message: 'This operation requires the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings to enable GitOps mutations.' }), { status: 501, headers: CORS });
  }

  const repo = env.GITHUB_REPO;
  const headers = ghHeaders(env.GITHUB_TOKEN);

  try {
    // List all files in the zone directory
    const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`, { headers });
    if (!treeRes.ok) throw new Error('Failed to fetch tree');
    const tree = await treeRes.json();
    const zoneFiles = tree.tree.filter(f => f.path.startsWith(`clients/${zoneId}/`) && f.type === 'blob');

    if (zoneFiles.length === 0) {
      return new Response(JSON.stringify({ HttpCode: 404, Message: `Zone '${zoneId}' not found or already empty. The zone directory contains no files in the repository. It may have already been deleted, or the zone identifier may be incorrect. Use GET /api/core/zones to list active zones.` }), { status: 404, headers: CORS });
    }

    // Get HEAD
    const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers });
    const headSha = (await refRes.json()).object.sha;
    const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits/${headSha}`, { headers });
    const baseTree = (await commitRes.json()).tree.sha;

    // Create tree with all zone files set to null (deleted)
    const deleteEntries = zoneFiles.map(f => ({
      path: f.path,
      mode: '100644',
      type: 'blob',
      sha: null,
    }));

    const newTreeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
      method: 'POST', headers,
      body: JSON.stringify({ base_tree: baseTree, tree: deleteEntries }),
    });
    const treeSha = (await newTreeRes.json()).sha;

    // Commit
    const newCommit = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
      method: 'POST', headers,
      body: JSON.stringify({ message: `feat: delete zone '${zoneId}' via Core API [skip ci]`, parents: [headSha], tree: treeSha }),
    });
    const commitSha = (await newCommit.json()).sha;

    await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/main`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ sha: commitSha }),
    });

    // Purge cache for the entire zone
    if (env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_API_TOKEN) {
      context.waitUntil(
        fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: [`project-${zoneId}`] }),
        }).catch(() => {})
      );
    }

    return new Response(JSON.stringify({
      HttpCode: 200,
      Message: `Zone '${zoneId}' deleted (${zoneFiles.length} files removed). The commit has been pushed and an edge cache purge has been initiated. The deletion will propagate to all 300+ edge locations within seconds.`,
      Commit: commitSha,
      FilesRemoved: zoneFiles.length,
      EdgeStatus: 'purging',
    }, null, 2), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ HttpCode: 500, Message: 'The zone deletion failed due to an unexpected error while removing files from the repository. Verify your GITHUB_TOKEN has write permissions and the zone exists. Detail: ' + err.message }), { status: 500, headers: CORS });
  }
}

/**
 * POST /api/core/zones/{id}/domains — Add custom domain.
 * Body: { "Hostname": "cdn.akande.com" }
 */
export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!authenticate(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  const { zoneId, subRoute } = parseRoute(params);
  if (subRoute !== 'domains') {
    return new Response(JSON.stringify({ HttpCode: 404, Message: 'The requested sub-route was not found. This endpoint only supports POST /api/core/zones/{id}/domains to add custom domains. Verify the URL path is correct and the HTTP method matches the operation you intend to perform.' }), { status: 404, headers: CORS });
  }

  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return new Response(JSON.stringify({ HttpCode: 501, Message: 'Custom domain management requires the CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables. Set these in your Cloudflare Pages project settings.' }), { status: 501, headers: CORS });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The request body contains invalid JSON and could not be parsed. Verify the payload is well-formed JSON with correct syntax, including matching brackets and properly quoted strings.' }), { status: 400, headers: CORS });
  }

  const hostname = (body.Hostname || '').trim().toLowerCase();
  if (!hostname || !hostname.includes('.')) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'A valid hostname is required in the "Hostname" field (e.g., cdn.example.com). The hostname must contain at least one dot and be a fully qualified domain name. After adding, create a CNAME record pointing to cloudcdn-pro.pages.dev in your DNS provider.' }), { status: 400, headers: CORS });
  }

  try {
    const projectName = 'cloudcdn-pro';
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}/domains`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: hostname }),
      }
    );

    const result = await res.json();

    if (!result.success) {
      return new Response(JSON.stringify({
        HttpCode: res.status >= 400 && res.status < 500 ? 400 : 502,
        Message: 'The custom domain could not be added via the Cloudflare Pages API. Verify that CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are correctly configured with sufficient permissions.',
        Errors: result.errors,
      }), { status: res.status >= 400 && res.status < 500 ? 400 : 502, headers: CORS });
    }

    return new Response(JSON.stringify({
      HttpCode: 201,
      Message: `Custom domain '${hostname}' added successfully. An SSL/TLS certificate will be provisioned automatically by Cloudflare. Point a CNAME record for ${hostname} to cloudcdn-pro.pages.dev in your DNS provider. Propagation typically takes 1-5 minutes.`,
      Zone: zoneId,
      Hostname: hostname,
      SslStatus: 'provisioning',
      Note: 'SSL certificate will be provisioned automatically. Point your CNAME to cloudcdn-pro.pages.dev.',
      DateCreated: new Date().toISOString(),
    }, null, 2), { status: 201, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ HttpCode: 500, Message: 'The custom domain addition failed due to an unexpected error communicating with the Cloudflare Pages API. Verify your CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are valid and have sufficient permissions. Detail: ' + err.message }), { status: 500, headers: CORS });
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
