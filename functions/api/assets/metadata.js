/**
 * Asset Metadata API — Detailed metadata for a single asset.
 *
 * GET /api/assets/metadata?path=akande/v1/logos/logo.svg
 */

import { getManifest, authenticateAccess, formatBytes, extractParams, cdnOrigin, CORS_JSON } from '../_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'AccessKey, Content-Type',
  'Content-Type': 'application/json',
};

const FORMAT_TO_CONTENT_TYPE = {
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
};

const IMAGE_FORMATS = ['png', 'webp', 'avif', 'svg', 'jpeg', 'jpg'];

function getAvailableFormats(asset, manifest) {
  const base = asset.path.replace(/\.[^.]+$/, '');
  const formats = [asset.format];
  if (IMAGE_FORMATS.includes(asset.format)) {
    for (const entry of manifest) {
      if (entry.path !== asset.path && entry.path.replace(/\.[^.]+$/, '') === base) {
        if (!formats.includes(entry.format)) formats.push(entry.format);
      }
    }
  }
  return formats;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await authenticateAccess(request, env))) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.' }), { status: 401, headers: CORS });
  }

  let manifest;
  try {
    manifest = await getManifest(env, request.url);
  } catch {
    return new Response(JSON.stringify({ HttpCode: 503, Message: 'The asset manifest could not be loaded from the edge cache. This may indicate a deployment is in progress. Retry the request in a few seconds or check the system status.' }), { status: 503, headers: CORS });
  }

  const params = extractParams(request.url);
  const path = params.get('path')?.trim();

  if (!path) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'Query parameter "path" is required. Provide the full asset path as a query string, e.g., /api/assets/metadata?path=akande/v1/logos/logo.svg. The path should match an entry in the asset manifest exactly.' }), { status: 400, headers: CORS });
  }

  const asset = manifest.find(a => a.path === path);
  if (!asset) {
    return new Response(JSON.stringify({ HttpCode: 404, Message: `Asset not found: ${path}. Verify the path matches an entry in the asset manifest exactly, including project name, version directory, and file extension. Use GET /api/assets to list all available assets.` }), { status: 404, headers: CORS });
  }

  const contentType = FORMAT_TO_CONTENT_TYPE[asset.format] || 'application/octet-stream';
  const availableFormats = getAvailableFormats(asset, manifest);

  return new Response(JSON.stringify({
    Path: asset.path,
    Name: asset.name,
    Project: asset.project,
    Category: asset.category,
    Format: asset.format,
    Size: asset.size,
    SizeHuman: formatBytes(asset.size),
    ContentType: contentType,
    CdnUrl: `${cdnOrigin(request.url)}/${asset.path}`,
    TransformUrl: `${cdnOrigin(request.url)}/api/transform?url=/${asset.path}`,
    AvailableFormats: availableFormats,
    DateFetched: new Date().toISOString(),
  }), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}
