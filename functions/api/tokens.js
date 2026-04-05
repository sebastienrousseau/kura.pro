/**
 * API Token Management — scoped, per-user tokens.
 *
 * GET    /api/tokens          — List all tokens (redacted)
 * POST   /api/tokens          — Create a new scoped token
 * DELETE /api/tokens?id=xxx   — Revoke a token
 *
 * Auth: AccountKey (only account admins can manage tokens)
 *
 * Token scopes:
 *   storage:read, storage:write
 *   assets:read
 *   insights:read
 *   zones:read, zones:write
 *   purge:write
 *   pipeline:write
 *   webhooks:read, webhooks:write
 *
 * Tokens are stored in KV as JSON. Each token has:
 *   id, name, prefix (first 8 chars), hash (SHA-256 of full token),
 *   scopes[], createdAt, expiresAt, lastUsedAt
 */

import { authenticateAccount, log } from './_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type',
  'Content-Type': 'application/json',
};

const TOKENS_KEY = 'tokens:registry';
const MAX_TOKENS = 50;

const VALID_SCOPES = new Set([
  'storage:read', 'storage:write',
  'assets:read',
  'insights:read',
  'zones:read', 'zones:write',
  'purge:write',
  'pipeline:write',
  'webhooks:read', 'webhooks:write',
]);

async function getTokenRegistry(kv) {
  const raw = await kv.get(TOKENS_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveTokenRegistry(kv, tokens) {
  await kv.put(TOKENS_KEY, JSON.stringify(tokens));
}

async function hashToken(token) {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * GET /api/tokens — List all tokens (secrets redacted).
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authenticateAccount(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'AccountKey required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ HttpCode: 503, Message: 'KV unavailable.' }), { status: 503, headers: CORS });

  const tokens = await getTokenRegistry(kv);

  // Redact: only show prefix, not full hash
  const redacted = tokens.map(t => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scopes: t.scopes,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
  }));

  return new Response(JSON.stringify({ Tokens: redacted, Count: redacted.length }), { headers: CORS });
}

/**
 * POST /api/tokens — Create a new scoped token.
 * Body: { "name": "CI deploy bot", "scopes": ["storage:write", "purge:write"], "expiresInDays": 90 }
 *
 * Returns the full token ONCE. It cannot be retrieved again.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authenticateAccount(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'AccountKey required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ HttpCode: 503, Message: 'KV unavailable.' }), { status: 503, headers: CORS });

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'Invalid JSON body.' }), { status: 400, headers: CORS });
  }

  const { name, scopes, expiresInDays } = body;

  if (!name || typeof name !== 'string' || name.length > 100) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'Token name required (max 100 chars).' }), { status: 400, headers: CORS });
  }

  if (!Array.isArray(scopes) || scopes.length === 0) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: `Scopes array required. Valid: ${[...VALID_SCOPES].join(', ')}` }), { status: 400, headers: CORS });
  }

  const invalid = scopes.filter(s => !VALID_SCOPES.has(s));
  if (invalid.length > 0) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: `Invalid scopes: ${invalid.join(', ')}` }), { status: 400, headers: CORS });
  }

  const tokens = await getTokenRegistry(kv);
  if (tokens.length >= MAX_TOKENS) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: `Maximum ${MAX_TOKENS} tokens allowed.` }), { status: 400, headers: CORS });
  }

  // Generate token: cdnsk_ prefix + 40 random hex chars
  const randomBytes = crypto.getRandomValues(new Uint8Array(20));
  const secret = 'cdnsk_' + [...randomBytes].map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await hashToken(secret);

  const days = Math.min(Math.max(parseInt(expiresInDays || '365', 10), 1), 365);
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  const entry = {
    id: crypto.randomUUID(),
    name,
    prefix: secret.slice(0, 14), // cdnsk_ + 8 hex chars
    hash,
    scopes,
    createdAt: new Date().toISOString(),
    expiresAt,
    lastUsedAt: null,
  };

  tokens.push(entry);
  await saveTokenRegistry(kv, tokens);

  log.info('TOKEN_CREATED', `Token "${name}" created`, { id: entry.id, scopes });

  return new Response(JSON.stringify({
    HttpCode: 201,
    Message: 'Token created. Store the secret securely — it cannot be retrieved again.',
    Token: {
      id: entry.id,
      name: entry.name,
      secret,
      scopes: entry.scopes,
      expiresAt: entry.expiresAt,
    },
  }), { status: 201, headers: CORS });
}

/**
 * DELETE /api/tokens?id=xxx — Revoke a token.
 */
export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!authenticateAccount(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'AccountKey required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ HttpCode: 503, Message: 'KV unavailable.' }), { status: 503, headers: CORS });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'Query parameter "id" required.' }), { status: 400, headers: CORS });
  }

  const tokens = await getTokenRegistry(kv);
  const idx = tokens.findIndex(t => t.id === id);
  if (idx === -1) {
    return new Response(JSON.stringify({ HttpCode: 404, Message: 'Token not found.' }), { status: 404, headers: CORS });
  }

  const removed = tokens.splice(idx, 1)[0];
  await saveTokenRegistry(kv, tokens);

  log.info('TOKEN_REVOKED', `Token "${removed.name}" revoked`, { id });

  return new Response(JSON.stringify({ HttpCode: 200, Message: 'Token revoked.' }), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

/**
 * Validate a scoped token. Called by other endpoints to check authorization.
 *
 * @param {object} env - Worker env with RATE_KV binding
 * @param {Request} request - Incoming request
 * @param {string} requiredScope - The scope to check (e.g., 'storage:write')
 * @returns {Promise<boolean>}
 */
export async function validateToken(env, request, requiredScope) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token || !token.startsWith('cdnsk_')) return false;

  const kv = env.RATE_KV;
  if (!kv) return false;

  const hash = await hashToken(token);
  const tokens = await getTokenRegistry(kv);
  const entry = tokens.find(t => t.hash === hash);
  if (!entry) return false;

  // Check expiration
  if (new Date(entry.expiresAt) < new Date()) return false;

  // Check scope
  if (!entry.scopes.includes(requiredScope)) return false;

  // Update last used (non-blocking)
  entry.lastUsedAt = new Date().toISOString();
  saveTokenRegistry(kv, tokens).catch(() => {});

  return true;
}
