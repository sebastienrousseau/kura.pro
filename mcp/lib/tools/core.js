import { z } from 'zod';
import * as api from '../api-client.js';

export function registerCoreTools(server) {
  server.tool(
    'zone_list',
    'List all CDN zones (tenant namespaces) with file counts, storage usage, and categories.',
    {},
    async () => {
      const res = await api.get('/api/core/zones', { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'zone_get',
    'Get detailed information about a specific zone including all files, categories, formats, and storage usage.',
    { zone_id: z.string().describe('Zone identifier (e.g., "akande", "bankingonai")') },
    async ({ zone_id }) => {
      const res = await api.get(`/api/core/zones/${zone_id}`, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'zone_create',
    'Create a new CDN zone with standard v1/ directory scaffolding (banners, github, icons, logos, titles). Committed via Git.',
    {
      name: z.string()
        .min(2).max(64)
        .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
        .describe('Zone name (2-64 chars, lowercase alphanumeric and hyphens)'),
    },
    async ({ name }) => {
      const res = await api.post('/api/core/zones', { Name: name }, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'zone_delete',
    'Delete an entire zone and all its files. This is DESTRUCTIVE and cannot be undone. Initiates edge cache purge.',
    { zone_id: z.string().describe('Zone identifier to delete') },
    async ({ zone_id }) => {
      const res = await api.del(`/api/core/zones/${zone_id}`, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'domain_add',
    'Add a custom domain to a zone. SSL/TLS certificate is provisioned automatically. Create a CNAME record pointing to cloudcdn-pro.pages.dev.',
    {
      zone_id: z.string().describe('Zone to attach the domain to'),
      hostname: z.string().describe('Fully qualified domain (e.g., "cdn.example.com")'),
    },
    async ({ zone_id, hostname }) => {
      const res = await api.post(`/api/core/zones/${zone_id}/domains`, { Hostname: hostname }, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'rules_get',
    'Read the current Cloudflare Pages edge configuration files (_headers and _redirects).',
    {},
    async () => {
      const res = await api.get('/api/core/rules', { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'rules_update',
    'Update the _headers or _redirects edge configuration file. Committed via Git, deployed in ~60-90 seconds.',
    {
      file: z.enum(['_headers', '_redirects']).describe('Which edge config file to update'),
      content: z.string().max(100000).describe('Full file content'),
    },
    async ({ file, content }) => {
      const res = await api.post('/api/core/rules', { File: file, Content: content }, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
