/**
 * POST /api/auth/onboarding/zone
 * GET  /api/auth/onboarding/zone
 *
 * Session-gated. Provisions a per-account zone (D1 `account_zones`
 * row) during the /onboarding wizard. Replaces the client-side HEAD
 * probe at step 2 — the server now validates the origin (HEAD with a
 * 5-second timeout) and persists the result, so a zone row exists
 * before the wizard's step 3 is rendered.
 *
 * Live edge-hostname routing is Phase 3. This endpoint stores the
 * aspirational hostname (`<slug>.cdn.cloudcdn.pro`) and a `live: false`
 * flag; the user sees the hostname in the wizard with a "preview"
 * label until routing is provisioned.
 *
 * POST body:
 *   { name: string,           // user-facing display name (1-64 chars)
 *     originUrl: string }     // http:// or https:// URL
 *
 * POST 201:
 *   { zone: { id, name, slug, edgeHostname, originUrl,
 *             originStatus, live, createdAt } }
 *
 * GET response:
 *   { zones: [ ... ] }        // all zones for the session's account
 *
 * Error codes:
 *   400 invalid_input         — bad body / name / URL
 *   401 unauthenticated       — no active session
 *   403 no_account            — session has no associated account
 *   409 slug_conflict         — slug already taken on this account
 *   503 infra_missing         — ACCOUNTS_DB binding absent
 */

import {
  hasAccountsDB, getDB, uuid, getCurrentSession, auditEvent,
  AUTH_CORS, jsonError, authJson,
} from "../_lib.js";

const NAME_MIN = 1;
const NAME_MAX = 64;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
const HEAD_PROBE_TIMEOUT_MS = 5000;
const EDGE_HOSTNAME_SUFFIX = ".cdn.cloudcdn.pro";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

// ── Helpers ──────────────────────────────────────────────────────

export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip diacritics
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

// Best-effort origin reachability probe. We don't gate provisioning on
// the result — many origins block HEAD or require headers we don't
// have — but the user gets useful feedback in the wizard and the
// status is persisted for later operator inspection.
export async function probeOrigin(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEAD_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
      headers: { "User-Agent": "cloudcdn.pro/0.1 (+probe)" },
      redirect: "manual",
    });
    if (res.status >= 200 && res.status < 400) return "ok";
    return `http_error:${res.status}`;
  } catch (err) {
    if (err && err.name === "AbortError") return "timeout";
    const msg = String(err && err.message || err).toLowerCase();
    if (msg.includes("certificate") || msg.includes("tls") || msg.includes("ssl")) return "tls_error";
    return "unreachable";
  } finally {
    clearTimeout(t);
  }
}

// Generate an account-unique slug. The user's free-text name is
// sanitised into a base slug; if that collides, an 8-character
// alphanumeric suffix is appended. Two retries on suffix collision
// (vanishingly unlikely past one) then we surface a 409 to the user.
async function pickSlug(env, accountId, candidate) {
  const db = getDB(env);
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0
      ? candidate
      : `${candidate}-${randomSuffix(8)}`;
    if (!SLUG_RE.test(slug)) continue;
    const existing = await db
      .prepare(`SELECT id FROM account_zones WHERE account_id = ?1 AND slug = ?2 AND deleted_at IS NULL`)
      .bind(accountId, slug).first();
    if (!existing) return slug;
  }
  return null;
}

function randomSuffix(n) {
  const alpha = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(n + 8));
  // Rejection sampling — 256 % 36 = 4 so values >= 252 bias the low
  // alphabet entries. Same pattern as randomBase62 in auth/_lib.js.
  const MAX = 252;
  let out = "";
  for (let i = 0; i < bytes.length && out.length < n; i++) {
    if (bytes[i] < MAX) out += alpha[bytes[i] % 36];
  }
  return out.slice(0, n);
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
      `SELECT id, name, slug, origin_url, edge_hostname, origin_status, live, created_at
       FROM account_zones
       WHERE account_id = ?1 AND deleted_at IS NULL
       ORDER BY created_at ASC`
    )
    .bind(current.account.id).all();
  return authJson({
    zones: (results || []).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      originUrl: r.origin_url,
      edgeHostname: r.edge_hostname,
      originStatus: r.origin_status,
      live: !!r.live,
      createdAt: r.created_at,
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
  const originUrlRaw = typeof body.originUrl === "string" ? body.originUrl.trim() : "";
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return jsonError(400, "invalid_input", `Name must be ${NAME_MIN}-${NAME_MAX} characters.`);
  }
  let originUrl;
  try {
    const u = new URL(originUrlRaw);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return jsonError(400, "invalid_input", "Origin URL must be http:// or https://.");
    }
    originUrl = u.toString();
  } catch {
    return jsonError(400, "invalid_input", "Origin URL is not a valid URL.");
  }

  const baseSlug = slugify(name);
  if (!baseSlug || !SLUG_RE.test(baseSlug)) {
    return jsonError(400, "invalid_input", "Name must contain at least one alphanumeric character.");
  }

  const slug = await pickSlug(env, current.account.id, baseSlug);
  if (!slug) {
    return jsonError(409, "slug_conflict", "Could not allocate a unique slug for this account. Pick a different name.");
  }

  const originStatus = await probeOrigin(originUrl);
  const id = uuid();
  const edgeHostname = `${slug}${EDGE_HOSTNAME_SUFFIX}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    await getDB(env)
      .prepare(
        `INSERT INTO account_zones (id, account_id, name, slug, origin_url, edge_hostname, origin_status, origin_checked_at, live, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`
      )
      .bind(id, current.account.id, name, slug, originUrl, edgeHostname, originStatus, now, current.user.id)
      .run();
  } catch (err) {
    if (String(err && err.message || "").includes("UNIQUE")) {
      // Slug-race or edge-hostname race; surface as 409 so the wizard
      // can prompt for a different name.
      return jsonError(409, "slug_conflict", "That slug just got taken — pick a different name.");
    }
    return jsonError(500, "internal", "Could not provision zone. Please retry.");
  }

  await auditEvent(env, {
    accountId: current.account.id, userId: current.user.id,
    action: "zone.provision", request,
    meta: { zoneId: id, slug, originStatus },
  });

  return authJson({
    zone: {
      id, name, slug,
      edgeHostname, originUrl, originStatus,
      live: false,
      createdAt: now,
    },
  }, 201);
}
