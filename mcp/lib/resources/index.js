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
}
