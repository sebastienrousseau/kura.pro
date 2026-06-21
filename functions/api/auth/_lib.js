/**
 * Shared primitives for the public auth endpoints under /api/auth/*.
 *
 * Multi-tenant data lives in D1 (binding `ACCOUNTS_DB`). Argon2id runs
 * in the standalone `cloudcdn-auth-hasher` Worker (service binding
 * `AUTH_HASHER`). Both bindings activated in wrangler.toml — see
 * migrations/0001_init.sql for the schema.
 *
 * Pure functions only — no top-level side effects. Every helper takes
 * `env` (or `db`) explicitly so the module is trivially mockable in
 * vitest.
 */

import { CORS_JSON, jsonResponse, appendAuditLog as legacyAuditLog } from "../_shared.js";

// ── Constants ─────────────────────────────────────────────────────

export const SESSION_COOKIE = "cdn_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;   // 7 days
export const LOGIN_RATE_LIMIT = 5;                      // per IP per 15 min
export const LOGIN_RATE_WINDOW = 15 * 60;
export const SIGNUP_RATE_LIMIT = 5;                     // per IP per hour
export const SIGNUP_RATE_WINDOW = 60 * 60;
export const POLICY_VERSION = "2026-06-21";             // bump on ToS/Privacy revision

const API_KEY_PREFIX = "cdn_test_";                     // until billing is wired

// ── D1 helpers ────────────────────────────────────────────────────

export function getDB(env) {
  if (!env || !env.ACCOUNTS_DB) {
    throw new Error("ACCOUNTS_DB binding missing — D1 not configured");
  }
  return env.ACCOUNTS_DB;
}

export function hasAccountsDB(env) {
  return !!(env && env.ACCOUNTS_DB);
}

// ── Identifiers ───────────────────────────────────────────────────

export function uuid() {
  return crypto.randomUUID();
}

export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomBase62(length) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  // Rejection sampling: 256 % 62 = 8, so bytes >= 248 would bias the
  // first 8 alphabet chars to 5/256 vs 4/256 for the rest. Reject those.
  const MAX = 248; // largest multiple of 62 below 256
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length - out.length + 8));
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] < MAX) out += alphabet[bytes[i] % 62];
    }
  }
  return out;
}

// Session token: opaque random; the server only stores its SHA-256 hash.
export function generateSessionToken() {
  return randomBase62(48);
}

// API key: `cdn_test_` + 8-char prefix + "_" + 40-char secret body.
// The prefix is kept in plaintext in the DB row for human identification.
export function generateApiKey() {
  const prefix = API_KEY_PREFIX + randomBase62(8);
  const body = randomBase62(40);
  const fullKey = `${prefix}_${body}`;
  return { prefix, body, fullKey };
}

// ── Argon2id via the auth-hasher Worker ──────────────────────────

export async function hashPassword(env, password) {
  if (!env || !env.AUTH_HASHER) {
    throw new Error("AUTH_HASHER binding missing — service binding not configured");
  }
  const res = await env.AUTH_HASHER.fetch("https://auth-hasher.internal/hash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    throw new Error(`auth-hasher /hash failed: ${res.status}`);
  }
  const { hash } = await res.json();
  return hash;
}

export async function verifyPassword(env, password, hash) {
  if (!env || !env.AUTH_HASHER) {
    throw new Error("AUTH_HASHER binding missing — service binding not configured");
  }
  const res = await env.AUTH_HASHER.fetch("https://auth-hasher.internal/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, hash }),
  });
  if (!res.ok) return false;
  const { valid } = await res.json();
  return !!valid;
}

// ── HIBP Pwned-Passwords k-anonymity check ───────────────────────
// SHA-1 the password, send the first 5 hex chars, receive a list of
// suffixes+counts, compare locally. Free, no API key. ~100ms.

export async function isPasswordPwned(password) {
  const enc = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest("SHA-1", enc);
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const prefix = hex.slice(0, 5);
  const suffix = hex.slice(5);
  let res;
  try {
    res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "cloudcdn.pro/0.1" },
    });
  } catch {
    // Network failure: don't block signup on a third-party probe.
    return { pwned: false, count: 0, checked: false };
  }
  if (!res.ok) return { pwned: false, count: 0, checked: false };
  const body = await res.text();
  for (const line of body.split("\n")) {
    const [s, c] = line.trim().split(":");
    if (s === suffix) {
      const count = parseInt(c, 10) || 0;
      return { pwned: count > 0, count, checked: true };
    }
  }
  return { pwned: false, count: 0, checked: true };
}

// ── Sessions ─────────────────────────────────────────────────────

export async function mintSession(env, { userId, accountId, ip, userAgent }) {
  const db = getDB(env);
  const token = generateSessionToken();
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, account_id, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7)`
    )
    .bind(tokenHash, userId, accountId || null, now, expiresAt, ip || null, userAgent || null)
    .run();
  return { token, expiresAt };
}

export function sessionCookieHeader(token, expiresAt) {
  const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function loggedInIndicatorCookie(expiresAt) {
  const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  return `cdn_logged_in=1; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedLoggedInIndicatorCookie() {
  return `cdn_logged_in=; Path=/; Secure; SameSite=Lax; Max-Age=0`;
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Returns { session, user, account } or null if no valid session.
export async function getCurrentSession(env, request) {
  if (!hasAccountsDB(env)) return null;
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const db = getDB(env);
  const row = await db
    .prepare(
      `SELECT s.token_hash, s.user_id, s.account_id, s.expires_at, s.revoked_at,
              u.email, u.name, u.email_verified_at,
              a.id AS account_id_full, a.name AS account_name, a.plan, a.monthly_cap_usd
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ?1`
    )
    .bind(tokenHash)
    .first();
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.revoked_at) return null;
  if (row.expires_at < now) return null;
  // Bump last_seen (fire-and-forget — don't block the request).
  db.prepare(`UPDATE sessions SET last_seen_at = ?1 WHERE token_hash = ?2`)
    .bind(now, tokenHash).run().catch(() => {});
  return {
    session: {
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
    },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      emailVerifiedAt: row.email_verified_at,
    },
    account: row.account_id_full ? {
      id: row.account_id_full,
      name: row.account_name,
      plan: row.plan,
      monthlyCapUsd: row.monthly_cap_usd,
    } : null,
  };
}

export async function revokeSession(env, tokenHash) {
  const db = getDB(env);
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`UPDATE sessions SET revoked_at = ?1 WHERE token_hash = ?2`)
    .bind(now, tokenHash).run();
}

// ── Account + API key provisioning ───────────────────────────────

export async function createApiKey(env, { accountId, userId, name = "Default", scopes = ["read", "write"] }) {
  const db = getDB(env);
  const id = uuid();
  const { prefix, fullKey } = generateApiKey();
  const hashedSecret = await sha256Hex(fullKey);
  await db
    .prepare(
      `INSERT INTO api_keys (id, account_id, name, prefix, hashed_secret, scopes, created_by_user_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
    .bind(id, accountId, name, prefix, hashedSecret, JSON.stringify(scopes), userId)
    .run();
  return { id, prefix, fullKey, scopes };
}

// ── Audit log (D1-backed, account-scoped) ────────────────────────

export async function auditEvent(env, { accountId, userId, action, request, meta }) {
  // Prefer D1 when available; fall back to the existing KV audit log
  // so we don't lose events during the dual-write phase.
  const ip = request?.headers?.get?.("cf-connecting-ip") || null;
  const userAgent = (request?.headers?.get?.("user-agent") || "").slice(0, 256);
  const requestId = request?.headers?.get?.("x-trace-id") || null;
  if (hasAccountsDB(env)) {
    try {
      await getDB(env)
        .prepare(
          `INSERT INTO audit_events (id, account_id, user_id, action, ip, user_agent, request_id, meta)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        )
        .bind(uuid(), accountId || null, userId || null, action, ip, userAgent || null, requestId, meta ? JSON.stringify(meta) : null)
        .run();
    } catch { /* swallow — audit must never break a user operation */ }
  }
  // Always mirror to the KV log too while we're in dual-write mode.
  try { await legacyAuditLog(env, request, action, { accountId, userId, ...(meta || {}) }); } catch {}
}

// ── Turnstile siteverify ─────────────────────────────────────────

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) {
    // No secret configured — treat as fail-open in local dev, fail-closed
    // in production (matches the STRICT_AUTH pattern in _shared.js).
    return env.STRICT_AUTH === "1" || env.STRICT_AUTH === "true" ? false : true;
  }
  if (!token) return false;
  const form = new URLSearchParams();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.success;
  } catch {
    return false;
  }
}

// ── Anti-abuse scoring ───────────────────────────────────────────

// A tiny disposable-email blocklist. The full list is too big to ship
// inline — production should swap to a KV-backed lookup (Phase 1).
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "throwaway.email", "yopmail.com", "trashmail.com", "getnada.com",
  "sharklasers.com", "fakeinbox.com", "tempinbox.com",
]);

export function isDisposableEmail(email) {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

// Returns { score, reasons[] }. Higher = more suspicious.
//   0-10: allow
//   11-30: soft-challenge (force email verification before API key issuance)
//   31+: hard reject
export function scoreSignupAttempt({ request, email, elapsedMs, honeypot }) {
  let score = 0;
  const reasons = [];
  const cf = request?.cf || {};
  if (honeypot) { score += 100; reasons.push("honeypot_filled"); }
  if (typeof elapsedMs === "number" && elapsedMs < 1500) { score += 50; reasons.push("submitted_too_fast"); }
  if (email && isDisposableEmail(email)) { score += 40; reasons.push("disposable_email"); }
  const threat = typeof cf.threatScore === "number" ? cf.threatScore : 0;
  if (threat >= 50) { score += 30; reasons.push(`high_threat_score:${threat}`); }
  else if (threat >= 20) { score += 10; reasons.push(`medium_threat_score:${threat}`); }
  // Hosting-provider ASNs (DigitalOcean, OVH, Hetzner, AWS, Linode) —
  // soft signal only; many legit devs are on these during testing.
  const HOSTING_ASNS = new Set([14061, 16276, 24940, 16509, 63949]);
  if (cf.asn && HOSTING_ASNS.has(cf.asn)) { score += 5; reasons.push(`hosting_asn:${cf.asn}`); }
  return { score, reasons };
}

// ── Logging convenience for signup_attempts ──────────────────────

export async function recordSignupAttempt(env, { email, ip, outcome, score, meta }) {
  if (!hasAccountsDB(env)) return;
  try {
    await getDB(env)
      .prepare(
        `INSERT INTO signup_attempts (id, email, ip, outcome, score, meta)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(uuid(), email || null, ip || null, outcome, score ?? null, meta ? JSON.stringify(meta) : null)
      .run();
  } catch { /* swallow */ }
}

// ── Response helpers ─────────────────────────────────────────────

export const AUTH_CORS = {
  ...CORS_JSON,
  "Access-Control-Allow-Credentials": "true",
};

export function authJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...AUTH_CORS, ...extraHeaders },
  });
}

export function jsonError(status, code, message, extra) {
  return authJson({ error: { code, message, ...(extra || {}) } }, status);
}

// Default re-export so the legacy json helper isn't shadowed where used.
export { jsonResponse };
