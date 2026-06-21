/**
 * GET    /api/auth/session  — introspect the current session
 * DELETE /api/auth/session  — log out (revoke session + clear cookies)
 *
 * Idempotent. Both verbs return 200; an absent or expired session yields
 * { authenticated: false } from GET (not 401) so the public homepage can
 * cheaply probe for "should we render Login or Account" without a 401
 * cluttering the network panel.
 */

import {
  getCurrentSession, revokeSession, auditEvent,
  clearedSessionCookieHeader, clearedLoggedInIndicatorCookie,
  AUTH_CORS, authJson,
} from "./_lib.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...AUTH_CORS, "Access-Control-Max-Age": "86400" } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const current = await getCurrentSession(env, request);
  if (!current) return authJson({ authenticated: false });
  return authJson({
    authenticated: true,
    user: current.user,
    account: current.account,
    session: { expiresAt: current.session.expiresAt },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const current = await getCurrentSession(env, request);
  // Always return 200 with cleared cookies — even if the session was
  // already revoked or invalid, the user's intent is "be logged out".
  const res = authJson({ authenticated: false });
  res.headers.append("Set-Cookie", clearedSessionCookieHeader());
  res.headers.append("Set-Cookie", clearedLoggedInIndicatorCookie());
  if (current) {
    try { await revokeSession(env, current.session.tokenHash); } catch {}
    await auditEvent(env, {
      accountId: current.account?.id,
      userId: current.user.id,
      action: "user.logout",
      request,
    });
  }
  return res;
}
