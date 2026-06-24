/**
 * Workers Logs tail bridge.
 *
 * Calls the Cloudflare REST API to create a `tail` session against
 * the cloudcdn-pro Pages Worker, then connects to the returned
 * WebSocket URL and forwards each log event through a caller-supplied
 * `onEvent` callback. Caller is responsible for sending each event
 * on to the upstream client WebSocket.
 *
 * Requirements:
 *   env.CF_API_TOKEN    — Account-scoped, "Workers Scripts:Read" + "Workers Tail:Edit"
 *   env.CF_ACCOUNT_ID   — UUID of the Cloudflare account
 *   env.LOGS_SCRIPT_NAME — Worker script name (defaults to "cloudcdn-pro")
 *
 * When any of these are missing, `bridgeAvailable(env)` returns false
 * and the caller should fall back to the existing audit-event poll.
 *
 * Filtering:
 *   The Workers Logs stream is global to the script (every request),
 *   not partitioned by account. Filtering down to a single tenant
 *   happens here, by matching events whose `event.request.url` or
 *   `event.logs[].message` contains the account UUID. Best-effort —
 *   the canonical per-account stream is the D1 audit-event poll.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export function bridgeAvailable(env) {
  return Boolean(env?.CF_API_TOKEN && env?.CF_ACCOUNT_ID);
}

/**
 * Create a tail session via the REST API. Returns the WebSocket URL +
 * one-time token. Throws on non-2xx.
 */
export async function createTailSession(env, { fetchImpl = fetch } = {}) {
  if (!bridgeAvailable(env)) {
    throw new Error("workers-logs bridge unavailable — set CF_API_TOKEN + CF_ACCOUNT_ID");
  }
  const script = env.LOGS_SCRIPT_NAME || "cloudcdn-pro";
  const url = `${CF_API}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${script}/tails`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filters: [] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`tail-create failed: ${res.status} ${text.slice(0, 256)}`);
  }
  const body = await res.json();
  const url2 = body?.result?.url;
  const id   = body?.result?.id;
  if (!url2) throw new Error("tail-create: no url in response");
  return { url: url2, id };
}

/**
 * Pure filter — decides whether a given Workers Logs event belongs to
 * the given account. The event shape is the standard Workers Tail
 * payload: { outcome, eventTimestamp, event: { request: { url, ... } },
 * logs: [{ message: [...], level }], exceptions: [...] }.
 *
 * Strategy: any of (a) the request URL path includes the account UUID,
 * (b) any log message includes the account UUID, (c) the request
 * carries an `cf-account-id` header that matches.
 */
export function eventBelongsToAccount(event, accountId) {
  if (!event || !accountId) return false;
  const needle = String(accountId);
  const requestUrl = event.event?.request?.url || "";
  if (typeof requestUrl === "string" && requestUrl.includes(needle)) return true;
  const headers = event.event?.request?.headers || {};
  if (headers["cf-account-id"] === needle) return true;
  const logs = Array.isArray(event.logs) ? event.logs : [];
  for (const l of logs) {
    const msgs = Array.isArray(l?.message) ? l.message : [];
    for (const m of msgs) {
      if (typeof m === "string" && m.includes(needle)) return true;
    }
  }
  return false;
}

/**
 * Map a raw Workers Logs event to the same wire shape `/api/logs/tail`
 * already emits (`{ type: 'audit', ... }`-style), so the client doesn't
 * have to learn two schemas.
 */
export function mapWorkersLogEvent(event) {
  const ts = Math.floor((event.eventTimestamp ? Number(event.eventTimestamp) : Date.now()) / 1000);
  return {
    type: "worker_log",
    outcome: event.outcome || "unknown",
    requestUrl: event.event?.request?.url || null,
    requestMethod: event.event?.request?.method || null,
    logLevel: event.logs?.[0]?.level || null,
    message: stringifyLogs(event.logs),
    exceptions: (event.exceptions || []).map((e) => ({
      name: e.name || "Error",
      message: e.message || String(e),
    })),
    createdAt: ts,
  };
}

function stringifyLogs(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return null;
  const parts = [];
  for (const l of logs) {
    const msgs = Array.isArray(l?.message) ? l.message : [];
    for (const m of msgs) {
      if (typeof m === "string") parts.push(m);
      else if (m === null) parts.push("null");
      else { try { parts.push(JSON.stringify(m)); } catch { parts.push(String(m)); } }
    }
  }
  return parts.join(" ").slice(0, 2048);
}
