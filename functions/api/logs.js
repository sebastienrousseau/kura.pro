/**
 * Real-time log streaming endpoint.
 *
 * GET /api/logs?tail=true   — SSE stream of recent log events
 * GET /api/logs?days=1      — Historical log entries (last N days)
 *
 * Auth: AccountKey (control-plane operation)
 *
 * Log events are stored in KV with TTL. Each request logged by middleware
 * writes a structured entry that this endpoint reads and streams.
 */

import { authenticateAccount, log } from './_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const LOG_KEY_PREFIX = 'logs:';
const MAX_ENTRIES_PER_READ = 100;

/**
 * GET /api/logs — stream or query log entries.
 */
export async function onRequestGet(context) {
  const { request, env } = context;

  if (!authenticateAccount(request, env)) {
    return new Response(JSON.stringify({ HttpCode: 401, Message: 'AccountKey required.' }), { status: 401, headers: CORS });
  }

  const kv = env.RATE_KV;
  if (!kv) return new Response(JSON.stringify({ HttpCode: 503, Message: 'KV unavailable.' }), { status: 503, headers: CORS });

  const url = new URL(request.url);
  const tail = url.searchParams.get('tail') === 'true';

  if (tail) {
    return streamLogs(kv, request);
  }

  return queryLogs(kv, url);
}

/**
 * SSE stream — polls KV every 2 seconds for new entries.
 */
function streamLogs(kv, request) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  let lastCursor = Date.now();

  (async () => {
    try {
      await writer.write(encoder.encode(`event: connected\ndata: ${JSON.stringify({ message: 'Log stream connected' })}\n\n`));

      // Stream for up to 5 minutes (Cloudflare Workers limit)
      const deadline = Date.now() + 5 * 60 * 1000;

      while (Date.now() < deadline) {
        const entries = await readLogsSince(kv, lastCursor);
        for (const entry of entries) {
          await writer.write(encoder.encode(`event: log\ndata: ${JSON.stringify(entry)}\n\n`));
          if (entry.timestamp) {
            const ts = new Date(entry.timestamp).getTime();
            if (ts > lastCursor) lastCursor = ts;
          }
        }

        // Send heartbeat
        await writer.write(encoder.encode(`:heartbeat ${new Date().toISOString()}\n\n`));

        // Wait 2 seconds before next poll
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch {
      // Client disconnected
    } finally {
      try { await writer.close(); } catch {}
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Historical query — reads the last N days of aggregated logs.
 */
async function queryLogs(kv, url) {
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '1', 10), 1), 7);
  const level = url.searchParams.get('level') || null; // filter: error, warn, info
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

  const entries = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const raw = await kv.get(`${LOG_KEY_PREFIX}${date}`);
    if (raw) {
      const dayEntries = JSON.parse(raw);
      entries.push(...dayEntries);
    }
  }

  let filtered = entries;
  if (level) {
    filtered = entries.filter(e => e.level === level);
  }

  // Sort newest first, limit
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  filtered = filtered.slice(0, limit);

  return new Response(JSON.stringify({
    Period: { Days: days, Level: level },
    Entries: filtered,
    Count: filtered.length,
    DateFetched: new Date().toISOString(),
  }), { headers: CORS });
}

async function readLogsSince(kv, since) {
  const date = new Date().toISOString().slice(0, 10);
  const raw = await kv.get(`${LOG_KEY_PREFIX}${date}`);
  if (!raw) return [];
  const entries = JSON.parse(raw);
  return entries.filter(e => new Date(e.timestamp).getTime() > since);
}

/**
 * Append a log entry to KV. Called by the structured logger or middleware.
 *
 * @param {object} kv - KV namespace binding
 * @param {object} entry - Log entry { level, code, message, timestamp, ...meta }
 */
export async function appendLog(kv, entry) {
  if (!kv) return;
  const date = entry.timestamp?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const key = `${LOG_KEY_PREFIX}${date}`;

  const raw = await kv.get(key);
  const entries = raw ? JSON.parse(raw) : [];
  entries.push(entry);

  // Keep last 1000 entries per day
  if (entries.length > 1000) entries.splice(0, entries.length - 1000);

  await kv.put(key, JSON.stringify(entries), { expirationTtl: 86400 * 8 }); // 8-day TTL
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'AccountKey',
      'Access-Control-Max-Age': '86400',
    },
  });
}
