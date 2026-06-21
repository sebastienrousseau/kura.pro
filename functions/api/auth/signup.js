/**
 * POST /api/auth/signup
 *
 * Public sign-up endpoint. Gated behind LAUNCH_PUBLIC=1 + (in
 * production) Cloudflare Access. Creates User + Account + Membership
 * (owner) + default API key in a single D1 batch, mints a session
 * cookie, and reveals the API key once in the response payload.
 *
 * Request body:
 *   {
 *     email: string,
 *     password: string,            // 12+ chars; checked against HIBP
 *     consents: { tos: true, marketing?: boolean },
 *     turnstile: string,           // Turnstile token from the page
 *     ts_elapsed_ms: number,       // form render → submit elapsed
 *     company_website?: string     // honeypot — must be empty
 *   }
 *
 * Response 201:
 *   {
 *     user: { id, email, name },
 *     account: { id, name, plan, monthlyCapUsd },
 *     apiKey: { prefix, fullKey, scopes },   // fullKey shown ONCE
 *     redirectTo: "/onboarding"
 *   }
 *   Set-Cookie: cdn_session=…
 *
 * Error codes:
 *   400 invalid_input              — missing/malformed fields
 *   400 bot_detected               — honeypot/time-to-fill/score gate
 *   400 turnstile_failed
 *   400 disposable_email
 *   400 pwned_password
 *   409 email_exists
 *   429 rate_limited
 *   503 launch_gated               — LAUNCH_PUBLIC=0
 *   500 internal
 */

import { checkRateLimit } from "../_shared.js";
import {
  hasAccountsDB, getDB, uuid, hashPassword, isPasswordPwned, verifyTurnstile,
  scoreSignupAttempt, recordSignupAttempt, auditEvent, mintSession,
  sessionCookieHeader, loggedInIndicatorCookie, createApiKey,
  signRevealPayload, revealCookieHeader,
  POLICY_VERSION, SIGNUP_RATE_LIMIT, SIGNUP_RATE_WINDOW, AUTH_CORS,
  jsonError, authJson,
} from "./_lib.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 12;
const MAX_PASSWORD_LEN = 1024;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null;

  if (env.LAUNCH_PUBLIC !== "1") {
    await recordSignupAttempt(env, { ip, outcome: "launch_gated" });
    return jsonError(503, "launch_gated", "Sign-up is not open yet.");
  }
  if (!hasAccountsDB(env) || !env.AUTH_HASHER) {
    return jsonError(503, "infra_missing", "Auth bindings not configured.");
  }

  // Rate-limit per IP using the existing helper.
  if (ip) {
    const rl = await checkRateLimit(env, `signup:${ip}`, SIGNUP_RATE_LIMIT, SIGNUP_RATE_WINDOW);
    if (!rl.allowed) {
      await recordSignupAttempt(env, { ip, outcome: "rate_limited" });
      return jsonError(429, "rate_limited", "Too many sign-up attempts. Try again later.", {
        retryAfter: rl.resetAt ? Math.max(0, rl.resetAt - Math.floor(Date.now() / 1000)) : SIGNUP_RATE_WINDOW,
      });
    }
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const consents = body.consents || {};
  const turnstileToken = typeof body.turnstile === "string" ? body.turnstile : "";
  const elapsedMs = Number(body.ts_elapsed_ms);
  const honeypot = body.company_website || "";

  if (!EMAIL_RE.test(email)) return jsonError(400, "invalid_input", "Valid email required.");
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    return jsonError(400, "invalid_input", `Password must be ${MIN_PASSWORD_LEN}-${MAX_PASSWORD_LEN} characters.`);
  }
  if (consents.tos !== true) return jsonError(400, "invalid_input", "Terms of Service acceptance required.");

  // Anti-abuse scoring (cheap, before the Turnstile siteverify call).
  const score = scoreSignupAttempt({ request, email, elapsedMs, honeypot });
  if (score.score >= 31) {
    await recordSignupAttempt(env, { email, ip, outcome: "bot_detected", score: score.score, meta: { reasons: score.reasons } });
    return jsonError(400, "bot_detected", "Submission rejected.");
  }

  // Turnstile.
  const turnstileOk = await verifyTurnstile(env, turnstileToken, ip);
  if (!turnstileOk) {
    await recordSignupAttempt(env, { email, ip, outcome: "turnstile_fail", score: score.score });
    return jsonError(400, "turnstile_failed", "Human-verification check failed. Refresh and try again.");
  }

  // HIBP — fail-open on network/HTTP error (don't block on Pwned-Passwords downtime).
  const { pwned, count } = await isPasswordPwned(password);
  if (pwned && count >= 5) {
    // 5+ breaches = clearly a common password; reject. Single-occurrence
    // breaches happen to legitimate strong passwords too often to block.
    await recordSignupAttempt(env, { email, ip, outcome: "invalid", score: score.score, meta: { pwned_count: count } });
    return jsonError(400, "pwned_password", "That password has appeared in known data breaches. Pick a different one.");
  }

  // Email uniqueness.
  const db = getDB(env);
  const existing = await db
    .prepare(`SELECT id FROM users WHERE lower(email) = lower(?1) AND deleted_at IS NULL`)
    .bind(email).first();
  if (existing) {
    await recordSignupAttempt(env, { email, ip, outcome: "duplicate", score: score.score });
    return jsonError(409, "email_exists", "An account with that email already exists.");
  }

  // Hash password via the standalone auth-hasher Worker.
  let passwordHash;
  try {
    passwordHash = await hashPassword(env, password);
  } catch (err) {
    return jsonError(500, "internal", "Password hashing failed. Please retry.");
  }

  // Provision User + Account + Membership + Consents atomically.
  const userId = uuid();
  const accountId = uuid();
  const membershipId = uuid();
  const tosConsentId = uuid();
  const marketingConsentId = uuid();
  const ipCountry = request.cf?.country || null;
  const localPart = email.split("@")[0];
  const accountName = `${localPart}'s Account`;

  try {
    const stmts = [
      db.prepare(
        `INSERT INTO users (id, email) VALUES (?1, ?2)`
      ).bind(userId, email),
      db.prepare(
        `INSERT INTO password_credentials (user_id, hashed_password) VALUES (?1, ?2)`
      ).bind(userId, passwordHash),
      db.prepare(
        `INSERT INTO accounts (id, owner_user_id, name) VALUES (?1, ?2, ?3)`
      ).bind(accountId, userId, accountName),
      db.prepare(
        `INSERT INTO memberships (id, user_id, account_id, role) VALUES (?1, ?2, ?3, 'owner')`
      ).bind(membershipId, userId, accountId),
      db.prepare(
        `INSERT INTO consents (id, user_id, type, policy_version, ip_country) VALUES (?1, ?2, 'tos', ?3, ?4)`
      ).bind(tosConsentId, userId, POLICY_VERSION, ipCountry),
    ];
    if (consents.marketing === true) {
      stmts.push(
        db.prepare(
          `INSERT INTO consents (id, user_id, type, policy_version, ip_country) VALUES (?1, ?2, 'marketing', ?3, ?4)`
        ).bind(marketingConsentId, userId, POLICY_VERSION, ipCountry)
      );
    }
    await db.batch(stmts);
  } catch (err) {
    // Likely a unique-constraint race (someone signed up with the same
    // email between our check above and the insert). Surface as
    // email_exists rather than 500.
    if (String(err && err.message || "").includes("UNIQUE")) {
      return jsonError(409, "email_exists", "An account with that email already exists.");
    }
    return jsonError(500, "internal", "Account creation failed. Please retry.");
  }

  // Mint API key (separate insert — generateApiKey is async via SHA-256
  // hashing of the secret, so it doesn't slot into the batch above).
  const apiKey = await createApiKey(env, { accountId, userId, name: "Default" });

  // Session.
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 256);
  const { token, expiresAt } = await mintSession(env, { userId, accountId, ip, userAgent });

  await recordSignupAttempt(env, { email, ip, outcome: "success", score: score.score });
  await auditEvent(env, { accountId, userId, action: "user.signup", request, meta: { score: score.score, reasons: score.reasons } });
  await auditEvent(env, { accountId, userId, action: "apikey.create", request, meta: { keyId: apiKey.id, prefix: apiKey.prefix, scopes: apiKey.scopes } });

  // Sign the API-key payload for the one-shot reveal cookie. The actual
  // key value never lands in this JSON response body — only metadata
  // (prefix + scopes) — so a downstream caller logging the response
  // can't leak the secret. /onboarding fetches the value via
  // POST /api/auth/signup/reveal, which validates session + HMAC
  // signature and clears the cookie on first read.
  const revealSigned = await signRevealPayload(env, {
    userId,
    accountId,
    apiKeyId: apiKey.id,
    apiKeyPrefix: apiKey.prefix,
    apiKeyFullKey: apiKey.fullKey,
    apiKeyScopes: apiKey.scopes,
  });

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...AUTH_CORS,
  };
  const response = new Response(JSON.stringify({
    user: { id: userId, email, name: null },
    account: { id: accountId, name: accountName, plan: "free", monthlyCapUsd: 0 },
    apiKey: {
      prefix: apiKey.prefix,
      scopes: apiKey.scopes,
      reveal_via: "POST /api/auth/signup/reveal",
    },
    redirectTo: "/onboarding",
  }), { status: 201, headers });
  response.headers.append("Set-Cookie", sessionCookieHeader(token, expiresAt));
  response.headers.append("Set-Cookie", loggedInIndicatorCookie(expiresAt));
  response.headers.append("Set-Cookie", revealCookieHeader(revealSigned));
  return response;
}
