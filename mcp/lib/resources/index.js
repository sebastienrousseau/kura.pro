import * as api from '../api-client.js';

export function registerResources(server) {
  server.resource(
    'manifest',
    'cloudcdn://manifest',
    {
      description: 'Complete JSON manifest of all CDN assets with names, paths, projects, categories, formats, and sizes.',
      mimeType: 'application/json',
    },
    async () => {
      const res = await api.get('/manifest.json');
      return {
        contents: [{
          uri: 'cloudcdn://manifest',
          mimeType: 'application/json',
          text: JSON.stringify(res.data, null, 2),
        }],
      };
    }
  );

  server.resource(
    'zones',
    'cloudcdn://zones',
    {
      description: 'List of all CDN zones with file counts and storage usage.',
      mimeType: 'application/json',
    },
    async () => {
      const res = await api.get('/api/core/zones', { auth: 'account' });
      return {
        contents: [{
          uri: 'cloudcdn://zones',
          mimeType: 'application/json',
          text: JSON.stringify(res.data, null, 2),
        }],
      };
    }
  );

  server.resource(
    'rules',
    'cloudcdn://rules',
    {
      description: 'Current _headers and _redirects edge configuration files.',
      mimeType: 'application/json',
    },
    async () => {
      const res = await api.get('/api/core/rules', { auth: 'account' });
      return {
        contents: [{
          uri: 'cloudcdn://rules',
          mimeType: 'application/json',
          text: JSON.stringify(res.data, null, 2),
        }],
      };
    }
  );

  server.resource(
    'health',
    'cloudcdn://health',
    {
      description: 'Live service-health snapshot — binding presence (KV / AI / Vectorize / Durable Object / Queue), per-binding latency, healthy/degraded state. Refresh on every read.',
      mimeType: 'application/json',
    },
    async () => {
      const res = await api.get('/api/health', { params: { deep: 1 } });
      return {
        contents: [{
          uri: 'cloudcdn://health',
          mimeType: 'application/json',
          text: JSON.stringify(res.data, null, 2),
        }],
      };
    }
  );

  server.resource(
    'openapi',
    'cloudcdn://openapi',
    {
      description: 'Full OpenAPI 3.1 specification for the CloudCDN REST API — every path, schema, tag group, security scheme, and example. Agents can read this as the source-of-truth contract when wiring direct HTTP calls.',
      mimeType: 'application/json',
    },
    async () => {
      const res = await api.get('/api-reference/openapi.json');
      return {
        contents: [{
          uri: 'cloudcdn://openapi',
          mimeType: 'application/json',
          text: JSON.stringify(res.data, null, 2),
        }],
      };
    }
  );

  server.resource(
    'insights-today',
    'cloudcdn://insights/today',
    {
      description: 'Current-day insights summary — request volume, bandwidth served, cache hit ratio, top assets, error rate. Pulls from /api/insights/summary; refreshes on every read.',
      mimeType: 'application/json',
    },
    async () => {
      const res = await api.get('/api/insights/summary', { auth: 'access' });
      return {
        contents: [{
          uri: 'cloudcdn://insights/today',
          mimeType: 'application/json',
          text: JSON.stringify(res.data, null, 2),
        }],
      };
    }
  );
}
