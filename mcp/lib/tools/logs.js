import { z } from 'zod';
import * as api from '../api-client.js';

export function registerLogTools(server) {
  server.tool(
    'logs_query',
    'Query historical log entries with optional level filter. Returns structured JSON logs.',
    {
      days: z.number().int().min(1).max(7).default(1).optional().describe('Number of days to query'),
      level: z.enum(['info', 'warn', 'error']).optional().describe('Filter by log level'),
      limit: z.number().int().min(1).max(500).default(100).optional(),
    },
    async ({ days, level, limit }) => {
      const params = {};
      if (days) params.days = days;
      if (level) params.level = level;
      if (limit) params.limit = limit;
      const res = await api.get('/api/logs', { auth: 'account', params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
