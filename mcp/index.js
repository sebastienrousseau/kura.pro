#!/usr/bin/env node

/**
 * CloudCDN MCP Server — entry point.
 *
 * Connects the MCP server to stdio transport for use with
 * Claude Code, Claude Desktop, Cursor, Windsurf, and other MCP clients.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
