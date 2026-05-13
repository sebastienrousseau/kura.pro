/**
 * Background-removal endpoint — 501 stub.
 *
 * GET  /api/ai/background-remove?url=/clients/akande/v1/logos/logo.png
 * POST /api/ai/background-remove  { "url": "..." }
 *
 * Returns 501 Not Implemented. The endpoint is documented in the OpenAPI
 * spec and exposed via the MCP tool surface so agents and clients can
 * discover that it exists and what the future contract will look like —
 * but Workers AI's current model catalog has no segmentation/matting
 * primitive (no U²-Net / rembg-class network), so we cannot produce a
 * pixel-accurate alpha mask at the edge.
 *
 * When the catalog gains a segmentation model (or we bring our own via
 * Workers AI Custom Models), the implementation will swap into this file
 * without changing the route, response shape, or the MCP tool definition.
 *
 * Response shape (today, on every call):
 *   501 {
 *     "error":   "NotImplemented",
 *     "message": "Background removal requires a segmentation model that
 *                 is not yet available in Cloudflare's Workers AI catalog.",
 *     "track":   "https://github.com/sebastienrousseau/cloudcdn.pro/issues",
 *   }
 *
 * Why ship a stub at all?
 *   - Lets agents (MCP) discover the endpoint with a clear "not yet"
 *     instead of a 404 that implies the feature doesn't exist.
 *   - Locks the URL/shape so clients can integrate ahead of the model
 *     landing and we don't break them later.
 *   - Surfaces the constraint honestly in the OpenAPI reference so the
 *     dependency is visible to anyone reading the docs.
 */

import { errorResponse } from '../_shared.js';

const NOT_IMPLEMENTED_MESSAGE =
  'Background removal requires a segmentation model that is not yet ' +
  'available in Cloudflare Workers AI. Track progress on this endpoint at ' +
  'https://github.com/sebastienrousseau/cloudcdn.pro/issues.';

function notImplemented() {
  return errorResponse(501, 'NotImplemented', NOT_IMPLEMENTED_MESSAGE, {
    details: [
      { code: 'BlockedByDependency', target: '@cf/* segmentation models', message: 'No matting model in Workers AI catalog yet.' },
    ],
  });
}

export async function onRequestGet() {
  return notImplemented();
}

export async function onRequestPost() {
  return notImplemented();
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, AccountKey, AccessKey, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
