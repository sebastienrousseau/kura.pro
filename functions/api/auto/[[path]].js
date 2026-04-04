/**
 * Catch-all route for path-based format negotiation.
 *
 * GET /api/auto/bankingonai/images/logos/logo
 *
 * Delegates to the main auto.js handler by injecting the path
 * from the URL params into the query string.
 */

import { onRequestGet as handler } from '../auto.js';

export async function onRequestGet(context) {
  const pathSegments = context.params.path;
  const path = '/' + (Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments);

  // Rewrite the URL to include the path as a query param so the main handler picks it up
  const url = new URL(context.request.url);
  url.searchParams.set('path', path);

  const rewrittenRequest = new Request(url.toString(), context.request);
  return handler({ ...context, request: rewrittenRequest });
}
