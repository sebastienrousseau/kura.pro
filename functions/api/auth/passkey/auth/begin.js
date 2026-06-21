/**
 * POST /api/auth/passkey/auth/begin
 *
 * Starts a WebAuthn authentication ceremony for an existing user.
 * Returns the WebAuthn PublicKeyCredentialRequestOptions the client
 * passes to `navigator.credentials.get()`.
 *
 * Request body:
 *   { email?: string }   — optional: when given, allowCredentials is
 *                          populated from the user's stored passkeys.
 *                          When absent, returns an empty list (the
 *                          authenticator falls back to discoverable
 *                          credentials, surfacing the platform
 *                          passkey UI).
 *
 * The challenge is HMAC-signed and stateless — no KV write per attempt,
 * matching the existing single-tenant pattern.
 */

import { hasAccountsDB, AUTH_CORS, jsonError, authJson } from "../../_lib.js";
import {
  rpId, challengeSecret, issueChallenge, CHALLENGE_TYPE_AUTH,
  getCredentialDescriptorsByEmail,
} from "../_lib.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");

  let body;
  try { body = await request.json(); }
  catch { body = {}; }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  // We deliberately do not return a different shape when the email is
  // unknown — that would let an attacker enumerate accounts by watching
  // the response. Empty allowCredentials list either way.
  const { descriptors } = email
    ? await getCredentialDescriptorsByEmail(env, email)
    : { descriptors: [] };

  return authJson({
    rpId: rpId(request),
    challenge: await issueChallenge(challengeSecret(env), CHALLENGE_TYPE_AUTH),
    allowCredentials: descriptors,
    userVerification: "preferred",
    timeout: 60000,
  });
}
