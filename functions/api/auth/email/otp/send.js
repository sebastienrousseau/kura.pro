/**
 * POST /api/auth/email/otp/send
 *
 * Request a 6-digit one-time verification code. Stored hashed in D1
 * `email_verifications` with a 10-min TTL; delivered via Resend (see
 * functions/api/auth/_email.js).
 *
 * Rate limit: 5 codes per email per hour, 10 sends per IP per hour.
 *
 * Request body:  { email }
 * Response 200:  { sent: true, expiresInSeconds: 600 }
 *                (always 200 + same body whether the email exists or
 *                 not — prevents account enumeration)
 * Response 429:  { error: { code: "rate_limited", retryAfter } }
 * Response 503:  bindings missing
 */

import { checkRateLimit } from "../../../_shared.js";
import {
  hasAccountsDB, getDB, uuid, sha256Hex,
  AUTH_CORS, jsonError, authJson,
} from "../../_lib.js";
import { sendTransactionalEmail, buildOtpEmail } from "../../_email.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_SECONDS = 10 * 60;
const PER_EMAIL_LIMIT = 5;       // codes/hour/email
const PER_EMAIL_WINDOW = 60 * 60;
const PER_IP_LIMIT = 10;         // sends/hour/IP
const PER_IP_WINDOW = 60 * 60;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

// Generate a 6-digit numeric code with rejection sampling so the
// distribution is uniform (the trivial `% 1000000` form biases the
// low digits — same trick as randomBase62 in _lib.js).
function generateSixDigitOtp() {
  // 4-byte values up to 4_294_967_295. We accept values < 4_200_000_000
  // (largest multiple of 1_000_000 below 2**32) and reject the rest.
  const MAX = 4_200_000_000;
  while (true) {
    const buf = crypto.getRandomValues(new Uint32Array(1));
    if (buf[0] < MAX) {
      return String(buf[0] % 1_000_000).padStart(6, "0");
    }
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get("cf-connecting-ip") || null;

  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return jsonError(400, "invalid_input", "Valid email required.");
  }

  // Per-IP rate limit first (cheap), then per-email.
  if (ip) {
    const rlIp = await checkRateLimit(env, `otp:ip:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW);
    if (!rlIp.allowed) {
      return jsonError(429, "rate_limited", "Too many requests. Try again later.", {
        retryAfter: rlIp.resetAt ? Math.max(0, rlIp.resetAt - Math.floor(Date.now() / 1000)) : PER_IP_WINDOW,
      });
    }
  }
  const rlEmail = await checkRateLimit(env, `otp:email:${email}`, PER_EMAIL_LIMIT, PER_EMAIL_WINDOW);
  if (!rlEmail.allowed) {
    return jsonError(429, "rate_limited", "Too many codes requested for this email. Try again later.", {
      retryAfter: rlEmail.resetAt ? Math.max(0, rlEmail.resetAt - Math.floor(Date.now() / 1000)) : PER_EMAIL_WINDOW,
    });
  }

  const code = generateSixDigitOtp();
  const codeHash = await sha256Hex(`${email}:${code}`); // bind hash to email so the table is per-account
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + OTP_TTL_SECONDS;

  try {
    await getDB(env)
      .prepare(
        `INSERT INTO email_verifications (id, email, code_hash, expires_at)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(uuid(), email, codeHash, expiresAt)
      .run();
  } catch {
    return jsonError(500, "internal", "Could not store verification code. Retry.");
  }

  // Send the email. Failure to deliver is logged but the response is
  // the same — we don't reveal "this email isn't real / bounced" to
  // the caller (account-enumeration defence + matches Stripe's
  // posture). Operators see the failure in Logs + the email_
  // verifications row will simply expire unused.
  const { subject, html, text } = buildOtpEmail({ code, ttlMinutes: OTP_TTL_SECONDS / 60 });
  await sendTransactionalEmail(env, { to: email, subject, html, text });

  return authJson({ sent: true, expiresInSeconds: OTP_TTL_SECONDS });
}
