/**
 * Health check endpoint.
 *
 * GET /api/health — returns service status and binding availability.
 */

export async function onRequestGet(context) {
  const { env } = context;

  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    bindings: {
      assets: !!env.ASSETS,
      kv: !!env.RATE_KV,
      ai: !!env.AI,
      vectorize: !!env.VECTOR_INDEX,
    },
  };

  return new Response(JSON.stringify(checks), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}
