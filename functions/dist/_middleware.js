/**
 * Dist auth middleware — reuses the same session cookie from dashboard login.
 */

import { hmacVerifyCached, parseCookies } from '../api/_shared.js';

const SESSION_COOKIE = 'cdn_session';

// Release artifacts published under /dist/<package>/ must be reachable
// without a session so the one-line install pattern (`curl -sL .../install.sh`)
// works from any shell. The auth gate at the bottom only protects the
// browsing UI at /dist/, not the published binaries / scripts / hashes.
//
// Matched paths (everything else falls through to the session check):
//   /dist/<pkg>/install.sh
//   /dist/<pkg>/install.ps1
//   /dist/<pkg>/<anything>.mjs       (Node-script artifacts)
//   /dist/<pkg>/<anything>.tar.gz    (binary archive)
//   /dist/<pkg>/<anything>.zip       (Windows archive)
//   /dist/<pkg>/<anything>.sha256    (sidecar hashes)
const PUBLIC_ARTIFACT_RE = /^\/dist\/[^/]+\/(?:install\.(?:sh|ps1)|[^/]+\.(?:mjs|tar\.gz|zip|sha256))$/;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Public-artifact bypass — serve directly from the CDN tree, no auth.
  if (PUBLIC_ARTIFACT_RE.test(url.pathname)) {
    const rewritten = new URL(request.url);
    rewritten.pathname = '/cdn/en' + url.pathname;
    return env.ASSETS.fetch(new Request(rewritten.toString(), request));
  }

  const secret = env.DASHBOARD_SECRET || env.DASHBOARD_PASSWORD;

  if (!secret) {
    const host = request.headers.get('host') || '';
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return context.next();
    return new Response('Distribution page requires authentication. Set DASHBOARD_PASSWORD in environment variables.', { status: 503 });
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const session = cookies[SESSION_COOKIE];

  if (session) {
    const dot = session.lastIndexOf('.');
    if (dot > 0) {
      const token = session.slice(0, dot);
      const sig = session.slice(dot + 1);
      if (token && sig) {
        const valid = await hmacVerifyCached(secret, token, sig);
        const expires = parseInt(token, 10);
        if (valid && expires > Date.now() / 1000) {
          // Rewrite /dist/* to /cdn/en/dist/*. Keep the trailing slash
          // on directory paths — do NOT append index.html. Pages'
          // asset binding 308-redirects explicit index.html paths to
          // the directory form, and that 308 bounces the browser to
          // /cdn/en/dist/, where the public middleware's
          // /cdn/<locale>/... canonicalisation (PR #32) 301s it back
          // to /dist/, looping for authenticated users. Same trap PR #36
          // fixed in the dashboard auth path.
          const rewritten = new URL(request.url);
          rewritten.pathname = '/cdn/en' + url.pathname;
          return env.ASSETS.fetch(new Request(rewritten.toString(), request));
        }
      }
    }
  }

  return Response.redirect(new URL('/dashboard/login', url.origin).toString(), 302);
}
