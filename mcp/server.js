/**
 * CloudCDN MCP Server definition.
 *
 * Registers 20 tools across 6 API planes + 3 read-only resources.
 * Each tool maps to a CloudCDN API endpoint via the HTTP client.
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
