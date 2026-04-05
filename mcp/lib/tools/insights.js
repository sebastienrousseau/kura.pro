import { z } from 'zod';
import * as api from '../api-client.js';

const daysParam = z.number().int().min(1).max(90).default(7).optional().describe('Number of days to query (1-90)');

export function registerInsightsTools(server) {
  server.tool(
    'insights_summary',
    'Get aggregated analytics: total requests, bandwidth, cache hit rate, and unique countries over a time window.',
    {
      days: daysParam,
      zone: z.string().optional().describe('Optional zone filter'),
    },
    async (params) => {
      const res = await api.get('/api/insights/summary', { auth: 'access', params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'insights_top_assets',
    'Get the most requested assets ranked by hit count.',
    {
      days: daysParam,
      limit: z.number().int().min(1).max(100).default(20).optional().describe('Number of top assets to return'),
    },
    async (params) => {
      const res = await api.get('/api/insights/top-assets', { auth: 'access', params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'insights_geography',
    'Get request distribution by country code.',
    { days: daysParam },
    async (params) => {
      const res = await api.get('/api/insights/geography', { auth: 'access', params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'insights_errors',
    'Get error tracking data: breakdown by HTTP status code with the most affected paths.',
    { days: daysParam },
    async (params) => {
      const res = await api.get('/api/insights/errors', { auth: 'access', params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
