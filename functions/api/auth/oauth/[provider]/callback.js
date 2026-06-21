/**
 * GET /api/auth/oauth/<provider>/callback
 * POST /api/auth/oauth/apple/callback  (Apple uses response_mode=form_post)
 *
 * Completes the OAuth authorisation code flow. Validates the CSRF
 * state, exchanges the code for an access token, fetches user info,
 * find-or-creates the user + account + oauth_identity in D1, mints a
 * session cookie, and redirects:
 *   - new users  → /onboarding (with cdn_signup_reveal cookie set so
 *                   the wizard can show the freshly-minted API key)
 *   - returning  → /dashboard/
 */

import { hasAccountsDB, AUTH_CORS, jsonError, recordSignupAttempt } from "../../_lib.js";
import {
  PROVIDERS, providerConfigured, consumeState,
  exchangeCode, fetchUserinfo, findOrCreateUserFromOAuth,
  completeCallback, buildRedirectUri,
} from "../../_oauth.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestGet(context) {
  return handleCallback(context);
}

// Apple posts the callback (response_mode=form_post). Accept both.
export async function onRequestPost(context) {
  return handleCallback(context);
}

async function handleCallback(context) {
  const { request, env, params } = context;
  const provider = (params.provider || "").toLowerCase();
  const url = new URL(request.url);

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
    return jsonError(503, "provider_not_configured", `${provider} OAuth is not configured.`);
  }

  // Pull code+state from query (GET) OR form body (Apple POST).
  let code, state, providerError;
  if (request.method === "POST") {
    let form;
    try { form = await request.formData(); }
    catch { return jsonError(400, "invalid_callback", "Could not parse form data."); }
    code = form.get("code");
    state = form.get("state");
    providerError = form.get("error");
  } else {
    code = url.searchParams.get("code");
    state = url.searchParams.get("state");
    providerError = url.searchParams.get("error");
  }

  if (providerError) {
    // User cancelled or provider rejected. Bounce back to /sign-up
    // with a status fragment the page can surface.
    const reason = String(providerError).slice(0, 64).replace(/[^a-zA-Z0-9_]/g, "_");
    return new Response(null, {
      status: 302,
      headers: { Location: `/sign-up#oauth_error=${reason}`, "Cache-Control": "no-store" },
    });
  }
  if (!code || !state) {
    return jsonError(400, "invalid_callback", "Missing code or state.");
  }

  const stateRecord = await consumeState(env, state);
  if (!stateRecord || stateRecord.provider !== provider) {
    await recordSignupAttempt(env, { ip: request.headers.get("cf-connecting-ip"), outcome: "bot_detected", meta: { reason: "oauth_state_mismatch", provider } });
    return jsonError(400, "invalid_state", "CSRF state mismatch — try again from /sign-up.");
  }

  const redirectUri = buildRedirectUri(request, provider);

  let tokenResponse, profile;
  try {
    tokenResponse = await exchangeCode(env, provider, { code, redirectUri });
    profile = await fetchUserinfo(env, provider, tokenResponse);
  } catch (err) {
    return jsonError(502, "provider_error", `Could not complete OAuth handshake: ${err.message || err}`);
  }

  const { extract } = PROVIDERS[provider];
  const { providerUserId, email, name } = extract(profile);
  if (!email) {
    return jsonError(400, "no_email", `${provider} did not return an email address. Add an email to your ${provider} account and try again.`);
  }

  let result;
  try {
    result = await findOrCreateUserFromOAuth(env, { provider, providerUserId, email, name });
  } catch (err) {
    return jsonError(500, "internal", `Account provisioning failed: ${err.message || err}`);
  }

  const returnTo = result.created ? "/onboarding" : "/dashboard/";
  if (result.created) {
    await recordSignupAttempt(env, { email, ip: request.headers.get("cf-connecting-ip"), outcome: "success", meta: { via: `oauth:${provider}` } });
  }

  return completeCallback(env, {
    request,
    provider,
    user: result.user,
    account: result.account,
    created: result.created,
    returnTo,
  });
}
