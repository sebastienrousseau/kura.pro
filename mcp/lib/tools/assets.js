import { z } from 'zod';
import * as api from '../api-client.js';

export function registerAssetsTools(server) {
  server.tool(
    'assets_list',
    'Browse and search the CDN asset catalog with filtering by project, category, and format. Supports pagination and sorting.',
    {
      project: z.string().optional().describe('Filter by project/zone name'),
      category: z.string().optional().describe('Filter by category (logos, banners, icons, etc.)'),
      format: z.string().optional().describe('Filter by file format (svg, png, webp, avif, ico)'),
      q: z.string().optional().describe('Search query for filename or path'),
      page: z.number().int().min(1).default(1).optional(),
      per_page: z.number().int().min(1).max(200).default(50).optional(),
      sort: z.enum(['name', 'size', 'project']).default('name').optional(),
      order: z.enum(['asc', 'desc']).default('asc').optional(),
    },
    async (params) => {
      const res = await api.get('/api/assets', { auth: 'access', params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'asset_metadata_get',
    'Get the full metadata record for a single asset by path: dimensions, format, size, project, category, ETag, content hash, and any AI-derived fields (alt text, smart-crop gravity, dominant colors) cached against it. Use this before a transform or to populate a card UI.',
    {
      path: z.string().min(1).max(1024).describe('Relative asset path (e.g. "/akande/v1/logos/akande.svg")'),
    },
    async ({ path }) => {
      const res = await api.get('/api/assets/metadata', { auth: 'access', params: { path } });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'assets_search',
    'Search for assets by name or path. Returns matching assets with metadata.',
    {
      q: z.string().describe('Search query (e.g., "logo", "banner-bankingonai")'),
      project: z.string().optional().describe('Narrow search to a specific project'),
      format: z.string().optional().describe('Narrow search to a specific format'),
    },
    async ({ q, project, format }) => {
      const params = { q, per_page: 50 };
      if (project) params.project = project;
      if (format) params.format = format;
      const res = await api.get('/api/assets', { auth: 'access', params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
