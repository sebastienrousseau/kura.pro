/**
 * CloudCDN MCP server definition.
 *
 * Wires every tool and resource registration into an `McpServer` instance.
 * The result is a fully configured server that the entry point (or any
 * embedder) just needs to `.connect(transport)`.
 *
 * Registers 42 tools across 9 API planes + 6 read-only resources:
 *
 *   Storage   (4)  storage_list / upload / delete / batch_upload
 *   Core      (8)  statistics_summary, zone_(list|get|create|delete),
 *                  domain_add, rules_(get|update)
 *   Assets    (3)  assets_list, asset_metadata_get, assets_search
 *   Insights  (6)  insights_summary / top_assets / geography / errors /
 *                  asset, audit_logs
 *   Delivery  (5)  transform_image, cache_purge, signed_url_generate,
 *                  stream_playlist, pipeline_ingest
 *   AI        (9)  semantic_search, health_check, generate_alt_text,
 *                  smart_crop, moderate_image, placeholder_lqip,
 *                  placeholder_blurhash, chat_ask, remove_background
 *   Webhooks  (3)  webhook_(list|create|delete)
 *   Tokens    (3)  token_(list|create|revoke)
 *   Logs      (1)  logs_query
 *
 *   Resources (6)  manifest, zones, rules, health, openapi, insights-today
 *
 * Each tool maps to a CloudCDN HTTP endpoint via the shared API client.
 *
 * @module @cloudcdn/mcp-server/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerStorageTools } from './lib/tools/storage.js';
import { registerCoreTools } from './lib/tools/core.js';
import { registerAssetsTools } from './lib/tools/assets.js';
import { registerInsightsTools } from './lib/tools/insights.js';
import { registerDeliveryTools } from './lib/tools/delivery.js';
import { registerAiTools } from './lib/tools/ai.js';
import { registerWebhookTools } from './lib/tools/webhooks.js';
import { registerTokenTools } from './lib/tools/tokens.js';
import { registerLogTools } from './lib/tools/logs.js';
import { registerResources } from './lib/resources/index.js';

/**
 * Build a fully-wired MCP server with every CloudCDN tool and resource
 * registered. The caller is responsible for attaching a transport
 * (`stdio`, Streamable HTTP, SSE, …) and calling `.connect()`.
 *
 * @returns {InstanceType<typeof McpServer>} A configured MCP server.
 *
 * @example
 *   import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
 *   import { createServer } from '@cloudcdn/mcp-server/server';
 *
 *   const server = createServer();
 *   await server.connect(new StdioServerTransport());
 */
export function createServer() {
  const server = new McpServer({
    name: 'cloudcdn',
    version: '0.1.0',
  });

  registerStorageTools(server);
  registerCoreTools(server);
  registerAssetsTools(server);
  registerInsightsTools(server);
  registerDeliveryTools(server);
  registerAiTools(server);
  registerWebhookTools(server);
  registerTokenTools(server);
  registerLogTools(server);
  registerResources(server);

  return server;
}

export { z };
