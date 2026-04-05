import { z } from 'zod';
import * as api from '../api-client.js';

export function registerWebhookTools(server) {
  server.tool(
    'webhook_list',
    'List all registered webhooks.',
    {},
    async () => {
      const res = await api.get('/api/webhooks', { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'webhook_create',
    'Register a new webhook for CDN events (asset.created, asset.deleted, zone.created, etc.). Supports HMAC-SHA256 signed delivery.',
    {
      url: z.string().describe('Webhook delivery URL (must be https://)'),
      events: z.array(z.enum([
        'asset.created', 'asset.deleted', 'asset.updated',
        'zone.created', 'zone.deleted',
        'purge.completed', 'pipeline.completed',
      ])).describe('Events to subscribe to'),
      secret: z.string().optional().describe('Optional HMAC secret for signature verification'),
    },
    async ({ url, events, secret }) => {
      const body = { url, events };
      if (secret) body.secret = secret;
      const res = await api.post('/api/webhooks', body, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'webhook_delete',
    'Remove a registered webhook by its ID.',
    { id: z.string().describe('Webhook ID to remove') },
    async ({ id }) => {
      const res = await api.del(`/api/webhooks?id=${id}`, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
