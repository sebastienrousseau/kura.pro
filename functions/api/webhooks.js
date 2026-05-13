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
const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024;

// Hostnames that must never receive a webhook — internal services and
// link-local IPs that an attacker could point a webhook at to coerce the
// CDN into making requests on their behalf (SSRF).
//
// Cloudflare's outbound network already blocks RFC1918 from worker fetches,
// but we add a strict hostname check up front so the breach attempt is
// rejected at registration time (with a clear error) instead of silently
// failing on each delivery.
function isBlockedHost(host) {
  /* v8 ignore next -- URL.hostname always returns a string; defensive only */
  if (!host) return true;
  const h = host.toLowerCase();

  // Literal loopback names + IPv6 loopback.
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;

  // Cloud metadata endpoints — covers AWS/GCP/Azure/Alibaba/DigitalOcean.
  if (h === '169.254.169.254' || h === 'metadata.google.internal' || h === 'metadata' ) return true;

  // IPv4 ranges that should never be exposed externally.
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 0) return true;                        // 0.0.0.0/8
  }

  // IPv6 unique-local and link-local.
  if (h.startsWith('[fc') || h.startsWith('[fd') || h.startsWith('[fe80')) return true;

  return false;
}

/**
 * Validate the webhook URL. Returns null when ok, or a string with the
 * specific reason it was rejected so the caller can return it to the user.
 */
export function validateWebhookUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return 'Webhook URL is required.';
  }
  if (url.length > 2048) {
    return 'Webhook URL exceeds the 2048-character maximum.';
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'Webhook URL is not a valid absolute URL.';
  }

  if (parsed.protocol !== 'https:') {
    return 'Webhook URL must use https://. Plain http and other schemes are rejected.';
  }
  if (parsed.username || parsed.password) {
    return 'Webhook URL must not contain credentials in the URL.';
  }
  if (isBlockedHost(parsed.hostname)) {
    return 'Webhook URL points at an internal, loopback, or link-local host. Use a publicly reachable hostname instead.';
  }
  return null;
}

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

  // Reject oversized bodies up front — protects the JSON parser from being
  // weaponised as a memory-amplification path.
  const declaredLen = parseInt(request.headers.get('content-length') || '0', 10);
  if (declaredLen > MAX_WEBHOOK_PAYLOAD_BYTES) {
    return new Response(JSON.stringify({
      HttpCode: 413,
      Message: `Request body exceeds the ${MAX_WEBHOOK_PAYLOAD_BYTES}-byte limit for webhook registration.`,
    }), { status: 413, headers: CORS });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ HttpCode: 400, Message: 'Invalid JSON body.' }), { status: 400, headers: CORS });
  }

  const { url, events, secret } = body;

  const urlCheck = validateWebhookUrl(url);
  if (urlCheck) {
    return new Response(JSON.stringify({ HttpCode: 400, Message: urlCheck }), { status: 400, headers: CORS });
  }

  // HMAC signing is mandatory — webhook receivers must be able to verify the
  // request actually came from CloudCDN. 32 chars is the minimum for a
  // useful HMAC-SHA256 secret (256 bits at hex encoding).
  if (typeof secret !== 'string' || secret.length < 32) {
    return new Response(JSON.stringify({
      HttpCode: 400,
      Message: 'A secret of at least 32 characters is required. The secret is used to HMAC-sign every delivery so the receiver can verify authenticity. Generate one with: openssl rand -hex 32',
    }), { status: 400, headers: CORS });
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
    secret,
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
      /* v8 ignore next -- timeout fires only when a webhook target stalls > 5s */
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
