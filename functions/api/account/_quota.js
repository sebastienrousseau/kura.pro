/**
 * Account spend-cap enforcement primitives.
 *
 * Two pieces:
 *   1. `currentMonthUsageUsd(env, accountId)` — pull the running
 *      month-to-date spend total. Reads from RATE_KV (best-effort
 *      cache) backed by the Workers Analytics Engine query. Returns
 *      cents/100 in USD; 0 if the lookup fails (degrade-open — never
 *      block a request because we couldn't reach AE).
 *   2. `enforceCap(env, account)` — returns null when the request is
 *      allowed or a Response (402) when it must be refused.
 *
 * Caller pattern:
 *
 *   const refusal = await enforceCap(env, current.account);
 *   if (refusal) return refusal;
 *
 * Wired into the public asset / transform / ai endpoints once the
 * usage_meter DO is shipping real numbers (Phase 2A v2). For now the
 * helper exists so handlers can adopt the pattern without waiting on
 * the metering pipeline.
 */

const USAGE_CACHE_KEY = (id, period) => `usage:${id}:${period}`;
const USAGE_CACHE_TTL = 60; // seconds — cheap freshness for hot paths

export function currentBillingPeriod(now = Date.now()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Seconds until the next UTC calendar-month boundary — used for the
// Retry-After header so well-behaved clients back off until reset.
export function secondsUntilNextMonth(now = Date.now()) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const next = Date.UTC(year, month + 1, 1, 0, 0, 0, 0);
  return Math.max(0, Math.floor((next - now) / 1000));
}

export async function currentMonthUsageUsd(env, accountId) {
  if (!env || !accountId) return 0;
  const period = currentBillingPeriod();
  if (env.RATE_KV) {
    try {
      const cached = await env.RATE_KV.get(USAGE_CACHE_KEY(accountId, period));
      if (cached !== null) return Number(cached) || 0;
    } catch { /* fall through to AE */ }
  }
  // Workers Analytics Engine SQL — only available when METRICS binding
  // is wired AND a CLOUDFLARE_API_TOKEN with `Account Analytics: Read`
  // is in env. Both are optional in Phase 2A v1; we just return 0 if
  // either is missing. The Phase 2A v2 usage_meter DO will populate
  // the RATE_KV cache directly so this AE round-trip is rare.
  /* v8 ignore next 21 — AE round-trip requires CLOUDFLARE_API_TOKEN +
     Account Analytics permission; verifying the integration belongs in
     an end-to-end test, not a unit test. */
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    try {
      const sql = `SELECT sum(double1) AS usd FROM cloudcdn_analytics WHERE index1 = '${accountId}' AND timestamp >= toDateTime('${period}-01 00:00:00') FORMAT JSON`;
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
          body: sql,
        },
      );
      if (res.ok) {
        const data = await res.json();
        const usd = Number(data?.data?.[0]?.usd) || 0;
        if (env.RATE_KV) {
          // adr: ADR-09 — usage cache, 1 write per period boundary
          env.RATE_KV.put(USAGE_CACHE_KEY(accountId, period), String(usd), { expirationTtl: USAGE_CACHE_TTL }).catch(() => {});
        }
        return usd;
      }
    } catch { /* swallow */ }
  }
  return 0;
}

// Build the 402 response when an account's cap is reached. The
// Retry-After header points to the next UTC month boundary so
// well-behaved clients (CLIs, cURL with --retry-after) wait it out.
export function buildCapResponse(account, usageUsd) {
  const retryAfter = secondsUntilNextMonth();
  const body = {
    error: {
      code: "spend_cap_reached",
      message: `Account ${account.id} reached its monthly spend cap of $${account.monthlyCapUsd}. Requests will resume at the next UTC calendar-month boundary.`,
      monthlyCapUsd: account.monthlyCapUsd,
      monthToDateUsageUsd: usageUsd,
      retryAfterSeconds: retryAfter,
      enableOverage: "Set a higher monthlyCapUsd via PATCH /api/account/cap or enable overage billing via /api/account/billing (Phase 3).",
    },
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfter),
      "X-RateLimit-Reset": String(Math.floor((Date.now() / 1000) + retryAfter)),
    },
  });
}

// Returns a Response when the request must be refused, null when it
// can proceed. cap === 0 is "degrade-only" — refusal kicks in as soon
// as usage > 0 only if the operator explicitly set cap to 0 (the
// default). cap > 0 = soft hard cap (refuse past N until the user
// opts into overage billing).
export async function enforceCap(env, account) {
  if (!account || !account.id) return null;
  const cap = Number(account.monthlyCapUsd);
  if (!Number.isFinite(cap)) return null;
  const usage = await currentMonthUsageUsd(env, account.id);
  // cap === 0 means "never bill overage": any usage > 0 with no
  // overage opt-in is refused. cap > 0 means refuse once usage
  // exceeds the cap.
  const overLimit = cap === 0 ? usage > 0 : usage >= cap;
  if (!overLimit) return null;
  return buildCapResponse(account, usage);
}
