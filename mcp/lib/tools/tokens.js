import { z } from 'zod';
import * as api from '../api-client.js';

export function registerTokenTools(server) {
  server.tool(
    'token_list',
    'List all API tokens (secrets redacted, only prefix shown).',
    {},
    async () => {
      const res = await api.get('/api/tokens', { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'token_create',
    'Create a new scoped API token. The secret is returned ONCE and cannot be retrieved again.',
    {
      name: z.string().max(100).describe('Human-readable token name (e.g., "CI deploy bot")'),
      scopes: z.array(z.enum([
        'storage:read', 'storage:write', 'assets:read', 'insights:read',
        'zones:read', 'zones:write', 'purge:write', 'pipeline:write',
        'webhooks:read', 'webhooks:write',
      ])).describe('Permission scopes for this token'),
      expiresInDays: z.number().int().min(1).max(365).default(90).optional().describe('Token lifetime in days'),
    },
    async ({ name, scopes, expiresInDays }) => {
      const res = await api.post('/api/tokens', { name, scopes, expiresInDays }, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'token_revoke',
    'Revoke an API token by its ID. The token will immediately stop working.',
    { id: z.string().describe('Token ID to revoke') },
    async ({ id }) => {
      const res = await api.del(`/api/tokens?id=${id}`, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
