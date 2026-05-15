// Module-worker entry for cloudcdn-webhook-consumer.
//
// Sole purpose: consume messages from the `cloudcdn-webhooks` queue
// (produced by dispatchWebhook in functions/api/webhooks.js on the Pages
// project) and deliver them to the registered webhook URLs with HMAC
// signing, exponential backoff, and DLQ-on-final-failure.
//
// Cloudflare Pages cannot run queue consumers — only Workers can — so this
// Worker exists as a sibling deploy. Same single-source-of-truth pattern as
// `workers/rate-limiter/`: re-export the canonical handler from the Pages
// tree rather than duplicating logic here.
import { webhookQueueHandler } from "../../../functions/api/webhook_consumer.js";

export default {
  // Cloudflare Queues invokes `queue(batch, env, ctx)` for each batch of
  // messages. The handler is implemented in functions/api/webhook_consumer.js.
  queue: webhookQueueHandler,

  // No external HTTP surface — the Worker only services queue events. The
  // fetch handler returns a static status JSON so any drive-by probe gets
  // an honest 200 (and a clear message) rather than a 1101 exception page.
  async fetch() {
    return new Response(
      JSON.stringify({
        status: "ok",
        worker: "cloudcdn-webhook-consumer",
        purpose: "Consumes the cloudcdn-webhooks queue produced by the cloudcdn-pro Pages project.",
        note: "Direct HTTP traffic is not served. Messages arrive via Cloudflare Queues.",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  },
};
