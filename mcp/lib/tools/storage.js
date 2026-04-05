import { z } from 'zod';
import * as api from '../api-client.js';

export function registerStorageTools(server) {
  server.tool(
    'storage_list',
    'List files and subdirectories at a storage path. Returns Bunny.net-compatible file entries with names, sizes, and timestamps.',
    { path: z.string().describe('Directory path to list (e.g., "clients/akande/v1/logos/")') },
    async ({ path }) => {
      const res = await api.get(`/api/storage/${path}`, { auth: 'access' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'storage_upload',
    'Upload a file to the CDN. The file is committed via Git and deployed to 300+ edge locations in ~60-90 seconds.',
    {
      path: z.string().describe('Destination path (e.g., "clients/akande/v1/logos/logo.svg")'),
      content_base64: z.string().describe('File content encoded as base64'),
      checksum: z.string().optional().describe('Optional SHA-256 hex checksum for integrity verification'),
    },
    async ({ path, content_base64, checksum }) => {
      const body = Uint8Array.from(atob(content_base64), c => c.charCodeAt(0));
      const headers = {};
      if (checksum) headers.Checksum = checksum;
      const res = await api.put(`/api/storage/${path}`, body, { auth: 'access', headers });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'storage_delete',
    'Delete a file from the CDN. Removes it from the repository and initiates an edge cache purge.',
    { path: z.string().describe('File path to delete (e.g., "clients/akande/v1/logos/old.svg")') },
    async ({ path }) => {
      const res = await api.del(`/api/storage/${path}`, { auth: 'access' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'storage_batch_upload',
    'Upload up to 50 files in a single atomic Git commit. More efficient than individual uploads for multiple assets.',
    {
      files: z.array(z.object({
        path: z.string().describe('Destination path for this file'),
        content: z.string().describe('Base64-encoded file content'),
        encoding: z.enum(['base64']).default('base64'),
      })).max(50).describe('Array of file objects to upload'),
    },
    async ({ files }) => {
      const res = await api.post('/api/storage/batch', { files }, { auth: 'access' });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
