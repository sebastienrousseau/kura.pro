/**
 * GET /api/auth/oauth/<provider>/begin
 *
 * Starts the OAuth authorisation code flow for one of the configured
 * providers (google | github | apple). Returns a 302 redirect to the
 * provider's authorisation URL with a freshly-minted CSRF state token
 * stored in RATE_KV.
 *
 * Gated by LAUNCH_PUBLIC=1 (same belt as /api/auth/signup) so OAuth
 * sign-ups can't happen before public launch even if the Access wall
 * is bypassed.
 *
 * Bound to /api/auth/oauth/[provider]/begin via Pages Functions
 * file-based routing.
 */

import { hasAccountsDB, AUTH_CORS, jsonError } from "../../_lib.js";
import { PROVIDERS, providerConfigured, issueState, buildAuthorizationUrl, buildRedirectUri } from "../../_oauth.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  /* v8 ignore next — defensive fallback when Pages Functions hands an
     empty params (impossible given the [provider] route file gate). */
  const provider = (params.provider || "").toLowerCase();

  if (env.LAUNCH_PUBLIC !== "1") {
    return jsonError(503, "launch_gated", "Sign-up is not open yet.");
  }
  if (!hasAccountsDB(env)) {
    return jsonError(503, "infra_missing", "Auth bindings not configured.");
  }
  if (!PROVIDERS[provider]) {
    return jsonError(404, "unknown_provider", `Unknown OAuth provider: ${provider}`);
  }
  if (!providerConfigured(env, provider)) {
    return jsonError(503, "provider_not_configured",
      `${provider} OAuth credentials are not set on this deployment. ` +
      `Configure via 'wrangler pages secret put ${PROVIDERS[provider].clientIdEnv}' and friends.`);
  }

  const state = await issueState(env, provider);
  const redirectUri = buildRedirectUri(request, provider);
  const authUrl = buildAuthorizationUrl(env, provider, { state, redirectUri });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Cache-Control": "no-store",
    },
  });
}
