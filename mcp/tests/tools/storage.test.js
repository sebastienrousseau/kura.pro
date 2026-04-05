import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

function mockFetch(data = {}, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('storage tools', () => {
  describe('storage_list', () => {
    it('calls GET /api/storage/{path} with AccessKey', async () => {
      process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
      process.env.CLOUDCDN_ACCESS_KEY = 'sk_test';
      mockFetch([{ ObjectName: 'logo.svg', IsDirectory: false }]);

      const { registerStorageTools } = await import('../../lib/tools/storage.js');
      const tools = {};
      const server = {
        tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
      };
      registerStorageTools(server);

      const result = await tools.storage_list({ path: 'clients/akande/v1/logos/' });
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].ObjectName).toBe('logo.svg');

      const [url, opts] = globalThis.fetch.mock.calls[0];
      expect(url).toContain('/api/storage/clients/akande/v1/logos/');
      expect(opts.headers.AccessKey).toBe('sk_test');
    });
  });

  describe('storage_upload', () => {
    it('calls PUT with decoded base64 body', async () => {
      process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
      process.env.CLOUDCDN_ACCESS_KEY = 'sk_test';
      mockFetch({ HttpCode: 201, Message: 'Uploaded' });

      const { registerStorageTools } = await import('../../lib/tools/storage.js');
      const tools = {};
      const server = {
        tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
      };
      registerStorageTools(server);

      const result = await tools.storage_upload({
        path: 'clients/test/v1/logos/logo.svg',
        content_base64: btoa('<svg></svg>'),
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.HttpCode).toBe(201);

      const [url, opts] = globalThis.fetch.mock.calls[0];
      expect(url).toContain('/api/storage/clients/test/v1/logos/logo.svg');
      expect(opts.method).toBe('PUT');
    });
  });

  describe('storage_delete', () => {
    it('calls DELETE with correct path', async () => {
      process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
      process.env.CLOUDCDN_ACCESS_KEY = 'sk_test';
      mockFetch({ HttpCode: 200, Message: 'Deleted' });

      const { registerStorageTools } = await import('../../lib/tools/storage.js');
      const tools = {};
      const server = {
        tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
      };
      registerStorageTools(server);

      await tools.storage_delete({ path: 'clients/test/v1/logos/old.svg' });
      const [url, opts] = globalThis.fetch.mock.calls[0];
      expect(url).toContain('/api/storage/clients/test/v1/logos/old.svg');
      expect(opts.method).toBe('DELETE');
    });
  });

  describe('storage_batch_upload', () => {
    it('sends POST /api/storage/batch with files array', async () => {
      process.env.CLOUDCDN_BASE_URL = 'https://test.cdn';
      process.env.CLOUDCDN_ACCESS_KEY = 'sk_test';
      mockFetch({ HttpCode: 201, Commit: 'abc123' });

      const { registerStorageTools } = await import('../../lib/tools/storage.js');
      const tools = {};
      const server = {
        tool: (name, _desc, _schema, handler) => { tools[name] = handler; },
      };
      registerStorageTools(server);

      const files = [
        { path: 'clients/test/v1/logos/a.svg', content: btoa('<svg>a</svg>'), encoding: 'base64' },
        { path: 'clients/test/v1/logos/b.svg', content: btoa('<svg>b</svg>'), encoding: 'base64' },
      ];

      const result = await tools.storage_batch_upload({ files });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.Commit).toBe('abc123');

      const [url, opts] = globalThis.fetch.mock.calls[0];
      expect(url).toContain('/api/storage/batch');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.files).toHaveLength(2);
    });
  });
});
