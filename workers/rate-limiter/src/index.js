// Module-worker entry for the cloudcdn-rate-limiter Worker.
//
// Sole purpose: host the RateLimiterDO Durable Object class so the
// cloudcdn-pro Pages project can bind to it via `script_name`. Pages
// Functions cannot host DO classes directly; the [[migrations]] directive
// is Workers-only, so the class must live in a standalone Worker.
//
// Re-export from the canonical implementation in the Pages tree —
// exactly one source of truth, no duplication.
export { RateLimiterDO } from "../../../functions/api/rate_limiter_do.js";

// Workers require a default export with a fetch handler. This Worker
// has no external API surface; the DO is reached cross-script through
// the Pages binding, never via direct HTTP. The handler exists only so
// any drive-by probe gets an honest 200 (and a clear message) rather
// than a 1101 "Worker threw exception" page.
export default {
  async fetch() {
    return new Response(
      JSON.stringify({
        status: "ok",
        worker: "cloudcdn-rate-limiter",
        purpose: "Hosts the RateLimiterDO Durable Object for the cloudcdn-pro Pages project.",
        note: "Direct HTTP traffic is not served. The DO is reached only via the Pages cross-script binding `RATE_LIMITER`.",
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
