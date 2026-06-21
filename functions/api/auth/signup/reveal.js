/**
 * POST /api/auth/signup/reveal
 *
 * One-shot API-key reveal. Called by /onboarding immediately after
 * signup. The signup endpoint set an HttpOnly, Path-scoped
 * `cdn_signup_reveal` cookie carrying an HMAC-signed payload; this
 * endpoint validates session + signature, returns the payload once,
 * then clears the cookie.
 *
 * Why a cookie (vs sessionStorage): the API key never reaches
 * JavaScript-readable storage, so XSS in any same-origin page can't
 * exfiltrate it. The cookie is HttpOnly (JS-invisible), Secure
 * (HTTPS-only), SameSite=Lax (CSRF defence), and Path=/api/auth/signup
 * (only sent to /api/auth/signup/* endpoints).
 *
 * Response 200: { user, account, apiKey: { prefix, fullKey, scopes } }
 * Response 401: no active session  (user not signed in)
 * Response 404: no reveal cookie, expired payload, or tampered HMAC
 *               (deliberately collapses all failures to one code so
 *                an attacker can't probe the signing key)
 */

import {
  hasAccountsDB, getCurrentSession, verifyRevealPayload,
  clearedRevealCookieHeader, SIGNUP_REVEAL_COOKIE,
  AUTH_CORS, jsonError, authJson,
} from "../_lib.js";
import { parseCookies } from "../../_shared.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!hasAccountsDB(env)) {
    return jsonError(503, "infra_missing", "Auth bindings not configured.");
  }

  // Must be an authenticated session — the cookie alone isn't enough.
  // This stops a leaked reveal cookie from being usable without the
  // session that created it.
  const current = await getCurrentSession(env, request);
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");

  const cookies = parseCookies(request.headers.get("Cookie"));
  const signed = cookies[SIGNUP_REVEAL_COOKIE];
  if (!signed) return jsonError(404, "not_found", "No reveal token available.");

  const payload = await verifyRevealPayload(env, signed);
  if (!payload) return jsonError(404, "not_found", "No reveal token available.");

  // Belt-and-braces: the cookie's payload should belong to the
  // currently-authenticated user. If they don't match (e.g. someone
  // logged in as a different account after signup), refuse.
  if (payload.userId !== current.user.id) {
    return jsonError(404, "not_found", "No reveal token available.");
  }

  // Build the success body from the verified payload + session lookup.
  const res = authJson({
    user: current.user,
    account: current.account,
    apiKey: {
      id: payload.apiKeyId,
      prefix: payload.apiKeyPrefix,
      fullKey: payload.apiKeyFullKey,
      scopes: payload.apiKeyScopes,
      revealed_once: true,
    },
  });
  // Clear the cookie so a second reveal call returns 404.
  res.headers.append("Set-Cookie", clearedRevealCookieHeader());
  return res;
}
