/**
 * Durable Object — atomic rate limiter.
 *
 * The legacy KV-backed rate limit (functions/api/_shared.js#checkRateLimit) is
 * read-then-write and therefore racy under burst concurrency. This DO holds
 * the counter in transactional storage and decides allow/deny inside a single
 * actor invocation, so two concurrent requests cannot both observe `count <
 * limit` and proceed past the cap.
 *
 * Wire-up — this is the part that bit us in May 2026:
 *
 * Cloudflare Pages **cannot** host a Durable Object class. Pages Functions
 * can only *bind* to a DO that's already provisioned by a separate Workers
 * project; `[[migrations]]` in a Pages `wrangler.toml` is a no-op because
 * the Pages git-integration deploy ignores it. So this file is a reference
 * implementation, not a live class. Activation requires:
 *
 *   1. Stand up a separate Worker (e.g. `cloudcdn-rate-limiter`) whose
 *      module entry exports this class. Its own `wrangler.toml` carries
 *      the `[[durable_objects.bindings]]` and `[[migrations]] new_classes`
 *      stanzas. `wrangler deploy` it once to provision the DO namespace.
 *
 *   2. Bind it into this Pages project by adding to *this* repo's
 *      `wrangler.toml`:
 *        [[durable_objects.bindings]]
 *        name        = "RATE_LIMITER"
 *        class_name  = "RateLimiterDO"
 *        script_name = "cloudcdn-rate-limiter"   # the Worker from step 1
 *
 *   3. No code change required on the Pages side. `checkRateLimit` in
 *      `_shared.js` already auto-detects `env.RATE_LIMITER` and routes
 *      through this DO when present; otherwise it falls back to the
 *      (fail-open since PRs #42, #43) KV path.
 *
 * The HTTP surface is internal — the DO only ever receives requests from
 * `checkRateLimit` and uses the URL path as the dispatch.
 */

export class RateLimiterDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/increment' || request.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid body' }, { status: 400 });
    }

    const limit = Number.isFinite(body?.limit) ? body.limit : 0;
    const windowMs = Number.isFinite(body?.windowSeconds) ? body.windowSeconds * 1000 : 0;
    if (limit <= 0 || windowMs <= 0) {
      return Response.json({ error: 'limit and windowSeconds must be positive' }, { status: 400 });
    }

    // blockConcurrencyWhile serialises this entire decision against any other
    // concurrent fetch on the same DO instance — the atomicity primitive.
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const stored = (await this.state.storage.get('window')) || null;

      // Roll the window over if we've crossed the boundary.
      const windowStart = stored && now - stored.start < windowMs ? stored.start : now;
      const priorCount = stored && stored.start === windowStart ? stored.count : 0;

      if (priorCount >= limit) {
        return Response.json({
          allowed: false,
          limit,
          remaining: 0,
          resetAt: Math.floor((windowStart + windowMs) / 1000),
        });
      }

      const nextCount = priorCount + 1;
      await this.state.storage.put('window', { start: windowStart, count: nextCount });
      // Self-clean: drop the row once the window expires so the namespace
      // doesn't grow unbounded over time.
      await this.state.storage.setAlarm(windowStart + windowMs + 1000);

      return Response.json({
        allowed: true,
        limit,
        remaining: limit - nextCount,
        resetAt: Math.floor((windowStart + windowMs) / 1000),
      });
    });
  }

  async alarm() {
    // Window expired — drop the counter so the next request starts fresh
    // without paying a storage hit on the read path.
    await this.state.storage.delete('window');
  }
}
