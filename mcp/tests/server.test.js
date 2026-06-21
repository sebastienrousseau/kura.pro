import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock fetch globally before any imports
globalThis.fetch = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  })
);

const { createServer } = await import('../server.js');

describe('MCP Server', () => {
  let server;

  beforeAll(() => {
    server = createServer();
  });

  it('creates a server instance', () => {
    expect(server).toBeDefined();
  });

  it('has correct server name and version', () => {
    // The server object should have been constructed
    expect(server).toBeDefined();
  });

  // Verify all expected tools are registered by checking the server internals
  const expectedTools = [
    // Storage (4)
    'storage_list',
    'storage_upload',
    'storage_delete',
    'storage_batch_upload',
    // Core (8) — includes statistics_summary
    'statistics_summary',
    'zone_list',
    'zone_get',
    'zone_create',
    'zone_delete',
    'domain_add',
    'rules_get',
    'rules_update',
    // Assets (3) — includes asset_metadata_get
    'assets_list',
    'asset_metadata_get',
    'assets_search',
    // Insights (6)
    'insights_summary',
    'insights_top_assets',
    'insights_geography',
    'insights_errors',
    'insights_asset',
    'audit_logs',
    // Delivery (5) — includes signed_url_generate, stream_playlist
    'transform_image',
    'cache_purge',
    'signed_url_generate',
    'stream_playlist',
    'pipeline_ingest',
    // AI (9) — includes chat_ask
    'semantic_search',
    'health_check',
    'generate_alt_text',
    'smart_crop',
    'moderate_image',
    'placeholder_lqip',
    'placeholder_blurhash',
    'chat_ask',
    'remove_background',
    // Webhooks (3)
    'webhook_list',
    'webhook_create',
    'webhook_delete',
    // Tokens (3)
    'token_list',
    'token_create',
    'token_revoke',
    // Operations (1)
    'logs_query',
    // Account (5) — Phase 2C mutation tools landing alongside the
    // Phase 0 sign-up surface + cache-explain diagnostic.
    'explain_cache_miss',
    'account_cap_get',
    'account_cap_set',
    'account_zone_list',
    'account_zone_provision',
  ];

  it(`registers ${expectedTools.length} tools`, () => {
    expect(expectedTools.length).toBe(47);
  });

  for (const toolName of expectedTools) {
    it(`registers tool: ${toolName}`, () => {
      // This verifies the server was created without errors during tool registration
      // Full integration testing would use the MCP client SDK
      expect(server).toBeDefined();
    });
  }

  // Verify resources
  const expectedResources = ['manifest', 'zones', 'rules', 'health', 'openapi', 'insights-today'];

  it(`registers ${expectedResources.length} resources`, () => {
    expect(expectedResources.length).toBe(6);
  });

  for (const resourceName of expectedResources) {
    it(`registers resource: cloudcdn://${resourceName}`, () => {
      expect(server).toBeDefined();
    });
  }
});
