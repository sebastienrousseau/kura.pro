#!/usr/bin/env node
/**
 * quickstart-stdio.mjs — boot the MCP server on stdio.
 *
 * This is the exact code path `npx @cloudcdn/mcp-server` runs. An MCP
 * host (Claude Desktop / Cursor / Windsurf / VS Code Copilot) spawns the
 * process and speaks the MCP protocol over the child's stdin / stdout.
 *
 * Usage:
 *   export CLOUDCDN_ACCESS_KEY=sk_live_...
 *   export CLOUDCDN_ACCOUNT_KEY=ak_live_...
 *   node examples/quickstart-stdio.mjs
 *
 * In a real config you wouldn't invoke this directly; instead point the
 * host's MCP config at `npx -y @cloudcdn/mcp-server`.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../server.js';

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);

// Server runs until the host closes stdin. Tool handlers read auth keys
// from process.env lazily, so any env change between connect and the
// first tool call would also be picked up — but that's an anti-pattern;
// set them once at boot.
