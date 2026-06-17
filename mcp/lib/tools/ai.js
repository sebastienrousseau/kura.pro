/**
 * AI / search MCP tools — semantic search, RAG concierge, vision
 * endpoints, and placeholder generators. All are public-access.
 *
 * The vision and chat endpoints share a Workers AI budget guard; when the
 * daily quota trips, responses flip to cached / fuzzy / curated mode and
 * mark themselves with `degraded: true` so agents don't need to branch.
 *
 * @module @cloudcdn/mcp-server/lib/tools/ai
 */

import { z } from 'zod';
import * as api from '../api-client.js';

const URL_PATH = z.string()
  .min(1)
  .max(2048)
  .describe('Relative asset path (e.g. "/clients/akande/v1/logos/logo.svg"). Absolute URLs are rejected.');

/**
 * Register the AI tools (`semantic_search`, `health_check`,
 * `generate_alt_text`, `smart_crop`, `moderate_image`, `placeholder_lqip`,
 * `placeholder_blurhash`, `chat_ask`, `remove_background`) on the given
 * MCP server.
 *
 * @param {{ tool: Function }} server - The MCP server instance.
 * @returns {void}
 */
export function registerAiTools(server) {
  server.tool(
    'semantic_search',
    'Search the asset catalog using natural language. Uses vector similarity (Cloudflare Vectorize) with fuzzy text fallback. Returns `mode: vector|fuzzy|cached` so agents can tell which layer responded; `degraded: true` indicates the AI path is bypassed (quota exhausted or unavailable).',
    {
      q: z.string().describe('Natural language search query (e.g., "dark blue banking background")'),
      limit: z.number().int().min(1).max(50).default(20).optional(),
    },
    async ({ q, limit }) => {
      const res = await api.get('/api/search', { params: { q, limit } });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'health_check',
    'Check the health status of the CloudCDN service and the availability of its backend bindings (KV, AI, Vectorize).',
    {},
    async () => {
      const res = await api.get('/api/health');
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'generate_alt_text',
    'Generate a short, accessibility-quality alt-text description for an image using a Workers AI vision model. Caches the result for 24 h. Returns `{ alt, model, source: "ai"|"cached", degraded, dateGenerated }`. Useful at upload time to seed an `alt=` attribute, or on-demand for authoring tools.',
    { url: URL_PATH },
    async ({ url }) => {
      const res = await api.post('/api/ai/alt-text', { url });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'smart_crop',
    'Identify where the visual subject of an image sits and return a `gravity` value compatible with /api/transform. Output is one of nine compass directions plus "face" and "center", with a confidence band (`high|medium|low`). Chain with the transform tool to get a subject-aware square thumbnail.',
    { url: URL_PATH },
    async ({ url }) => {
      const res = await api.post('/api/ai/smart-crop', { url });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'moderate_image',
    'Classify an image\'s safety across five categories (nudity, violence, drugs, hate symbols, gore) using a Workers AI vision model. Returns `{ safe, verdict: "safe"|"borderline"|"unsafe", categories: { ...0-1 floats }, reasoning }`. Use as an automated gate during upload pipelines — on unparseable output the endpoint conservatively returns "borderline" so the caller still has to decide.',
    { url: URL_PATH },
    async ({ url }) => {
      const res = await api.post('/api/ai/moderate', { url });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'placeholder_lqip',
    'Generate a low-quality image placeholder (LQIP) as a base64 data URI. Useful for progressive-loading UIs that need an immediate visual placeholder while the full asset streams in. Returns `{ lqip: "data:image/webp;base64,...", bytes, width, dateGenerated }`. The result is deterministic per (url, size, blur) and cached for 24 h.',
    {
      url: URL_PATH,
      size: z.number().int().min(8).max(64).default(32).optional()
        .describe('Width of the downsampled placeholder in pixels. Clamped to [8, 64].'),
      blur: z.number().int().min(1).max(250).default(30).optional()
        .describe('Gaussian blur radius applied by Cloudflare Image Resizing.'),
    },
    async ({ url, size, blur }) => {
      const params = { url };
      if (size !== undefined) params.size = size;
      if (blur !== undefined) params.blur = blur;
      const res = await api.get('/api/lqip', { params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'placeholder_blurhash',
    'Generate a content-addressable placeholder hash (40-char SHA-256 prefix) plus a base64 data URI for an image. Companion to the LQIP tool — same downsampled WebP, but the hash is a stable key clients can use to dedupe placeholders or persist them by content. Cached for 24 h per (url, size) tuple.',
    {
      url: URL_PATH,
      size: z.number().int().min(8).max(64).default(32).optional()
        .describe('Width of the downsampled placeholder in pixels.'),
    },
    async ({ url, size }) => {
      const params = { url };
      if (size !== undefined) params.size = size;
      const res = await api.get('/api/blurhash', { params });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'chat_ask',
    'Ask the CloudCDN AI concierge a natural-language question about the platform — pricing, limits, how to use a specific endpoint, troubleshooting, etc. The concierge is a RAG agent over the `cdn/en/content/` knowledge base. Returns `{ answer, sources: string[], confidence: "high"|"medium"|"low", source: "ai"|"cached"|"curated", degraded: boolean }`. When AI quota is exhausted the curated 30-entry FAQ takes over (`source: "curated"`); the contract is identical so agents need no special branching.',
    {
      question: z.string().min(1).max(2000).describe('Free-form question. Be specific — "how do I purge by tag" beats "purge help".'),
    },
    async ({ question }) => {
      const res = await api.post('/api/chat', { messages: [{ role: 'user', content: question }] });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    'remove_background',
    'Remove the background from an image, isolating the subject on a transparent alpha layer. **Not yet implemented** — the endpoint returns HTTP 501 because Cloudflare Workers AI does not currently include a segmentation/matting model (U^2-Net / rembg-class). The route is documented and discoverable so agents and clients can integrate ahead of the model landing; when a model becomes available the implementation will swap in without changing this contract. Use the smart_crop tool today for subject-aware framing as the nearest substitute.',
    { url: URL_PATH },
    async ({ url }) => {
      // Intentionally lenient: this endpoint always returns 501, and we
      // surface that to the agent as a structured tool result rather than
      // a thrown error — agents should be able to read the "blocked by
      // dependency" message and route around it.
      try {
        const res = await api.post('/api/ai/background-remove', { url });
        return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
      } catch (err) {
        const body = err?.response?.data ?? { error: { code: 'NotImplemented', message: err?.message || String(err) } };
        return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
      }
    }
  );
}
