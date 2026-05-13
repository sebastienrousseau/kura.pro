/**
 * Audit log reader — GET /api/core/audit-logs?days=7&action=token.create&limit=500
 *
 * Auth: AccountKey (control-plane operation).
 *
 * Returns a JSON envelope:
 *   {
 *     Period: { Days, Action, Limit },
 *     Entries: [ ... ],
 *     Count: number,
 *     DateFetched: iso8601,
 *   }
 *
 * Each entry is the structure written by appendAuditLog in
 * functions/api/_shared.js — timestamp, action, ip, userAgent, requestId,
 * and an action-specific meta blob.
 */

import { authenticateAccount, queryAuditLog, extractParams, errorResponse } from '../_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authenticateAccount(request, env)) {
    return errorResponse(401, 'Unauthorized', 'AccountKey header is required for audit-log access. This is a control-plane endpoint that returns immutable records of sensitive operations.');
  }

  const kv = env.RATE_KV;
  if (!kv) {
    return errorResponse(503, 'KvUnavailable', 'The audit log namespace is currently unavailable. Verify that the RATE_KV binding is configured in wrangler.toml.');
  }

  const params = extractParams(request.url);
  const days = parseInt(params.get('days') || '7', 10);
  const action = params.get('action') || null;
  const limit = parseInt(params.get('limit') || '500', 10);

  const entries = await queryAuditLog(env, { days, action, limit });

  return new Response(JSON.stringify({
    Period: { Days: days, Action: action, Limit: limit },
    Entries: entries,
    Count: entries.length,
    DateFetched: new Date().toISOString(),
  }), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, 'Access-Control-Max-Age': '86400' },
  });
}
