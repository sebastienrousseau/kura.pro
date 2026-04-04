/**
 * Automatic format negotiation endpoint.
 *
 * GET /api/auto?path=/bankingonai/images/logos/logo
 * GET /api/auto/bankingonai/images/logos/logo
 *
 * Reads the Accept header to serve the best image format,
 * with fallback chain: avif → webp → png → svg.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const FORMAT_CHAIN = [
  { ext: 'avif', mime: 'image/avif' },
  { ext: 'webp', mime: 'image/webp' },
  { ext: 'png', mime: 'image/png' },
  { ext: 'svg', mime: 'image/svg+xml' },
];

/**
 * Determine the preferred format index based on the Accept header.
 */
function preferredStartIndex(accept) {
  if (accept.includes('image/avif')) return 0;
  if (accept.includes('image/webp')) return 1;
  return 2; // start at png
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  // Support both query param and path-based routing
  // Path format: /api/auto/some/path → context.params or URL parsing
  let path = url.searchParams.get('path');

  if (!path) {
    // Try path-based: strip /api/auto prefix
    const pathname = url.pathname;
    const prefix = '/api/auto/';
    if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
      path = '/' + pathname.slice(prefix.length);
    }
  }

  if (!path) {
    return Response.json(
      { error: 'Missing required parameter: path' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const accept = context.request.headers.get('Accept') || '';
  const startIdx = preferredStartIndex(accept);

  // Try each format in the fallback chain starting from preferred
  for (let i = startIdx; i < FORMAT_CHAIN.length; i++) {
    const { ext, mime } = FORMAT_CHAIN[i];
    const assetUrl = new URL(`${path}.${ext}`, url.origin).toString();

    try {
      const response = await fetch(assetUrl);

      if (response.ok) {
        const headers = new Headers(response.headers);
        headers.set('Content-Type', mime);
        headers.set('Vary', 'Accept');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');

        return new Response(response.body, {
          status: 200,
          headers,
        });
      }
      // 404 or other error — try next format
    } catch {
      // fetch failed — try next format
    }
  }

  return Response.json(
    { error: 'No suitable format found for the given path' },
    { status: 404, headers: CORS_HEADERS }
  );
}
