/**
 * Durable Object — per-account billable usage counter.
 *
 * One actor instance per (accountId, billing-period). Stores the
 * accumulated USD units the account has spent in the current
 * UTC-month + a "last-written" timestamp so callers can detect
 * staleness.
 *
 * The accuracy guarantees are weaker than a Stripe usage record: this
 * is the "what should we serve right now?" view used by
 * functions/api/account/_quota.js#enforceCap to decide whether to
 * return 402. The reconciled monthly bill is computed offline from
 * Workers Analytics Engine — the DO is the live signal, AE is the
 * audit trail. They should agree within seconds.
 *
 * Wire-up — same pattern as rate_limiter_do.js. Pages cannot host a
 * DO class; the standalone Worker that hosts UsageMeterDO lives at
 * workers/usage-meter/ and re-exports this class. Activation:
 *
 *   1. `cd workers/usage-meter && npx wrangler deploy` — one-time;
 *      runs the `v1` migration and provisions the namespace.
 *
 *   2. Uncomment the `[[durable_objects.bindings]]` stanza for
 *      `USAGE_METER` in the repo-root wrangler.toml.
 *
 *   3. Without `env.USAGE_METER`, `_quota.js#currentMonthUsageUsd`
 *      falls back to the RATE_KV cached value (no regression).
 *
 * HTTP surface (internal only — never reached from a public URL):
 *
 *   POST /add   { amountUsd: number, kind?: string }
 *               → { units: number, period: string, addedAt: number }
 *   GET  /get   → { units, period, lastWriteAt }
 *   POST /reset (admin — protected by a `RESET_SECRET` env var if set)
 *               → { units: 0, period }
 *
 * Storage:
 *   units         number — cumulative USD for the period
 *   period        string — "YYYY-MM" (UTC). Reset implicitly on month
 *                          boundary by `addUsage`.
 *   lastWriteAt   number — Unix seconds of the most recent /add.
 */

/* v8 ignore next — pure helper, exercised indirectly through addUsage. */
function utcPeriod(now = Date.now()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class UsageMeterDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/add" && request.method === "POST") {
      return this.addUsage(request);
    }
    if (url.pathname === "/addIfBelow" && request.method === "POST") {
      return this.addIfBelow(request);
    }
    if (url.pathname === "/get" && request.method === "GET") {
      return this.getUsage();
    }
    if (url.pathname === "/reset" && request.method === "POST") {
      return this.reset(request);
    }
    return new Response("not found", { status: 404 });
  }

  // Atomic check-and-increment. Used by callers that need to enforce
  // a cap without the read-modify-write race. The DO is the only
  // primitive in the system that can serialise this — KV cannot.
  async addIfBelow(request) {
    let body;
    try { body = await request.json(); } catch {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const amount = Number(body?.amount);
    const limit  = Number(body?.limit);
    if (!Number.isFinite(amount) || amount < 0) {
      return Response.json({ error: "amount must be a non-negative number" }, { status: 400 });
    }
    if (!Number.isFinite(limit) || limit < 0) {
      return Response.json({ error: "limit must be a non-negative number" }, { status: 400 });
    }
    return this.state.blockConcurrencyWhile(async () => {
      const period = utcPeriod();
      const stored = (await this.state.storage.get("snapshot")) || { units: 0, period };
      const carryOver = stored.period === period ? Number(stored.units) || 0 : 0;
      if (carryOver >= limit) {
        return Response.json({ accepted: false, units: carryOver, period, limit });
      }
      const next = carryOver + amount;
      const now = Math.floor(Date.now() / 1000);
      await this.state.storage.put("snapshot", { units: next, period, lastWriteAt: now });
      return Response.json({ accepted: true, units: next, period, limit });
    });
  }

  async addUsage(request) {
    let body;
    try { body = await request.json(); } catch {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const amount = Number(body?.amountUsd);
    if (!Number.isFinite(amount) || amount < 0) {
      return Response.json({ error: "amountUsd must be a non-negative number" }, { status: 400 });
    }
    return this.state.blockConcurrencyWhile(async () => {
      const period = utcPeriod();
      const stored = (await this.state.storage.get("snapshot")) || { units: 0, period };
      // Roll over on month boundary — the stored period is from a
      // prior month; reset to zero and continue.
      const carryOver = stored.period === period ? Number(stored.units) || 0 : 0;
      const next = carryOver + amount;
      const now = Math.floor(Date.now() / 1000);
      await this.state.storage.put("snapshot", { units: next, period, lastWriteAt: now });
      return Response.json({ units: next, period, addedAt: now });
    });
  }

  async getUsage() {
    const period = utcPeriod();
    const stored = (await this.state.storage.get("snapshot")) || null;
    if (!stored || stored.period !== period) {
      return Response.json({ units: 0, period, lastWriteAt: null });
    }
    return Response.json({
      units: Number(stored.units) || 0,
      period: stored.period,
      lastWriteAt: stored.lastWriteAt || null,
    });
  }

  async reset(request) {
    // Optional auth — if RESET_SECRET is set on the DO Worker, require
    // an exact match. Unset = open (dev only).
    const required = this.env?.RESET_SECRET;
    if (required) {
      const got = request.headers.get("x-reset-secret");
      if (got !== required) return new Response("forbidden", { status: 403 });
    }
    const period = utcPeriod();
    await this.state.storage.put("snapshot", { units: 0, period, lastWriteAt: null });
    return Response.json({ units: 0, period });
  }
}

/**
 * Convenience wrapper used by the Pages tree to address the per-account
 * DO instance. The DO id is namespaced by account so each account gets
 * its own actor (1 RPC hop, no cross-account contention).
 *
 *   const total = await addUsage(env, accountId, 0.0042);
 *
 * Returns null if the binding is absent (no regression — _quota.js's
 * KV cache path handles that).
 */
export async function addUsage(env, accountId, amountUsd) {
  if (!env?.USAGE_METER || !accountId) return null;
  const id = env.USAGE_METER.idFromName(accountId);
  const stub = env.USAGE_METER.get(id);
  const res = await stub.fetch("https://usage-meter.internal/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountUsd }),
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Atomic check-and-increment. The DO refuses to increment past
 * `limit` for the current UTC-month period and returns
 * `{ accepted: false, units, period, limit }`; otherwise increments
 * by `amount` and returns `{ accepted: true, units: <new>, period, limit }`.
 *
 * Use for global per-feature monthly soft caps (chat queries,
 * transform invocations) that were previously hand-rolled via
 * KV read-then-write and would race + burn the 1000-write/day
 * Free-tier quota.
 *
 * Returns null when the binding is absent so callers can degrade
 * open (matches the previous behaviour of `addUsage`).
 */
export async function addUsageIfBelow(env, accountId, amount, limit) {
  if (!env?.USAGE_METER || !accountId) return null;
  const id = env.USAGE_METER.idFromName(accountId);
  const stub = env.USAGE_METER.get(id);
  const res = await stub.fetch("https://usage-meter.internal/addIfBelow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, limit }),
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Read-only snapshot of the current period's accumulated USD. Returns
 * null when the binding is absent so callers can fall back.
 */
export async function readUsage(env, accountId) {
  if (!env?.USAGE_METER || !accountId) return null;
  const id = env.USAGE_METER.idFromName(accountId);
  const stub = env.USAGE_METER.get(id);
  const res = await stub.fetch("https://usage-meter.internal/get");
  if (!res.ok) return null;
  return res.json();
}
