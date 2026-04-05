/**
 * CloudCDN Storage API — Bunny.net-compatible REST interface.
 *
 * Endpoints:
 *   GET    /api/storage/{path}/          — List directory contents
 *   GET    /api/storage/{path}/{file}    — Download file
 *   PUT    /api/storage/{path}/{file}    — Upload file
 *   DELETE /api/storage/{path}/{file}    — Delete file
 *   HEAD   /api/storage/{path}/{file}    — File metadata
 *
 * Auth: AccessKey header (env.STORAGE_KEY) or dashboard session cookie.
 * Response format: ISO 8601 dates, Bunny.net-compatible JSON schema.
 */

import { authenticateAccess } from '../_shared.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'AccessKey, Content-Type, Checksum',
  'Content-Type': 'application/json',
};

const STORAGE_ZONE = 'cloudcdn';
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024; // 25 MB (Cloudflare Pages limit)
const GITHUB_API_LIMIT = 50 * 1024 * 1024; // 50 MB (GitHub Contents API limit)

function unauthorized() {
  return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), {
    status: 401,
    headers: CORS_HEADERS,
  });
}

// ── Path resolution ──

function resolveStoragePath(pathSegments) {
  // /api/storage/clients/akande/v1/logos/logo.svg → clients/akande/v1/logos/logo.svg
  let joined = pathSegments.join('/');
  // Decode URL-encoded sequences first
  try { joined = decodeURIComponent(joined); } catch { return null; }
  // Normalize backslashes to forward slashes
  joined = joined.replace(/\\/g, '/');
  // Reject null bytes
  if (joined.includes('\0')) return null;
  // Prevent path traversal and double slashes
  if (joined.includes('..') || joined.includes('//')) return null;
  // Block access to internal directories
  const segments = joined.split('/');
  for (const seg of segments) {
    if (seg === '.git' || seg === '.github' || seg === 'node_modules') return null;
  }
  return joined;
}

function isDirectory(path) {
  return !path || path.endsWith('/') || !path.includes('.') || path.split('/').pop().indexOf('.') === -1;
}

// ── Helpers ──

function isoDate(date) {
  return date instanceof Date ? date.toISOString() : new Date().toISOString();
}

function generateGuid() {
  return crypto.randomUUID();
}

function buildFileEntry(name, path, size, isDir, dateCreated, lastChanged) {
  return {
    Guid: generateGuid(),
    StorageZoneName: STORAGE_ZONE,
    Path: '/' + path,
    ObjectName: name,
    Length: isDir ? 0 : size,
    LastChanged: isoDate(lastChanged || dateCreated),
    ServerId: 0,
    ArrayNumber: 0,
    IsDirectory: isDir,
    UserId: 'cloudcdn',
    ContentType: '',
    DateCreated: isoDate(dateCreated),
    StorageZoneId: 0,
    Checksum: null,
    ReplicatedZones: '',
  };
}

// ── Handlers ──

/**
 * GET — List directory or download file.
 */
export async function onRequestGet(context) {
  const { request, env, params } = context;

  if (!await authenticateAccess(request, env)) return unauthorized();

  const pathSegments = params.path || [];
  const storagePath = resolveStoragePath(pathSegments);
  if (storagePath === null) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The requested path is invalid or contains disallowed characters such as path traversal sequences. Use forward slashes to separate path segments and avoid ".." or empty segments.' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  const url = new URL(request.url);

  // If path ends with / or has no extension → list directory
  if (url.pathname.endsWith('/') || isDirectory(storagePath)) {
    return listDirectory(env, storagePath);
  }

  // Otherwise → download file
  return downloadFile(env, request, storagePath);
}

async function listDirectory(env, dirPath) {
  // Read manifest to find files in this directory
  let manifest;
  try {
    const manifestUrl = new URL('/manifest.json', 'https://cloudcdn.pro');
    // Try to read from KV or fetch locally
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(manifestUrl);
      manifest = await res.json();
    } else {
      return new Response(JSON.stringify([]), { headers: CORS_HEADERS });
    }
  } catch {
    return new Response(JSON.stringify([]), { headers: CORS_HEADERS });
  }

  // Normalize dirPath — strip leading/trailing slashes
  const normalizedDir = dirPath.replace(/^\/|\/$/g, '');

  // Find entries that are direct children of this directory
  const entries = [];
  const seenDirs = new Set();

  for (const asset of manifest) {
    // Map manifest paths to storage paths
    // manifest has: akande/v1/logos/logo.svg
    // storage has: clients/akande/v1/logos/logo.svg or stocks/images/photo.webp
    let fullPath = asset.path;
    if (asset.project !== 'stocks' && asset.project !== 'shared') {
      fullPath = 'clients/' + asset.path;
    }

    if (!normalizedDir) {
      // Root listing — show top-level directories
      const topDir = fullPath.split('/')[0];
      if (!seenDirs.has(topDir)) {
        seenDirs.add(topDir);
        entries.push(buildFileEntry(topDir, '', 0, true, new Date(), new Date()));
      }
      continue;
    }

    if (!fullPath.startsWith(normalizedDir + '/') && fullPath !== normalizedDir) continue;

    const relative = fullPath.slice(normalizedDir.length + 1);
    if (!relative) continue;

    const parts = relative.split('/');
    if (parts.length === 1) {
      // Direct child file
      entries.push(buildFileEntry(
        parts[0],
        normalizedDir + '/',
        asset.size,
        false,
        new Date(),
        new Date()
      ));
    } else {
      // Subdirectory
      const subDir = parts[0];
      if (!seenDirs.has(subDir)) {
        seenDirs.add(subDir);
        entries.push(buildFileEntry(
          subDir,
          normalizedDir + '/',
          0,
          true,
          new Date(),
          new Date()
        ));
      }
    }
  }

  return new Response(JSON.stringify(entries, null, 2), { headers: CORS_HEADERS });
}

async function downloadFile(env, request, filePath) {
  // Resolve to physical path
  let physicalPath = filePath;
  // For client assets, check if it's under clients/
  if (!filePath.startsWith('stocks/') && !filePath.startsWith('clients/')) {
    physicalPath = 'clients/' + filePath;
  }

  const url = new URL(request.url);
  url.pathname = '/' + physicalPath;

  try {
    const res = await env.ASSETS.fetch(new Request(url, request));
    if (!res.ok) {
      return new Response(JSON.stringify({ HttpCode: 404, Message: 'The requested file does not exist at the specified path. Verify the path is correct, check for typos in the filename or directory structure, and confirm the file has been uploaded.' }), {
        status: 404, headers: CORS_HEADERS,
      });
    }

    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ HttpCode: 500, Message: 'The file download failed due to an unexpected internal error. The asset may have been recently deleted or the edge cache may be refreshing. Retry the request in a few seconds.' }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}

/**
 * PUT — Upload file.
 *
 * Since Cloudflare Pages is a static host, uploads are stored via the
 * GitHub API (creating a commit) or an R2 bucket if configured.
 */
export async function onRequestPut(context) {
  const { request, env, params } = context;

  if (!await authenticateAccess(request, env)) return unauthorized();

  const pathSegments = params.path || [];
  const storagePath = resolveStoragePath(pathSegments);
  if (storagePath === null || isDirectory(storagePath)) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The requested file path is invalid. Ensure the path points to a specific file (not a directory), uses forward slashes, and does not contain path traversal sequences like "..".' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  // Check Content-Length before reading body
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_UPLOAD_SIZE) {
    return new Response(JSON.stringify({
      HttpCode: 413,
      Message: `Payload too large: ${(contentLength / 1048576).toFixed(1)} MB exceeds ${MAX_UPLOAD_SIZE / 1048576} MB limit`,
      MaxSize: MAX_UPLOAD_SIZE,
    }), { status: 413, headers: CORS_HEADERS });
  }

  // Validate checksum if provided
  const checksumHeader = request.headers.get('Checksum');
  const body = await request.arrayBuffer();

  // Double-check actual size after reading
  if (body.byteLength > MAX_UPLOAD_SIZE) {
    return new Response(JSON.stringify({
      HttpCode: 413,
      Message: `Payload too large: ${(body.byteLength / 1048576).toFixed(1)} MB exceeds ${MAX_UPLOAD_SIZE / 1048576} MB limit`,
      MaxSize: MAX_UPLOAD_SIZE,
    }), { status: 413, headers: CORS_HEADERS });
  }

  if (checksumHeader) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', body);
    const hashHex = [...new Uint8Array(hashBuffer)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    if (hashHex !== checksumHeader.toUpperCase()) {
      return new Response(JSON.stringify({
        HttpCode: 400,
        Message: 'The SHA-256 checksum provided in the Checksum header does not match the computed hash of the uploaded file body. Verify the file was not corrupted during transfer and the hash is correct.',
        Expected: checksumHeader.toUpperCase(),
        Received: hashHex,
      }), { status: 400, headers: CORS_HEADERS });
    }
  }

  // Determine physical path
  let physicalPath = storagePath;
  if (!storagePath.startsWith('stocks/') && !storagePath.startsWith('clients/')) {
    physicalPath = 'clients/' + storagePath;
  }

  // Upload via GitHub API if configured
  if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
    try {
      const base64Content = btoa(String.fromCharCode(...new Uint8Array(body)));

      // Check if file exists (for update vs create)
      let sha;
      try {
        const existing = await fetch(
          `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${physicalPath}`,
          { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'CloudCDN' } }
        );
        if (existing.ok) {
          const data = await existing.json();
          sha = data.sha;
        }
      } catch {}

      const payload = {
        message: `chore: upload ${storagePath} via Storage API [skip ci]`,
        content: base64Content,
        branch: 'main',
      };
      if (sha) payload.sha = sha;

      const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${physicalPath}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'CloudCDN',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        const status = res.status === 409 ? 409 : 502;
        return new Response(JSON.stringify({
          HttpCode: status,
          Message: status === 409
            ? 'Conflict: another upload modified the tree. Retry or use /api/storage/batch for concurrent uploads.'
            : 'Upload failed',
          Detail: err.message,
        }), { status, headers: CORS_HEADERS });
      }

      // Async cache purge for overwrites (don't block the response)
      if (sha && env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_API_TOKEN) {
        const cdnUrl = `https://cloudcdn.pro/${storagePath}`;
        context.waitUntil(
          fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: [cdnUrl] }),
          }).catch(() => {})
        );
      }

      return new Response(JSON.stringify({
        HttpCode: 201,
        Message: 'File uploaded successfully. The asset has been committed to the repository and will be available at the edge after the CI/CD pipeline completes deployment (approximately 60-90 seconds).',
        Path: storagePath,
        Length: body.byteLength,
        Checksum: checksumHeader || null,
        DateCreated: isoDate(new Date()),
        EdgeStatus: 'pending',
        EdgeNote: 'File committed to repository. It will be available at the edge after the CI/CD pipeline deploys (~60-90 seconds).',
      }), { status: 201, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(JSON.stringify({
        HttpCode: 500,
        Message: 'The file upload failed due to an unexpected error while committing the file to the repository. Verify your GITHUB_TOKEN has write permissions and the file content is valid base64-encoded data. Detail: ' + err.message,
      }), { status: 500, headers: CORS_HEADERS });
    }
  }

  // No upload backend configured
  return new Response(JSON.stringify({
    HttpCode: 501,
    Message: 'File uploads require the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings under Environment Variables.',
  }), { status: 501, headers: CORS_HEADERS });
}

/**
 * DELETE — Delete file via GitHub API.
 */
export async function onRequestDelete(context) {
  const { request, env, params } = context;

  if (!await authenticateAccess(request, env)) return unauthorized();

  const pathSegments = params.path || [];
  const storagePath = resolveStoragePath(pathSegments);
  if (storagePath === null) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'The requested path is invalid or contains disallowed characters such as path traversal sequences. Use forward slashes to separate path segments and avoid ".." or empty segments.' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  let physicalPath = storagePath;
  if (!storagePath.startsWith('stocks/') && !storagePath.startsWith('clients/')) {
    physicalPath = 'clients/' + storagePath;
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return new Response(JSON.stringify({
      HttpCode: 501,
      Message: 'File deletions require the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings under Environment Variables.',
    }), { status: 501, headers: CORS_HEADERS });
  }

  try {
    // Get file SHA (required for GitHub delete)
    const existing = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${physicalPath}`,
      { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'CloudCDN' } }
    );

    if (!existing.ok) {
      return new Response(JSON.stringify({ HttpCode: 404, Message: 'The requested file does not exist at the specified path. Verify the path is correct, check for typos in the filename or directory structure, and confirm the file has been uploaded.' }), {
        status: 404, headers: CORS_HEADERS,
      });
    }

    const { sha } = await existing.json();

    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${physicalPath}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'CloudCDN',
        },
        body: JSON.stringify({
          message: `chore: delete ${storagePath} via Storage API [skip ci]`,
          sha,
          branch: 'main',
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json();
      return new Response(JSON.stringify({
        HttpCode: 502,
        Message: 'The file deletion failed due to an unexpected error communicating with the storage backend. Verify your GITHUB_TOKEN has write permissions and the file exists at the specified path.',
        Detail: err.message,
      }), { status: 502, headers: CORS_HEADERS });
    }

    // Async cache purge (don't block the response)
    if (env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_API_TOKEN) {
      const cdnUrl = `https://cloudcdn.pro/${storagePath}`;
      context.waitUntil(
        fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [cdnUrl] }),
        }).catch(() => {})
      );
    }

    return new Response(JSON.stringify({
      HttpCode: 200,
      Message: 'File deleted successfully. The asset has been removed from the repository and the edge cache purge has been initiated. The deletion will propagate to all 300+ edge locations within seconds.',
      Path: storagePath,
      EdgeStatus: 'purging',
      EdgeNote: 'File removed from repository and edge cache purge initiated.',
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({
      HttpCode: 500,
      Message: 'The file deletion failed due to an unexpected error while removing the file from the repository. Verify your GITHUB_TOKEN has write permissions and the file exists at the specified path. Detail: ' + err.message,
    }), { status: 500, headers: CORS_HEADERS });
  }
}

/**
 * HEAD — File metadata.
 */
export async function onRequestHead(context) {
  const { request, env, params } = context;

  if (!await authenticateAccess(request, env)) return unauthorized();

  const pathSegments = params.path || [];
  const storagePath = resolveStoragePath(pathSegments);
  if (storagePath === null) {
    return new Response(null, { status: 400 });
  }

  let physicalPath = storagePath;
  if (!storagePath.startsWith('stocks/') && !storagePath.startsWith('clients/')) {
    physicalPath = 'clients/' + storagePath;
  }

  const url = new URL(request.url);
  url.pathname = '/' + physicalPath;

  try {
    const res = await env.ASSETS.fetch(new Request(url, { method: 'HEAD' }));
    return new Response(null, {
      status: res.ok ? 200 : 404,
      headers: {
        'Content-Length': res.headers.get('Content-Length') || '0',
        'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/**
 * OPTIONS — CORS preflight.
 */
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
}
