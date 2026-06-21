/**
 * POST /api/auth/passkey/register/begin
 *
 * Starts a WebAuthn registration ceremony. Two paths:
 *
 * - **Signup**: anonymous request with `{ email }` in the body. We mint
 *   a fresh `user.id` (random UUID, not yet persisted — the real row is
 *   created in /complete after attestation succeeds). The client uses
 *   the returned options to call `navigator.credentials.create()`.
 *
 * - **Add-device**: authenticated session, no `email` needed. We use
 *   the session user's id + email. excludeCredentials is populated from
 *   the user's existing passkeys so the authenticator refuses to
 *   re-register a key it already holds.
 *
 * Response: WebAuthn PublicKeyCredentialCreationOptions (JSON-serialized,
 * base64url for binary fields per spec).
 */

import { hasAccountsDB, getCurrentSession, AUTH_CORS, jsonError, authJson } from "../../_lib.js";
import {
  RP_NAME, rpId, challengeSecret, issueChallenge,
  CHALLENGE_TYPE_REGISTER, PASSKEY_PUB_KEY_ALGS,
  bufferToBase64url, getCredentialDescriptorsByEmail,
} from "../_lib.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (env.LAUNCH_PUBLIC !== "1") return jsonError(503, "launch_gated", "Sign-up is not open yet.");
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const requestedEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const session = await getCurrentSession(env, request);

  let userIdForCeremony, emailForUser, displayName;
  let excludeCredentials = [];

  if (session && session.user) {
    // Add-device flow — bind to the signed-in user.
    userIdForCeremony = session.user.id;
    emailForUser = session.user.email;
    displayName = session.user.name || session.user.email;
    const existing = await getCredentialDescriptorsByEmail(env, emailForUser);
    excludeCredentials = existing.descriptors;
  } else {
    // Signup flow — require email; mint a fresh ceremony id.
    if (!EMAIL_RE.test(requestedEmail)) {
      return jsonError(400, "invalid_input", "Email required to start passkey signup.");
    }
    // If this email already belongs to a user, surface that as a
    // conflict — the user should sign in instead. Also populates
    // excludeCredentials so we never double-register a key on the
    // same user via the signup path.
    const existing = await getCredentialDescriptorsByEmail(env, requestedEmail);
    if (existing.user) {
      return jsonError(409, "email_exists", "An account with that email already exists. Sign in with passkey instead.");
    }
    userIdForCeremony = bufferToBase64url(crypto.getRandomValues(new Uint8Array(16)));
    emailForUser = requestedEmail;
    displayName = requestedEmail;
  }

  const secret = challengeSecret(env);
  const challenge = await issueChallenge(secret, CHALLENGE_TYPE_REGISTER);

  return authJson({
    rp: { name: RP_NAME, id: rpId(request) },
    user: { id: userIdForCeremony, name: emailForUser, displayName },
    challenge,
    pubKeyCredParams: PASSKEY_PUB_KEY_ALGS,
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    timeout: 60000,
    attestation: "none",
    excludeCredentials,
  });
}
