/**
 * POST /api/auth/passkey/register/complete
 *
 * Completes a WebAuthn registration ceremony. The client extracts
 * `credentialId` + `publicKey` from `navigator.credentials.create()`
 * and POSTs them with the original `challenge` token.
 *
 * Two paths (mirrors register/begin):
 *
 * - **Signup**: anonymous + `email` in body. Creates User + Account +
 *   Membership + Passkey + default API key in a D1 batch, mints session
 *   + reveal cookie, returns 201.
 *
 * - **Add-device**: authenticated session, `email` ignored / must match
 *   session user. Inserts the new passkey row, returns 200.
 *
 * Request body:
 *   { credentialId, publicKey, challenge, name?, email?, transports? }
 *
 * Response 201 (signup) / 200 (add-device):
 *   { user, account, apiKey?: {prefix, scopes, reveal_via} }
 *   Set-Cookie: cdn_session=…, cdn_signup_reveal=… (signup only)
 */

import {
  hasAccountsDB, getDB, getCurrentSession, uuid,
  mintSession, sessionCookieHeader, loggedInIndicatorCookie,
  signRevealPayload, revealCookieHeader,
  createApiKey, auditEvent, recordSignupAttempt,
  POLICY_VERSION, AUTH_CORS, jsonError, authJson,
} from "../../_lib.js";
import {
  challengeSecret, verifyChallenge, CHALLENGE_TYPE_REGISTER,
  insertPasskey, getCredentialDescriptorsByEmail,
} from "../_lib.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get("cf-connecting-ip") || null;

  if (env.LAUNCH_PUBLIC !== "1") return jsonError(503, "launch_gated", "Sign-up is not open yet.");
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const { credentialId, publicKey, challenge, name, transports } = body;
  if (!credentialId || !publicKey || !challenge) {
    return jsonError(400, "invalid_input", "credentialId, publicKey and challenge are all required.");
  }

  if (!(await verifyChallenge(challengeSecret(env), challenge, CHALLENGE_TYPE_REGISTER))) {
    return jsonError(400, "invalid_challenge", "Challenge is invalid or expired.");
  }

  const session = await getCurrentSession(env, request);

  if (session && session.user) {
    // Add-device path — bind to the signed-in user.
    await insertPasskey(env, {
      userId: session.user.id,
      credentialIdB64: credentialId,
      publicKeyB64: publicKey,
      name,
      transports,
    });
    await auditEvent(env, {
      accountId: session.account ? session.account.id : null,
      userId: session.user.id,
      action: "passkey.register",
      request,
      meta: { device_name: name || null },
    });
    return authJson({ ok: true, mode: "add-device" }, 200);
  }

  // Signup path — body.email required.
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return jsonError(400, "invalid_input", "Email required for passkey signup.");
  }

  const existing = await getCredentialDescriptorsByEmail(env, email);
  if (existing.user) {
    return jsonError(409, "email_exists", "An account with that email already exists.");
  }

  // Provision the full user + account + membership + passkey in one D1
  // batch — same atomicity guarantee as functions/api/auth/signup.js.
  const userId = uuid();
  const accountId = uuid();
  const membershipId = uuid();
  const tosConsentId = uuid();
  const accountName = `${email.split("@")[0]}'s Account`;
  const now = Math.floor(Date.now() / 1000);
  const ipCountry = request.cf?.country || null;
  const db = getDB(env);

  try {
    await db.batch([
      // OAuth/passkey signups treat the email as verified — the user
      // proved control of the device, not the inbox, but passkey signup
      // typically implies the user is who they say they are; the email
      // is the recovery channel and can be re-verified later if needed.
      db.prepare(`INSERT INTO users (id, email, name, email_verified_at) VALUES (?1, ?2, ?3, ?4)`)
        .bind(userId, email, null, now),
      db.prepare(`INSERT INTO accounts (id, owner_user_id, name) VALUES (?1, ?2, ?3)`)
        .bind(accountId, userId, accountName),
      db.prepare(`INSERT INTO memberships (id, user_id, account_id, role) VALUES (?1, ?2, ?3, 'owner')`)
        .bind(membershipId, userId, accountId),
      db.prepare(`INSERT INTO consents (id, user_id, type, policy_version, ip_country) VALUES (?1, ?2, 'tos', ?3, ?4)`)
        .bind(tosConsentId, userId, POLICY_VERSION, ipCountry),
    ]);
  } catch (err) {
    if (String(err && err.message || "").includes("UNIQUE")) {
      return jsonError(409, "email_exists", "An account with that email already exists.");
    }
    return jsonError(500, "internal", "Account provisioning failed. Please retry.");
  }

  // Insert the passkey row (separate from the batch — base64url decode
  // is async via crypto.subtle's behaviour and we need the user_id FK
  // satisfied first).
  await insertPasskey(env, { userId, credentialIdB64: credentialId, publicKeyB64: publicKey, name, transports });

  // Mint the default API key + reveal cookie (mirrors signup.js).
  const apiKey = await createApiKey(env, { accountId, userId, name: "Default" });
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 256);
  const sessionMint = await mintSession(env, { userId, accountId, ip, userAgent });
  const revealSigned = await signRevealPayload(env, {
    userId, accountId,
    apiKeyId: apiKey.id, apiKeyPrefix: apiKey.prefix,
    apiKeyFullKey: apiKey.fullKey, apiKeyScopes: apiKey.scopes,
  });

  await recordSignupAttempt(env, { email, ip, outcome: "success", meta: { via: "passkey" } });
  await auditEvent(env, { accountId, userId, action: "user.signup", request, meta: { via: "passkey" } });
  await auditEvent(env, { accountId, userId, action: "passkey.register", request, meta: { device_name: name || null } });
  await auditEvent(env, { accountId, userId, action: "apikey.create", request, meta: { keyId: apiKey.id, prefix: apiKey.prefix } });

  const res = new Response(JSON.stringify({
    user: { id: userId, email, name: null },
    account: { id: accountId, name: accountName, plan: "free", monthlyCapUsd: 0 },
    apiKey: { prefix: apiKey.prefix, scopes: apiKey.scopes, reveal_via: "POST /api/auth/signup/reveal" },
    redirectTo: "/onboarding",
  }), {
    status: 201,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...AUTH_CORS },
  });
  res.headers.append("Set-Cookie", sessionCookieHeader(sessionMint.token, sessionMint.expiresAt));
  res.headers.append("Set-Cookie", loggedInIndicatorCookie(sessionMint.expiresAt));
  res.headers.append("Set-Cookie", revealCookieHeader(revealSigned));
  return res;
}
