# cloudcdn-webhook-consumer

Standalone Cloudflare Worker that consumes the `cloudcdn-webhooks` queue produced by the `cloudcdn-pro` Pages project.

## Why this exists

Cloudflare Pages Functions cannot run queue consumers — only Workers can. The Pages project produces webhook-delivery jobs via `dispatchWebhook()` in `functions/api/webhooks.js`; this Worker consumes them.

The handler itself lives in [`../../functions/api/webhook_consumer.js`](../../functions/api/webhook_consumer.js) and is re-exported by [`src/index.js`](src/index.js) — single source of truth, same pattern as `workers/rate-limiter/`.

## One-time activation

These steps are gated on operator action because each one creates billed Cloudflare resources:

1. **Create the queues** (Workers Paid plan; free-tier eligible up to 1M ops/month):

   ```sh
   npx wrangler queues create cloudcdn-webhooks
   npx wrangler queues create cloudcdn-webhooks-dlq
   ```

2. **Deploy this Worker** (binds the consumer + DLQ):

   ```sh
   cd workers/webhook-consumer
   npx wrangler deploy
   ```

3. **Activate the producer side** by uncommenting the `[[queues.producers]]` stanza in the repo-root `wrangler.toml` and pushing. After Pages redeploys, `dispatchWebhook()` auto-detects `env.WEBHOOK_QUEUE` and starts enqueueing rather than firing-and-forgetting.

## Behaviour summary

| Property | Value | Source |
|---|---|---|
| Batch size | 10 messages | `wrangler.toml` |
| Batch timeout | 5 s | `wrangler.toml` |
| Cloudflare retries | 5 | `wrangler.toml` |
| Consumer backoff | 1s / 5s / 25s / 125s | `webhook_consumer.js` |
| Final failure | DLQ → `cloudcdn-webhooks-dlq` | `wrangler.toml` |
| Delivery timeout | 5 s per receiver | `webhook_consumer.js` |
| HMAC header | `X-Webhook-Signature: sha256=<hex>` | `webhook_consumer.js` |

## Rollback

Re-comment the producer stanza in the repo-root `wrangler.toml` and push. `dispatchWebhook()` falls back to its inline fire-and-forget path immediately; the consumer Worker stays deployed but receives nothing until the producer is re-enabled. Idle queues cost nothing.

## Local dev / inspection

```sh
npx wrangler dev   # local consumer sandbox with mock queue events
npx wrangler tail  # stream live consumer logs from the deployed Worker
```
