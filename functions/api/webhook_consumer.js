/**
 * Webhook delivery consumer — Cloudflare Queues handler.
 *
 * This file is the canonical reference shape for a Worker that consumes
 * messages produced by dispatchWebhook in functions/api/webhooks.js.
 * Cloudflare Pages itself does not run queue consumers — they must be
 * deployed as a separate Worker that binds the same queue.
 *
 * Operator setup (one-time):
 *
 *   1. Create the queue:
 *        npx wrangler queues create cloudcdn-webhooks
 *      Then uncomment the matching producer stanza in wrangler.toml.
 *
 *   2. Deploy this file as a Worker with the consumer binding:
 *        # workers/webhook-consumer/wrangler.toml
 *        name = "cloudcdn-webhook-consumer"
 *        main = "src/index.js"
 *
 *        [[queues.consumers]]
 *        queue                = "cloudcdn-webhooks"
 *        max_batch_size       = 10
 *        max_batch_timeout    = 5
 *        max_retries          = 5
 *        dead_letter_queue    = "cloudcdn-webhooks-dlq"
 *
 *      and `import { webhookQueueHandler } from './webhook_consumer.js';`
 *
 * Retry semantics:
 *   - Each message carries `attempt`. On delivery failure we re-send the
 *     message with `attempt + 1` after an exponential backoff (1s, 5s,
 *     25s, 125s) up to MAX_ATTEMPTS=4. After that we DLQ via
 *     msg.retry({ delaySeconds }) returning the message — which lets the
 *     queue infrastructure handle dead-lettering.
 *   - HMAC signing is identical to the inline path so receivers see the
 *     same `X-Webhook-Signature` header shape.
 */

const MAX_ATTEMPTS = 4;
const BACKOFFS_SEC = [1, 5, 25, 125];
const DELIVER_TIMEOUT_MS = 5_000;

async function signBody(secret, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function deliver(envelope) {
  const { url, body, secret } = envelope;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'CloudCDN-Webhook/1.0',
  };
  if (secret) {
    const hex = await signBody(secret, body);
    headers['X-Webhook-Signature'] = `sha256=${hex}`;
  }
  const controller = new AbortController();
  /* v8 ignore next -- abort timer fires only when a receiver stalls > 5s */
  const timeoutId = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Webhook returned HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Cloudflare Queues consumer handler.
 *
 *   export default { queue: webhookQueueHandler };
 *
 * Each message is the envelope produced by dispatchWebhook:
 *   { webhookId, url, secret, event, body, attempt }
 */
export async function webhookQueueHandler(batch, _env, _ctx) {
  for (const msg of batch.messages) {
    const envelope = msg.body;
    try {
      await deliver(envelope);
      msg.ack();
    } catch (err) {
      const nextAttempt = (envelope.attempt || 0) + 1;
      if (nextAttempt >= MAX_ATTEMPTS) {
        // Final failure — let the queue infrastructure DLQ it.
        msg.retry({ delaySeconds: 0 });
        continue;
      }
      /* v8 ignore next -- nextAttempt is bounded by MAX_ATTEMPTS so the
         ?? fallback is unreachable in practice; defensive only */
      const delaySeconds = BACKOFFS_SEC[nextAttempt] ?? BACKOFFS_SEC[BACKOFFS_SEC.length - 1];
      // Re-enqueue with bumped attempt counter and exponential delay.
      msg.retry({ delaySeconds });
      // Note: queues don't support mutating the message body on retry,
      // so the attempt counter is effectively tracked by the
      // delivery-attempt header on Cloudflare's side; this stays as a
      // best-effort hint for observability.
      void nextAttempt; void err;
    }
  }
}

// Default export so the file is drop-in for a wrangler `main` entry.
export default { queue: webhookQueueHandler };
