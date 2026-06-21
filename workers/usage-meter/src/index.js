// Module-worker entry for the cloudcdn-usage-meter Worker.
//
// Sole purpose: host the UsageMeterDO Durable Object class so the
// cloudcdn-pro Pages project can bind to it via `script_name`. Pages
// Functions cannot host DO classes directly; the [[migrations]]
// directive is Workers-only, so the class must live in a standalone
// Worker.
//
// Re-export from the canonical implementation in the Pages tree —
// exactly one source of truth, no duplication. Mirrors the
// rate-limiter wiring (workers/rate-limiter/src/index.js).
export { UsageMeterDO } from "../../../functions/api/usage_meter_do.js";

export default {
  async fetch() {
    return new Response(
      JSON.stringify({
        status: "ok",
        worker: "cloudcdn-usage-meter",
        purpose: "Hosts the UsageMeterDO Durable Object for the cloudcdn-pro Pages project.",
        note: "Direct HTTP traffic is not served. The DO is reached only via the Pages cross-script binding `USAGE_METER`.",
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
