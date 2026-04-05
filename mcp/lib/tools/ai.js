import { z } from 'zod';
import * as api from '../api-client.js';

export function registerAiTools(server) {
  server.tool(
    'semantic_search',
    'Search the asset catalog using natural language. Uses vector similarity (Cloudflare Vectorize) with fuzzy text fallback. Returns scored results.',
    {
      q: z.string().describe('Natural language search query (e.g., "dark blue banking background")'),
      limit: z.number().int().min(1).max(50).default(20).optional(),
    },
    async ({ q, limit }) => {
      const res = await api.get('/api/search', { params: { q, limit } });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'health_check',
    'Check the health status of the CloudCDN service and the availability of its backend bindings (KV, AI, Vectorize).',
    {},
    async () => {
      const res = await api.get('/api/health');
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
