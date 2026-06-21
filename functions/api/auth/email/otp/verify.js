/**
 * POST /api/auth/email/otp/verify
 *
 * Submit a 6-digit code from /api/auth/email/otp/send. On success,
 * marks the verification row consumed AND sets users.email_verified_at
 * on the matching user (if any). Stripe-style deferred verification —
 * the user can sign up and use the dashboard before verifying, but
 * high-value actions (API key creation in the prod plan, billing setup
 * later) can gate on email_verified_at IS NOT NULL.
 *
 * Request body:  { email, code }
 * Response 200:  { verified: true }
 * Response 400:  invalid_input | invalid_code (5 attempts max per row,
 *                then the row is invalidated)
 * Response 429:  rate_limited
 * Response 503:  bindings missing
 */

import { checkRateLimit } from "../../../_shared.js";
import {
  hasAccountsDB, getDB, sha256Hex, auditEvent,
  AUTH_CORS, jsonError, authJson,
} from "../../_lib.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[0-9]{6}$/;
const MAX_ATTEMPTS_PER_ROW = 5;
const PER_IP_LIMIT = 20;
const PER_IP_WINDOW = 60 * 60;

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

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!EMAIL_RE.test(email)) return jsonError(400, "invalid_input", "Valid email required.");
  if (!CODE_RE.test(code)) return jsonError(400, "invalid_input", "Code must be 6 digits.");

  // Per-IP attempt limit so an attacker can't brute-force codes by
  // spreading guesses across IPs.
  if (ip) {
    const rl = await checkRateLimit(env, `otp-verify:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW);
    if (!rl.allowed) {
      return jsonError(429, "rate_limited", "Too many verification attempts. Try again later.", {
        retryAfter: rl.resetAt ? Math.max(0, rl.resetAt - Math.floor(Date.now() / 1000)) : PER_IP_WINDOW,
      });
    }
  }

  const db = getDB(env);
  const now = Math.floor(Date.now() / 1000);

  // Pick the most recent unconsumed, unexpired row for this email.
  // There may be multiple if the user requested several codes — only
  // the latest is valid (older ones won't have a matching code in
  // practice but we tighten by ordering DESC).
  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM email_verifications
       WHERE email = ?1
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(email).first();

  if (!row || row.consumed_at || row.expires_at < now || row.attempts >= MAX_ATTEMPTS_PER_ROW) {
    return jsonError(400, "invalid_code", "Code is invalid or expired. Request a new one.");
  }

  const expectedHash = await sha256Hex(`${email}:${code}`);
  if (expectedHash !== row.code_hash) {
    /* v8 ignore next 2 — defensive catch on a counter bump; the test
       exercises the wrong-code branch but not the catch path. */
    await db.prepare(`UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?1`)
      .bind(row.id).run().catch(() => {});
    return jsonError(400, "invalid_code", "Code is invalid or expired.");
  }

  // Mark consumed + verify the user (if one exists for this email yet).
  await db.batch([
    db.prepare(`UPDATE email_verifications SET consumed_at = ?1 WHERE id = ?2`).bind(now, row.id),
    db.prepare(`UPDATE users SET email_verified_at = ?1 WHERE lower(email) = lower(?2) AND email_verified_at IS NULL AND deleted_at IS NULL`).bind(now, email),
  ]);

  await auditEvent(env, { action: "email.verified", request, meta: { email } });

  return authJson({ verified: true });
}
