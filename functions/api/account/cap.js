/**
 * Session-gated monthly spend cap management — the headline
 * "no-surprise billing" lever from the 2026 research. The cap value
 * lives on `accounts.monthly_cap_usd` (column already present from
 * migration 0001).
 *
 * GET   /api/account/cap   → { monthlyCapUsd, capMode }
 * PATCH /api/account/cap   → set the cap. Body:
 *                             { monthlyCapUsd: integer >= 0 }
 *                             0 = degrade-only (default; never bill
 *                                 overage, return 402 when threshold
 *                                 is hit).
 *                             N = hard cap in USD per calendar month;
 *                                 overage past N billed only if the
 *                                 user explicitly opts in via a
 *                                 separate /api/account/billing flow
 *                                 (Phase 3).
 *
 * The enforcement middleware (functions/api/account/_quota.js) reads
 * this value on every request and returns 402 Payment Required with
 * a `Retry-After` header to the next calendar-month boundary when the
 * usage_meter DO reports the account is over.
 *
 * Audit-logged: every cap change records before + after via
 * auditEvent({ action: 'account.cap.update' }).
 */

import {
  hasAccountsDB, getDB, getCurrentSession, auditEvent,
  AUTH_CORS, jsonError, authJson,
} from "../auth/_lib.js";

const MIN_CAP = 0;          // 0 = degrade-only
const MAX_CAP = 1_000_000;  // sanity upper bound ($1M/mo)

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...AUTH_CORS, "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS", "Access-Control-Max-Age": "86400" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");
  const current = await getCurrentSession(env, request);
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");
  if (!current.account) return jsonError(403, "no_account", "No account associated with this session.");
  const cap = Number(current.account.monthlyCapUsd) || 0;
  return authJson({
    monthlyCapUsd: cap,
    capMode: cap === 0 ? "degrade_only" : "hard_cap_with_opt_in_overage",
    capDescription: cap === 0
      ? "Your account will return 402 Payment Required instead of incurring any overage. You will never be billed without explicitly opting in."
      : `Your account caps spend at $${cap}/month. Past the cap, requests return 402 Payment Required unless overage billing is explicitly enabled.`,
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!hasAccountsDB(env)) return jsonError(503, "infra_missing", "Auth bindings not configured.");
  const current = await getCurrentSession(env, request);
  if (!current) return jsonError(401, "unauthenticated", "Sign in first.");
  if (!current.account) return jsonError(403, "no_account", "No account associated with this session.");

  let body;
  try { body = await request.json(); }
  catch { return jsonError(400, "invalid_input", "Request body must be JSON."); }

  const requested = Number(body.monthlyCapUsd);
  if (!Number.isInteger(requested) || requested < MIN_CAP || requested > MAX_CAP) {
    return jsonError(400, "invalid_input", `monthlyCapUsd must be an integer between ${MIN_CAP} and ${MAX_CAP}.`);
  }

  const previous = Number(current.account.monthlyCapUsd) || 0;

  try {
    await getDB(env)
      .prepare(`UPDATE accounts SET monthly_cap_usd = ?1 WHERE id = ?2 AND deleted_at IS NULL`)
      .bind(requested, current.account.id).run();
  } catch {
    return jsonError(500, "internal", "Could not update cap. Please retry.");
  }

  await auditEvent(env, {
    accountId: current.account.id, userId: current.user.id,
    action: "account.cap.update",
    request,
    meta: { previousCapUsd: previous, newCapUsd: requested },
  });

  return authJson({
    monthlyCapUsd: requested,
    capMode: requested === 0 ? "degrade_only" : "hard_cap_with_opt_in_overage",
    previousCapUsd: previous,
  });
}
