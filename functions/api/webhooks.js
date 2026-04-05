/**
 * Webhook management and delivery endpoint.
 *
 * GET    /api/webhooks          — List registered webhooks
 * POST   /api/webhooks          — Register a new webhook
 * DELETE /api/webhooks?id=xxx   — Remove a webhook
 *
 * Auth: AccountKey (control-plane operation)
 *
 * Supported events:
 *   asset.created, asset.deleted, asset.updated
 *   zone.created, zone.deleted
 *   purge.completed
 *   pipeline.completed
 */

import { authenticateAccount, log } from './_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type',
  'Content-Type': 'application/json',
};

const VALID_EVENTS = new Set([
  'asset.created',
  'asset.deleted',
  'asset.updated',
  'zone.created',
  'zone.deleted',
  'purge.completed',
  'pipeline.completed',
]);

const WEBHOOKS_KEY = 'webhooks:registered';
const MAX_WEBHOOKS = 25;

async function getWebhooks(kv) {
  const raw = await kv.get(WEBHOOKS_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveWebhooks(kv, webhooks) {
  await kv.put(WEBHOOKS_KEY, JSON.stringify(webhooks));
}

/**
 * GET /api/webhooks — List all registered webhooks.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authenticateAccount(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'AccountKey required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ HttpCode: 503, Message: 'KV unavailable.' }), { status: 503, headers: CORS });

  const webhooks = await getWebhooks(kv);
  return new Response(JSON.stringify({ Webhooks: webhooks, Count: webhooks.length }), { headers: CORS });
}

/**
 * POST /api/webhooks — Register a new webhook.
 * Body: { "url": "https://example.com/hook", "events": ["asset.created"], "secret": "optional-hmac-secret" }
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

  const { url, events, secret } = body;

  if (!url || typeof url !== 'string' || (!url.startsWith('https://') && !url.startsWith('http://localhost'))) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'Webhook URL must start with https:// (or http://localhost for dev).' }), { status: 400, headers: CORS });
  }

  if (!Array.isArray(events) || events.length === 0) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: `Events array required. Valid events: ${[...VALID_EVENTS].join(', ')}` }), { status: 400, headers: CORS });
  }

  const invalid = events.filter(e => !VALID_EVENTS.has(e));
  if (invalid.length > 0) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: `Invalid events: ${invalid.join(', ')}. Valid: ${[...VALID_EVENTS].join(', ')}` }), { status: 400, headers: CORS });
  }

  const webhooks = await getWebhooks(kv);
  if (webhooks.length >= MAX_WEBHOOKS) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: `Maximum ${MAX_WEBHOOKS} webhooks allowed.` }), { status: 400, headers: CORS });
  }

  const webhook = {
    id: crypto.randomUUID(),
    url,
    events,
    secret: secret || null,
    createdAt: new Date().toISOString(),
    active: true,
  };

  webhooks.push(webhook);
  await saveWebhooks(kv, webhooks);

  log.info('WEBHOOK_CREATED', `Webhook registered for ${events.join(', ')}`, { id: webhook.id, url });

  return new Response(JSON.stringify({ HttpCode: 201, Message: 'Webhook registered.', Webhook: webhook }), { status: 201, headers: CORS });
}

/**
 * DELETE /api/webhooks?id=xxx — Remove a webhook.
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

  const webhooks = await getWebhooks(kv);
  const idx = webhooks.findIndex(w => w.id === id);
  if (idx === -1) {
    return new Response(JSON.stringify({ HttpCode: 404, Message: 'Webhook not found.' }), { status: 404, headers: CORS });
  }

  const removed = webhooks.splice(idx, 1)[0];
  await saveWebhooks(kv, webhooks);

  log.info('WEBHOOK_DELETED', `Webhook removed`, { id, url: removed.url });

  return new Response(JSON.stringify({ HttpCode: 200, Message: 'Webhook removed.' }), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

/**
 * Dispatch a webhook event. Called by other endpoints via waitUntil().
 *
 * @param {object} env - Worker env with RATE_KV binding
 * @param {string} event - Event name (e.g., 'asset.created')
 * @param {object} payload - Event data
 */
export async function dispatchWebhook(env, event, payload) {
  try {
    const kv = env?.RATE_KV;
    if (!kv) return;

    let webhooks;
    try { webhooks = await getWebhooks(kv); } catch { return; }

  const matching = webhooks.filter(w => w.active && w.events.includes(event));
  if (matching.length === 0) return;

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const deliveries = matching.map(async (webhook) => {
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'CloudCDN-Webhook/1.0' };

    // HMAC signature if secret is configured
    if (webhook.secret) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', encoder.encode(webhook.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
      headers['X-Webhook-Signature'] = `sha256=${hex}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      await fetch(webhook.url, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (err) {
      log.warn('WEBHOOK_DELIVERY_FAILED', `Failed to deliver ${event} to ${webhook.url}`, { error: err.message });
    }
  });

  await Promise.allSettled(deliveries);
  } catch { /* webhook delivery is best-effort */ }
}
