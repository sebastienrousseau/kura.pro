/**
 * Account-management + diagnostics MCP tools.
 *
 * Wraps the Phase 0 / Phase 1 / Phase 2A endpoints that don't yet have
 * MCP coverage:
 *
 *   - explain_cache_miss        → GET  /api/insights/cache-explain
 *   - account_cap_get           → GET  /api/account/cap
 *   - account_cap_set           → PATCH /api/account/cap
 *   - account_zone_list         → GET  /api/auth/onboarding/zone
 *   - account_zone_provision    → POST /api/auth/onboarding/zone
 *
 * Auth: these endpoints are session-cookie-gated, NOT
 * AccountKey/AccessKey. The MCP server is account-key-based today, so
 * the LLM agent needs a session-bearer flow before these calls land
 * end-to-end. For now the tools surface the response from the API as
 * the agent sees it (401 unauthenticated when no cookie present) —
 * useful for the agent to learn what flow to ask the user to run.
 *
 * @module @cloudcdn/mcp-server/lib/tools/account
 */

import { z } from 'zod';
import * as api from '../api-client.js';

export function registerAccountTools(server) {
  server.tool(
    'explain_cache_miss',
    'Diagnose why a CloudCDN URL hit or missed the edge cache. Returns the cf-cache-status + age + cache-control + cache-tag + a verdict ("hit_fresh" / "miss_origin_hit" / "bypass_no_store" / etc.) + actionable suggestions ("request again — should HIT", "purge by tag with …"). The URL MUST be on cloudcdn.pro. Session-cookie-gated.',
    {
      url: z.string().url().describe('Absolute https://cloudcdn.pro/... URL to inspect'),
    },
    async ({ url }) => {
      const res = await api.get('/api/insights/cache-explain', { params: { url } });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'account_cap_get',
    "Read the calling account's monthly spend cap in USD. capMode = 'degrade_only' (default — never bill overage; return 402 past zero) or 'hard_cap_with_opt_in_overage' (refuse past N until the user opts into overage billing). Session-cookie-gated.",
    {},
    async () => {
      const res = await api.get('/api/account/cap');
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'account_cap_set',
    'Set the calling account\'s monthly spend cap in USD. 0 = degrade-only (never bill overage). N > 0 = hard cap at $N/month past which requests return 402. Audit-logged via auditEvent. Session-cookie-gated.',
    {
      monthlyCapUsd: z.number().int().min(0).max(1_000_000).describe('Whole USD per calendar month. 0 = never bill overage.'),
    },
    async ({ monthlyCapUsd }) => {
      const res = await api.request('/api/account/cap', { method: 'PATCH', body: { monthlyCapUsd } });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'account_zone_list',
    'List the calling account\'s provisioned zones (the onboarding-wizard / multi-tenant per-account zones, distinct from the GitOps tenant zones surfaced by `zone_list`). Session-cookie-gated.',
    {},
    async () => {
      const res = await api.get('/api/auth/onboarding/zone');
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'account_zone_provision',
    'Provision a new account-scoped zone. Validates the origin via HEAD (5s timeout), slugifies the name, persists an account_zones row with an aspirational edge_hostname (<slug>.cdn.cloudcdn.pro) marked live=false until the Phase 3 routing pipeline flips it. Session-cookie-gated.',
    {
      name: z.string().min(1).max(64).describe('Display name (will be slugified for the edge hostname)'),
      originUrl: z.string().url().describe('Origin URL — http:// or https://'),
    },
    async ({ name, originUrl }) => {
      const res = await api.post('/api/auth/onboarding/zone', { name, originUrl });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  // ── Mutations (Phase 2C v2) ───────────────────────────────────

  server.tool(
    'purge_cache',
    'Invalidate cached content. Pass `urls` (1-30 absolute https://cloudcdn.pro/... URLs), `tags` (Cache-Tag values), or `everything: true`. Returns the number of items invalidated. AccountKey-gated (uses CLOUDCDN_ACCOUNT_KEY env var).',
    {
      urls: z.array(z.string().url()).max(30).optional().describe('Specific URLs to purge (max 30)'),
      tags: z.array(z.string().min(1).max(128)).max(30).optional().describe('Cache-Tag values to purge (max 30)'),
      everything: z.boolean().optional().describe('Purge the entire zone — use sparingly (degrades global edge cache for ~5 min).'),
    },
    async ({ urls, tags, everything }) => {
      const body = {};
      if (urls && urls.length) body.urls = urls;
      if (tags && tags.length) body.tags = tags;
      if (everything === true) body.everything = true;
      const res = await api.post('/api/purge', body);
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'deploy_function',
    'Create or update an edge-routing rule (a "function" in the rule-engine sense). The body is the same shape as POST /api/core/rules: { name, pattern, action: "rewrite"|"redirect"|"block"|"transform"|"cache", target?, ttl?, priority? }. AccountKey-gated.',
    {
      name: z.string().min(1).max(64).describe('Human-friendly rule name'),
      pattern: z.string().min(1).max(512).describe('URL pattern to match (glob or regex, see /api/core/rules docs)'),
      action: z.enum(['rewrite', 'redirect', 'block', 'transform', 'cache']).describe('What the rule does when matched'),
      target: z.string().max(512).optional().describe('Destination URL/path for rewrite|redirect actions'),
      ttl: z.number().int().min(0).max(31_536_000).optional().describe('Cache TTL in seconds (for action=cache)'),
      priority: z.number().int().min(0).max(1000).optional().describe('Lower wins. Default = 100.'),
    },
    async (input) => {
      const res = await api.post('/api/core/rules', input);
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'get_analytics',
    'Fetch account-wide statistics for a time range. Returns request counts, cache hit ratio, bytes served, AI invocations, error breakdown. Use `zone` to scope to a specific tenant zone; omit for account-wide. AccountKey-gated.',
    {
      zone: z.string().min(1).max(128).optional().describe('Zone slug (omit for account-wide)'),
      range: z.enum(['1h', '24h', '7d', '30d']).default('24h').describe('Time range. 30d max on free tier.'),
    },
    async ({ zone, range }) => {
      const params = { range };
      if (zone) params.zone = zone;
      const res = await api.get('/api/core/statistics', { params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
