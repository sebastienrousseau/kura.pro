/**
 * Asset ingestion pipeline — single SVG upload generates a full asset scaffold.
 *
 * POST /api/pipeline
 * Auth: AccountKey (control-plane operation)
 *
 * Accepts JSON body with mode, name, svg (base64), and optional generation flags.
 * Creates logos, icons, and directory scaffolding via the GitHub Git Database API.
 */

import { authenticateAccount, errorResponse, jsonResponse, fetchWithTimeout, log, cdnOrigin } from './_shared.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type',
  'Content-Type': 'application/json',
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'CloudCDN-Pipeline',
  };
}

/**
 * Sanitize SVG content — strip dangerous elements and attributes.
 * Exported for testing.
 */
export function sanitizeSvg(svgContent) {
  let svg = svgContent;
  // Remove <script> blocks (with content)
  svg = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  // Remove self-closing <script />
  svg = svg.replace(/<script[^>]*\/>/gi, '');
  // Remove event handler attributes (onclick, onerror, onload, etc.)
  svg = svg.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: URIs in any attribute
  svg = svg.replace(/(href|xlink:href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1=""');
  // Remove data: URIs that contain script
  svg = svg.replace(/(href|xlink:href)\s*=\s*(?:"data:text\/html[^"]*"|'data:text\/html[^']*')/gi, '$1=""');
  return svg;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Auth: AccountKey required
  if (!authenticateAccount(request, env)) {
    return errorResponse(401, 'Unauthorized', 'AccountKey header is required for pipeline operations. This is a control-plane endpoint that creates infrastructure assets.');
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return errorResponse(501, 'NotConfigured', 'Pipeline requires GITHUB_TOKEN and GITHUB_REPO environment variables. Configure these in your Cloudflare Pages project settings.');
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'InvalidBody', 'Request body must be valid JSON with fields: mode, name, svg. Optional: generateFavicon, generateIcons, generateBanners.');
  }

  const { mode, name, svg, generateFavicon = true, generateIcons = true, generateBanners = true } = body;

  // Validate mode
  if (!mode || (mode !== 'client' && mode !== 'stock')) {
    return errorResponse(400, 'InvalidMode', 'The "mode" field must be either "client" or "stock". Client mode scaffolds a full zone directory; stock mode uploads to the shared image library.');
  }

  // Validate name (required for client, optional for stock)
  if (mode === 'client') {
    if (!name || typeof name !== 'string') {
      return errorResponse(400, 'MissingName', 'The "name" field is required for client mode. Provide a slugified zone name (2-64 characters, lowercase alphanumeric and hyphens).');
    }
    if (!NAME_RE.test(name)) {
      return errorResponse(400, 'InvalidName', `Name "${name}" is invalid. Must be 2-64 characters, lowercase alphanumeric and hyphens only, starting and ending with an alphanumeric character.`);
    }
  }

  // Validate SVG data
  if (!svg || typeof svg !== 'string') {
    return errorResponse(400, 'MissingSvg', 'The "svg" field is required and must contain the SVG data as a base64-encoded string.');
  }

  // Decode and sanitize SVG
  let svgContent;
  try {
    svgContent = atob(svg);
  } catch {
    return errorResponse(400, 'InvalidBase64', 'The "svg" field contains invalid base64 data. Encode your SVG file content as a standard base64 string.');
  }

  if (!svgContent.includes('<svg')) {
    return errorResponse(400, 'InvalidSvg', 'The decoded content does not appear to be a valid SVG. Ensure the base64 data represents an SVG file containing an <svg> element.');
  }

  const sanitized = sanitizeSvg(svgContent);
  const sanitizedB64 = btoa(sanitized);

  // Build path prefix
  const prefix = mode === 'client' ? `clients/${name}/v1/` : 'stocks/images/';
  const assetName = mode === 'client' ? name : (body.stockName || 'asset');

  // Build file list
  const files = [];

  // 1. Source SVG
  files.push({
    path: `${prefix}logos/${assetName}.svg`,
    content: sanitizedB64,
    encoding: 'base64',
  });

  // 2. Icon variants (stored as SVG since we can't rasterize at edge without Image Resizing on upload)
  if (generateIcons !== false) {
    files.push({
      path: `${prefix}icons/180x180.png`,
      content: sanitizedB64,
      encoding: 'base64',
    });
    files.push({
      path: `${prefix}icons/192x192.png`,
      content: sanitizedB64,
      encoding: 'base64',
    });
    files.push({
      path: `${prefix}icons/512x512.png`,
      content: sanitizedB64,
      encoding: 'base64',
    });
  }

  // 3. Favicon placeholder
  if (generateFavicon !== false) {
    files.push({
      path: `${prefix}icons/favicon.ico`,
      content: sanitizedB64,
      encoding: 'base64',
    });
  }

  // 4. Client-mode directory scaffolding
  if (mode === 'client' && generateBanners !== false) {
    const gitkeep = btoa('');
    for (const dir of ['banners', 'github', 'titles']) {
      files.push({
        path: `${prefix}${dir}/.gitkeep`,
        content: gitkeep,
        encoding: 'base64',
      });
    }
  }

  // Execute: GitHub Git Database API (same pattern as batch.js)
  const repo = env.GITHUB_REPO;
  const headers = ghHeaders(env.GITHUB_TOKEN);
  const branch = 'main';

  try {
    // 1. Get current HEAD
    const refRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, { headers });
    if (!refRes.ok) throw new Error('Failed to get branch ref');
    const headSha = (await refRes.json()).object.sha;

    // 2. Get base tree
    const commitRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/commits/${headSha}`, { headers });
    if (!commitRes.ok) throw new Error('Failed to get commit');
    const baseTree = (await commitRes.json()).tree.sha;

    // 3. Create blobs
    const treeEntries = [];
    for (const file of files) {
      const blobRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: file.content, encoding: file.encoding }),
      });
      if (!blobRes.ok) throw new Error('Failed to create blob');
      const blob = await blobRes.json();
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }

    // 4. Create tree
    const treeRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }),
    });
    if (!treeRes.ok) throw new Error('Failed to create tree');
    const treeSha = (await treeRes.json()).sha;

    // 5. Create commit
    const commitMsg = mode === 'client'
      ? `feat: scaffold ${name} zone with ${files.length} assets via Pipeline [skip ci]`
      : `feat: ingest stock asset via Pipeline [skip ci]`;

    const newCommitRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: commitMsg, parents: [headSha], tree: treeSha }),
    });
    if (!newCommitRes.ok) throw new Error('Failed to create commit');
    const commitSha = (await newCommitRes.json()).sha;

    // 6. Update branch ref
    const updateRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: commitSha }),
    });
    if (!updateRes.ok) throw new Error('Failed to update branch');

    // 7. Async cache purge
    if (env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_API_TOKEN) {
      const origin = cdnOrigin(request.url);
      const urls = files.map(f => {
        const publicPath = f.path.startsWith('clients/') ? f.path.slice('clients/'.length) : f.path;
        return `${origin}/${publicPath}`;
      });
      context.waitUntil(
        fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: urls }),
        }).catch(() => {})
      );
    }

    return new Response(JSON.stringify({
      HttpCode: 201,
      Message: `Pipeline completed: ${files.length} files created for ${mode} mode${mode === 'client' ? ` (zone: ${name})` : ''}.`,
      Commit: commitSha,
      Mode: mode,
      Name: mode === 'client' ? name : assetName,
      Files: files.map(f => f.path),
      EdgeStatus: 'pending',
      EdgeNote: 'Files committed. Available at the edge after CI/CD deploy (~60-90 seconds).',
      DateCreated: new Date().toISOString(),
    }, null, 2), { status: 201, headers: CORS_HEADERS });

  } catch (err) {
    log.error('PIPELINE_ERROR', err.message);
    return errorResponse(500, 'PipelineError', 'Pipeline failed due to an unexpected error. Verify your credentials and try again.');
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
}
