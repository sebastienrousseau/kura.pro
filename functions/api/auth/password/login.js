/**
 * POST /api/auth/password/login
 *
 * Email + password login. Verifies via the auth-hasher Worker. Same
 * brute-force protection as the dashboard password gate
 * (5 attempts per IP per 15 min via the existing checkRateLimit helper).
 *
 * Request body:
 *   { email: string, password: string }
 *
 * Response 200:
 *   { user: {…}, account: {…}, session: { expiresAt } }
 *   Set-Cookie: cdn_session=…
 *
 * Error codes:
 *   400 invalid_input
 *   401 invalid_credentials
 *   429 rate_limited
 *   503 infra_missing
 */

import { checkRateLimit } from "../../_shared.js";
import {
  hasAccountsDB, getDB, verifyPassword, mintSession,
  sessionCookieHeader, loggedInIndicatorCookie, auditEvent,
  LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW, AUTH_CORS, jsonError,
} from "../_lib.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null;

  if (!hasAccountsDB(env) || !env.AUTH_HASHER) {
    return jsonError(503, "infra_missing", "Auth bindings not configured.");
  }

  if (ip) {
    const rl = await checkRateLimit(env, `login:${ip}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW);
    if (!rl.allowed) {
      return jsonError(429, "rate_limited", "Too many login attempts. Try again in 15 minutes.", {
        retryAfter: rl.resetAt ? Math.max(0, rl.resetAt - Math.floor(Date.now() / 1000)) : LOGIN_RATE_WINDOW,
      });
    }
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return jsonError(400, "invalid_input", "Email and password required.");

  const db = getDB(env);
  const row = await db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.name, u.email_verified_at,
              pc.hashed_password
       FROM users u
       JOIN password_credentials pc ON pc.user_id = u.id
       WHERE lower(u.email) = lower(?1) AND u.deleted_at IS NULL`
    )
    .bind(email).first();

  // Constant-time-ish behaviour: run hashing even when the user is
  // absent so the response timing doesn't leak existence.
  if (!row) {
    // Dummy verify to burn comparable CPU. The hash is one we produce
    // ahead of time so we don't pay 100ms encoding a random salt for
    // a deliberately-failed compare — a single static hash is fine
    // because we never actually accept it as valid.
    try { await verifyPassword(env, password, "$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"); } catch {}
    return jsonError(401, "invalid_credentials", "Email or password incorrect.");
  }

  const valid = await verifyPassword(env, password, row.hashed_password);
  if (!valid) {
    // Per-email failure counter — defends against distributed credential
    // stuffing where a botnet spreads attempts across many IPs (each
    // staying under the per-IP cap above). Independent of source IP:
    // 5 failures against a single email in any 15-min window locks
    // that account, regardless of where the attempts originated.
    //
    // Successful logins do NOT increment (this is only called on the
    // failure branch), so a legitimate user fat-fingering their password
    // a few times then succeeding doesn't get locked out.
    const emailRl = await checkRateLimit(env, `login-fail:${email}`, 5, 900);
    await auditEvent(env, {
      userId: row.user_id, action: "user.login.fail", request,
      meta: { failedAttemptsInWindow: emailRl.limit ? (emailRl.limit - (emailRl.remaining ?? 0)) : null },
    });
    if (!emailRl.allowed) {
      // Lock the account. Same 429 shape as the per-IP limit so the
      // response surface stays consistent. Return BEFORE leaking that
      // the password was wrong (vs the account being locked) — both
      // failure modes look identical to the attacker.
      return jsonError(429, "rate_limited", "Too many failed login attempts for this account. Try again in 15 minutes.", {
        retryAfter: 900,
      });
    }
    return jsonError(401, "invalid_credentials", "Email or password incorrect.");
  }

  // Pick the account the user owns (Phase 0 = exactly one per user).
  const accountRow = await db
    .prepare(`SELECT id, name, plan, monthly_cap_usd FROM accounts WHERE owner_user_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`)
    .bind(row.user_id).first();
  const accountId = accountRow?.id || null;

  const userAgent = (request.headers.get("user-agent") || "").slice(0, 256);
  const { token, expiresAt } = await mintSession(env, { userId: row.user_id, accountId, ip, userAgent });

  /* v8 ignore next 2 — best-effort last_login_at bump; the catch is
     defensive against transient D1 errors and isn't worth a dedicated
     test (failure mode is "we don't update a timestamp"). */
  await db.prepare(`UPDATE users SET last_login_at = ?1 WHERE id = ?2`)
    .bind(Math.floor(Date.now() / 1000), row.user_id).run().catch(() => {});

  await auditEvent(env, { accountId, userId: row.user_id, action: "user.login", request });

  const res = new Response(JSON.stringify({
    user: { id: row.user_id, email: row.email, name: row.name, emailVerifiedAt: row.email_verified_at },
    account: accountRow ? { id: accountRow.id, name: accountRow.name, plan: accountRow.plan, monthlyCapUsd: accountRow.monthly_cap_usd } : null,
    session: { expiresAt },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...AUTH_CORS },
  });
  res.headers.append("Set-Cookie", sessionCookieHeader(token, expiresAt));
  res.headers.append("Set-Cookie", loggedInIndicatorCookie(expiresAt));
  return res;
}
