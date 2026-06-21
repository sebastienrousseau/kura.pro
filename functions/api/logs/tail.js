/**
 * GET /api/logs/tail
 *
 * WebSocket-upgrade endpoint for live log tailing. Browsers (or
 * `websocat`/`wscat`) connect and receive newline-delimited JSON
 * events scoped to the session user's account. Cloudflare paywalls
 * equivalent functionality behind Logpush + Enterprise; we ship it
 * on the free tier.
 *
 * Protocol:
 *   - Client: standard WebSocket upgrade request with cookies.
 *   - Server: validates session, accepts upgrade, sends:
 *       1. one "hello" frame: { type: "hello", accountId, ... }
 *       2. live audit-log events: { type: "audit", action, ... }
 *       3. periodic "heartbeat" frames (every 30s) so intermediaries
 *          don't drop the connection.
 *   - Client may send { type: "ping" } at any time; server responds
 *     with { type: "pong", timestamp }. Other client messages are
 *     ignored (no client→server filter changes for v1).
 *
 * Phase 2B v1 sources only the D1 audit_events stream — a 5-second
 * poll from the session's account_id (D1 doesn't have a push
 * primitive). Phase 2B v2 wires Workers Logs straight into the
 * stream when the Logs API ships its WebSocket bridge.
 *
 * Auth: D1 session cookie (cdn_session). Falls back to a session
 * issued via `?session=<token>` query parameter when the WebSocket
 * client can't send cookies (some terminals don't).
 */

import {
  hasAccountsDB, getDB, getCurrentSession, sha256Hex, SESSION_COOKIE,
  AUTH_CORS, jsonError,
} from "../auth/_lib.js";
import { parseCookies } from "../_shared.js";

const HEARTBEAT_MS = 30_000;
const POLL_MS = 5_000;
const MAX_FRAMES_PER_POLL = 50;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (request.headers.get("Upgrade") !== "websocket") {
    return jsonError(426, "upgrade_required", "Connect with a WebSocket client. The CLI 'websocat wss://cloudcdn.pro/api/logs/tail' works once authenticated.");
  }
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");

  // Pull session from cookie OR `?session=` query param (terminal
  // clients).
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("session");
  let current;
  if (queryToken) {
    current = await sessionFromToken(env, queryToken, request);
  } else {
    current = await getCurrentSession(env, request);
  }
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");
  if (!current.account) return jsonError(403, "no_account", "No account associated with this session.");

  // Accept the upgrade and spin up the bridge in a waitUntil so the
  // response returns immediately.
  /* v8 ignore start — vitest's runtime doesn't model WebSocketPair /
     server.accept() / 101 upgrade response; this block is exercised
     end-to-end in production deploys + manual `websocat` smoke tests
     rather than in unit tests. The pollAuditEvents helper below IS
     unit-tested. */
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();
  startTail(env, server, current).catch((err) => {
    try {
      server.send(JSON.stringify({ type: "error", message: String(err && err.message || err) }));
      server.close(1011, "internal error");
    } catch { /* socket already closed */ }
  });

  return new Response(null, { status: 101, webSocket: client });
  /* v8 ignore stop */
}

// Look up a session by raw token (used for the `?session=` fallback).
async function sessionFromToken(env, token, request) {
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
    .bind(tokenHash).first();
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.revoked_at) return null;
  if (row.expires_at < now) return null;
  return {
    user: { id: row.user_id, email: row.email, name: row.name, emailVerifiedAt: row.email_verified_at },
    account: row.account_id_full ? {
      id: row.account_id_full, name: row.account_name, plan: row.plan, monthlyCapUsd: row.monthly_cap_usd,
    } : null,
  };
}

/* v8 ignore next 60 — long-running WebSocket loop; not unit-testable
   in vitest's environment which doesn't model the runtime
   WebSocketPair / `server.send()` lifecycle. The functions it calls
   (pollAuditEvents) ARE covered. */
async function startTail(env, server, current) {
  // Hello frame.
  server.send(JSON.stringify({
    type: "hello",
    accountId: current.account.id,
    user: { id: current.user.id, email: current.user.email },
    pollIntervalMs: POLL_MS,
    heartbeatMs: HEARTBEAT_MS,
    framesPerPoll: MAX_FRAMES_PER_POLL,
    helloAt: new Date().toISOString(),
  }));

  // Client→server messages.
  server.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
      if (msg.type === "ping") {
        server.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      }
    } catch { /* ignore malformed */ }
  });
  let closed = false;
  server.addEventListener("close", () => { closed = true; });

  // Heartbeat.
  const heartbeat = setInterval(() => {
    if (closed) { clearInterval(heartbeat); return; }
    try { server.send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() })); }
    catch { closed = true; clearInterval(heartbeat); }
  }, HEARTBEAT_MS);

  // Poll loop.
  let since = Math.floor(Date.now() / 1000);
  while (!closed) {
    await sleep(POLL_MS);
    if (closed) break;
    const events = await pollAuditEvents(env, current.account.id, since, MAX_FRAMES_PER_POLL);
    for (const e of events) {
      try { server.send(JSON.stringify({ type: "audit", ...e })); }
      catch { closed = true; break; }
      if (Number(e.createdAt) > since) since = Number(e.createdAt);
    }
  }
  clearInterval(heartbeat);
}

// Exported for the unit tests — pure DB read, no socket plumbing.
export async function pollAuditEvents(env, accountId, sinceUnix, limit) {
  const db = getDB(env);
  const { results } = await db
    .prepare(
      `SELECT id, account_id, user_id, action, ip, user_agent, request_id, meta, created_at
       FROM audit_events
       WHERE account_id = ?1 AND created_at > ?2
       ORDER BY created_at ASC
       LIMIT ?3`
    )
    .bind(accountId, sinceUnix, limit).all();
  return (results || []).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    userId: r.user_id,
    action: r.action,
    ip: r.ip,
    userAgent: r.user_agent,
    requestId: r.request_id,
    meta: safeJson(r.meta),
    createdAt: r.created_at,
  }));
}

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/* v8 ignore next 3 — sleep is the trivial setTimeout wrapper used by
   the tail loop. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
