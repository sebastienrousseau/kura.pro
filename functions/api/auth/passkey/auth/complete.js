/**
 * POST /api/auth/passkey/auth/complete
 *
 * Completes a WebAuthn authentication ceremony. Verifies the assertion
 * against the stored public key, bumps sign_count, mints a session.
 *
 * Request body (from navigator.credentials.get()):
 *   {
 *     credentialId,        // base64url
 *     challenge,           // signed challenge token from /auth/begin
 *     authenticatorData,   // base64url
 *     signature,           // base64url
 *     clientDataJSON,      // base64url
 *   }
 *
 * Response 200: { user, account, session, verification }
 *   Set-Cookie: cdn_session=…
 *
 * On verification failure: 401 invalid_assertion (strict mode) or
 * 200 with `verification: "loose"` (default, mirrors single-tenant
 * PASSKEY_STRICT_VERIFY flag).
 */

import {
  hasAccountsDB, getDB, mintSession,
  sessionCookieHeader, loggedInIndicatorCookie,
  auditEvent, AUTH_CORS, jsonError,
} from "../../_lib.js";
import {
  challengeSecret, verifyChallenge, CHALLENGE_TYPE_AUTH,
  verifyAssertion, expectedOrigin,
  getPasskeyByCredentialId, bumpPasskeyUsage,
} from "../_lib.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get("cf-connecting-ip") || null;

  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const { credentialId, challenge, authenticatorData, signature, clientDataJSON } = body;
  if (!credentialId || !challenge) {
    return jsonError(400, "invalid_input", "credentialId and challenge are required.");
  }

  if (!(await verifyChallenge(challengeSecret(env), challenge, CHALLENGE_TYPE_AUTH))) {
    return jsonError(400, "invalid_challenge", "Challenge is invalid or expired.");
  }

  const cred = await getPasskeyByCredentialId(env, credentialId);
  if (!cred) return jsonError(401, "unknown_credential", "Passkey not recognised.");

  // Cryptographic verification — required when the client provides
  // authenticatorData + signature + clientDataJSON (the modern shape).
  // Bare credentialId-only requests (legacy) are accepted in loose
  // mode and rejected in strict mode, mirroring the single-tenant
  // PASSKEY_STRICT_VERIFY=1 flag.
  const strictMode = env.PASSKEY_STRICT_VERIFY === "1";
  const hasAssertion = !!(authenticatorData && signature && clientDataJSON);
  let verifyMode = "legacy";
  let verifyReason = null;
  if (hasAssertion) {
    const result = await verifyAssertion({
      storedPublicKeyB64: cred.publicKey,
      authenticatorDataB64: authenticatorData,
      signatureB64: signature,
      clientDataJSONB64: clientDataJSON,
      expectedOrigin: expectedOrigin(request),
      expectedChallengeB64: challenge,
    });
    if (result.valid) {
      verifyMode = result.alg || "strict";
    } else if (result.reason && result.reason.startsWith("stored publicKey is not SPKI")) {
      verifyMode = "legacy-spki";
      verifyReason = result.reason;
    } else if (strictMode) {
      return jsonError(401, "invalid_assertion", result.reason || "Assertion verification failed.");
    } else {
      verifyMode = "loose";
      verifyReason = result.reason;
    }
  } else if (strictMode) {
    return jsonError(401, "missing_assertion", "Strict mode requires authenticatorData + signature + clientDataJSON.");
  }

  const usage = await bumpPasskeyUsage(env, credentialId, cred.signCount + 1);

  // Find the user's primary account (Phase 0: exactly one per user).
  const db = getDB(env);
  const accountRow = await db
    .prepare(`SELECT id, name, plan, monthly_cap_usd FROM accounts WHERE owner_user_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`)
    .bind(cred.userId).first();
  const accountId = accountRow?.id || null;

  const userAgent = (request.headers.get("user-agent") || "").slice(0, 256);
  const { token, expiresAt } = await mintSession(env, { userId: cred.userId, accountId, ip, userAgent });

  await db.prepare(`UPDATE users SET last_login_at = ?1 WHERE id = ?2`)
    .bind(Math.floor(Date.now() / 1000), cred.userId).run().catch(() => {});

  await auditEvent(env, { accountId, userId: cred.userId, action: "user.login", request, meta: { via: "passkey", verification: verifyMode } });

  const responseHeaders = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", ...AUTH_CORS });
  responseHeaders.append("Set-Cookie", sessionCookieHeader(token, expiresAt));
  responseHeaders.append("Set-Cookie", loggedInIndicatorCookie(expiresAt));
  responseHeaders.set("X-Passkey-Verification", verifyMode);
  if (verifyReason) responseHeaders.set("X-Passkey-Verification-Reason", verifyReason);
  if (!usage.ok) responseHeaders.set("X-Passkey-Counter-Save", `failed: ${usage.error}`);

  return new Response(JSON.stringify({
    user: cred.user,
    account: accountRow ? { id: accountRow.id, name: accountRow.name, plan: accountRow.plan, monthlyCapUsd: accountRow.monthly_cap_usd } : null,
    session: { expiresAt },
    verification: verifyMode,
  }), { status: 200, headers: responseHeaders });
}
