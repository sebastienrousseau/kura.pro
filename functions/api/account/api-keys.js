/**
 * Session-gated, account-scoped API key management.
 *
 * GET    /api/account/api-keys          — list keys (redacted: prefix
 *                                          only, never the secret)
 * POST   /api/account/api-keys          — create a key. Body:
 *                                          { name, scopes?, expiresInDays? }
 *                                          Response includes the full
 *                                          key ONCE (not stored
 *                                          plaintext after).
 * DELETE /api/account/api-keys?id=...   — revoke
 *
 * Auth: D1 session cookie (cdn_session) — any session member of the
 * account can list/create/revoke.
 *
 * Phase 1 complement to functions/api/tokens.js (which kept the
 * existing global-admin KV-backed flow for backwards compat). New
 * accounts created via /api/auth/signup use this surface for their
 * keys; the validator at functions/api/tokens.js:validateToken now
 * dispatches to D1 for `cdn_test_*` / `cdn_live_*` prefixed keys
 * and to KV for the legacy `cdnsk_*` keys.
 */

import {
  hasAccountsDB, getDB, uuid, sha256Hex, getCurrentSession,
  createApiKey, auditEvent, AUTH_CORS, jsonError, authJson,
} from "../auth/_lib.js";

const VALID_SCOPES = new Set([
  "storage:read", "storage:write",
  "assets:read",
  "insights:read",
  "zones:read", "zones:write",
  "purge:write",
  "pipeline:write",
  "webhooks:read", "webhooks:write",
  "ai:read",
  "read", "write", // generic ("Default" key from signup)
]);

const MAX_KEYS_PER_ACCOUNT = 50;
const NAME_MAX = 100;

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...AUTH_CORS, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Max-Age": "86400" },
  });
}

// ── GET ──────────────────────────────────────────────────────────

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");
  const current = await getCurrentSession(env, request);
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");
  if (!current.account) return jsonError(403, "no_account", "No account associated with this session.");

  const db = getDB(env);
  const { results } = await db
    .prepare(
      `SELECT id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at, created_by_user_id
       FROM api_keys
       WHERE account_id = ?1
       ORDER BY created_at DESC`
    )
    .bind(current.account.id).all();
  /* v8 ignore next — defensive `|| []` when D1 returns no results
     property; the all() shape is `{ results }` and we already have
     tests for the populated path. */
  return authJson({
    keys: (results || []).map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: safeJsonArray(r.scopes),
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      createdByUserId: r.created_by_user_id,
    })),
  });
}

// ── POST ─────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");
  const current = await getCurrentSession(env, request);
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");
  if (!current.account) return jsonError(403, "no_account", "No account associated with this session.");

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > NAME_MAX) {
    return jsonError(400, "invalid_input", `Name required (1-${NAME_MAX} chars).`);
  }

  const requestedScopes = Array.isArray(body.scopes) && body.scopes.length > 0
    ? body.scopes
    : ["read", "write"];
  const invalid = requestedScopes.filter((s) => !VALID_SCOPES.has(s));
  if (invalid.length > 0) {
    return jsonError(400, "invalid_input", `Invalid scopes: ${invalid.join(", ")}`);
  }

  // Hard cap so a runaway script can't fill the table.
  const countRow = await getDB(env)
    .prepare(`SELECT count(*) AS n FROM api_keys WHERE account_id = ?1 AND revoked_at IS NULL`)
    .bind(current.account.id).first();
  if (countRow && Number(countRow.n) >= MAX_KEYS_PER_ACCOUNT) {
    return jsonError(400, "limit_reached", `Maximum ${MAX_KEYS_PER_ACCOUNT} active keys per account.`);
  }

  const key = await createApiKey(env, {
    accountId: current.account.id,
    userId: current.user.id,
    name,
    scopes: requestedScopes,
  });

  await auditEvent(env, {
    accountId: current.account.id, userId: current.user.id,
    action: "apikey.create", request,
    meta: { keyId: key.id, prefix: key.prefix, scopes: requestedScopes },
  });

  return authJson({
    key: {
      id: key.id,
      name,
      prefix: key.prefix,
      fullKey: key.fullKey,           // shown ONCE, like the signup flow
      scopes: requestedScopes,
      reveal_warning: "Save this now — it is not retrievable later.",
    },
  }, 201);
}

// ── DELETE ──────────────────────────────────────────────────────

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");
  const current = await getCurrentSession(env, request);
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");
  if (!current.account) return jsonError(403, "no_account", "No account associated with this session.");

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError(400, "invalid_input", "?id= required.");

  const now = Math.floor(Date.now() / 1000);
  const result = await getDB(env)
    .prepare(`UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND account_id = ?3 AND revoked_at IS NULL`)
    .bind(now, id, current.account.id).run();
  // D1 doesn't surface a precise "affected rows" cleanly across drivers;
  // we surface a 200 either way (idempotent semantics) but audit-log
  // only the row we own (account_id-scoped UPDATE already enforces this).
  await auditEvent(env, {
    accountId: current.account.id, userId: current.user.id,
    action: "apikey.revoke", request,
    meta: { keyId: id, success: result?.success !== false },
  });
  return authJson({ revoked: true, id });
}

// ── Validator (exported for tokens.js to dispatch to) ───────────

const D1_TOKEN_PREFIXES = ["cdn_test_", "cdn_live_"];

export function isD1Token(token) {
  if (typeof token !== "string") return false;
  return D1_TOKEN_PREFIXES.some((p) => token.startsWith(p));
}

// Validate a D1-stored API key from a bearer-style header value.
// Returns { valid, accountId, scopes } or { valid: false }.
export async function validateD1ApiKey(env, fullKey, requiredScope) {
  if (!hasAccountsDB(env) || !isD1Token(fullKey)) return { valid: false };
  // Prefix is everything up to the last underscore-separated segment;
  // our format is `<prefix-with-1-underscore>_<40-char-secret>`.
  // createApiKey assembles `cdn_test_AAAAAAAA_<40>` — 4 underscore-
  // segments. Take the first three joined as the prefix.
  const parts = fullKey.split("_");
  if (parts.length < 4) return { valid: false };
  const prefix = parts.slice(0, 3).join("_");
  const hashed = await sha256Hex(fullKey);

  const row = await getDB(env)
    .prepare(
      `SELECT id, account_id, scopes, expires_at, revoked_at
       FROM api_keys
       WHERE prefix = ?1 AND hashed_secret = ?2`
    )
    .bind(prefix, hashed).first();
  if (!row) return { valid: false };
  if (row.revoked_at) return { valid: false };
  if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) return { valid: false };

  const scopes = safeJsonArray(row.scopes);
  if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes("write")) {
    return { valid: false, reason: "scope_missing" };
  }

  // Fire-and-forget last-used bump.
  /* v8 ignore next 3 — best-effort UPDATE; the catch is defensive and
     the failure mode is "we don't update a timestamp". */
  getDB(env).prepare(`UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2`)
    .bind(Math.floor(Date.now() / 1000), row.id).run().catch(() => {});

  return { valid: true, accountId: row.account_id, scopes };
}

function safeJsonArray(raw) {
  if (!raw) return [];
  /* v8 ignore next 2 — defensive JSON parse + Array.isArray guard;
     scopes are always written as JSON arrays from createApiKey so
     these branches only trip on a corrupted DB row. */
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
