#!/usr/bin/env node
/**
 * programmatic-embed.mjs — embed the server in your own host.
 *
 * Build the configured `McpServer` instance with `createServer()`, then
 * attach whichever transport you need: stdio for desktop hosts,
 * Streamable HTTP for hosted MCP gateways, or an in-memory transport for
 * integration tests.
 *
 * The transport-agnostic pattern is the recommended one for anything
 * beyond a plain CLI launch.
 *
 * Usage:
 *   export CLOUDCDN_ACCESS_KEY=sk_live_...
 *   export CLOUDCDN_ACCOUNT_KEY=ak_live_...
 *   node examples/programmatic-embed.mjs
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../server.js';

// 1. Build the configured server. All 42 tools and 6 resources are
//    already registered when this returns.
const server = createServer();
console.error('[cloudcdn-mcp] server constructed: 42 tools + 6 resources');

// 2. Attach a transport. Swap this for any MCP SDK transport — the
//    server doesn't care which side of the wire it's on.
const transport = new StdioServerTransport();

// 3. Connect. Errors here surface either as protocol-level errors
//    (returned to the host) or as a thrown rejection (process exits).
try {
  await server.connect(transport);
  console.error('[cloudcdn-mcp] connected, awaiting MCP messages on stdio');
} catch (err) {
  console.error('[cloudcdn-mcp] failed to connect:', err);
  process.exitCode = 1;
}
