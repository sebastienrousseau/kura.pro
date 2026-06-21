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
}
