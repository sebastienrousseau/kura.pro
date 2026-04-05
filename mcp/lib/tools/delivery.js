import { z } from 'zod';
import * as api from '../api-client.js';

export function registerDeliveryTools(server) {
  server.tool(
    'transform_image',
    'Generate a transformed image URL with resize, format conversion, blur, and sharpen. Returns the CDN URL (does not download the image). Rate limited to 50,000/month.',
    {
      url: z.string().describe('Relative asset path (e.g., "/akande/v1/logos/akande.svg")'),
      w: z.number().int().min(1).max(8192).optional().describe('Width in pixels'),
      h: z.number().int().min(1).max(8192).optional().describe('Height in pixels'),
      fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).optional(),
      format: z.enum(['auto', 'webp', 'avif', 'png', 'jpeg']).optional(),
      q: z.number().int().min(1).max(100).optional().describe('Quality (1-100)'),
      blur: z.number().int().min(1).max(250).optional(),
      sharpen: z.number().int().min(1).max(10).optional(),
      gravity: z.enum([
        'center', 'north', 'south', 'east', 'west',
        'northeast', 'northwest', 'southeast', 'southwest',
        'face', 'auto',
      ]).optional(),
    },
    async (params) => {
      // Build the transform URL for the agent to use/reference
      const queryParams = {};
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) queryParams[k] = v;
      }
      const transformUrl = new URL('/api/transform', api.BASE_URL);
      for (const [k, v] of Object.entries(queryParams)) {
        transformUrl.searchParams.set(k, String(v));
      }

      // Also verify it works by making the request
      const res = await api.get('/api/transform', { params: queryParams });
      const result = {
        transform_url: transformUrl.toString(),
        status: res.status,
        ok: res.ok,
        content_type: res.data?.contentType || null,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cache_purge',
    'Purge the Cloudflare CDN cache by specific URLs, surrogate tags, or purge everything. Rate limited to 100/day. Exactly one of urls, tags, or purge_everything must be provided.',
    {
      urls: z.array(z.string()).max(30).optional().describe('Array of full URLs to purge (must start with https://cloudcdn.pro/)'),
      tags: z.array(z.string()).max(30).optional().describe('Array of cache tags to purge (alphanumeric with hyphens)'),
      purge_everything: z.boolean().optional().describe('Set true to purge ALL cached content'),
    },
    async ({ urls, tags, purge_everything }) => {
      const body = {};
      if (purge_everything) body.purge_everything = true;
      else if (urls) body.urls = urls;
      else if (tags) body.tags = tags;

      const res = await api.post('/api/purge', body, { auth: 'purge' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'pipeline_ingest',
    'Scaffold a full zone from a single SVG upload. Creates logos, icons, favicon, and directory structure in a single atomic commit.',
    {
      mode: z.enum(['client', 'stock']).describe('"client" creates a full zone scaffold, "stock" uploads to shared library'),
      name: z.string().optional().describe('Zone name (required for client mode)'),
      svg: z.string().describe('Base64-encoded SVG content'),
      generateFavicon: z.boolean().default(true).optional(),
      generateIcons: z.boolean().default(true).optional(),
      generateBanners: z.boolean().default(true).optional(),
    },
    async (params) => {
      const res = await api.post('/api/pipeline', params, { auth: 'account' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
