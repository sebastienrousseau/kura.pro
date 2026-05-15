# CloudCDN MCP Server

MCP (Model Context Protocol) server for CloudCDN. Lets AI agents autonomously manage static assets, zones, transforms, analytics, and cache across 300+ edge locations.

## Tools (42)

| Tool | Plane | Auth | Description |
|------|-------|------|-------------|
| `storage_list` | Storage | AccessKey | List files at a directory path |
| `storage_upload` | Storage | AccessKey | Upload a file (committed via Git, deployed in ~60-90s) |
| `storage_delete` | Storage | AccessKey | Delete a file |
| `storage_batch_upload` | Storage | AccessKey | Upload up to 50 files in one atomic commit |
| `statistics_summary` | Core | AccountKey | Control-plane summary (zones, files, storage, last sync) |
| `zone_list` | Core | AccountKey | List all tenant zones |
| `zone_get` | Core | AccountKey | Get zone details with all files |
| `zone_create` | Core | AccountKey | Create a new zone with standard scaffolding |
| `zone_delete` | Core | AccountKey | Delete a zone (destructive) |
| `domain_add` | Core | AccountKey | Add a custom domain to a zone |
| `rules_get` | Core | AccountKey | Read edge rules (`_headers`, `_redirects`) |
| `rules_update` | Core | AccountKey | Update edge rules via Git |
| `assets_list` | Assets | AccessKey | Browse / filter / paginate the asset catalog |
| `asset_metadata_get` | Assets | AccessKey | Full metadata for a single asset (incl. AI-derived fields) |
| `assets_search` | Assets | AccessKey | Search assets by name / path |
| `insights_summary` | Insights | AccessKey | Analytics summary (requests, bandwidth, cache ratio) |
| `insights_top_assets` | Insights | AccessKey | Most-requested assets |
| `insights_geography` | Insights | AccessKey | Request distribution by country |
| `insights_errors` | Insights | AccessKey | Error breakdown (4xx / 5xx) |
| `insights_asset` | Insights | AccessKey | Per-asset daily request + error roll-ups |
| `audit_logs` | Insights | AccessKey | 90-day immutable audit log of every control-plane mutation |
| `transform_image` | Delivery | Public | Generate a transformed image URL (resize / format / blur / sharpen) |
| `cache_purge` | Delivery | PurgeKey | Purge cache by URL, surrogate tag, or everything |
| `signed_url_generate` | Delivery | AccountKey | Mint a time-limited HMAC-signed URL for protected assets |
| `stream_playlist` | Delivery | Public | Build an HLS `.m3u8` playlist URL for an adaptive-bitrate video |
| `pipeline_ingest` | Delivery | AccountKey | Scaffold a zone from a single SVG |
| `semantic_search` | AI | Public | Natural-language asset search (Vectorize + fuzzy fallback) |
| `health_check` | AI | Public | Service health + binding status |
| `generate_alt_text` | AI | Public | AI-generated accessibility alt text for an image |
| `smart_crop` | AI | Public | Subject-aware crop `gravity` value for transform |
| `moderate_image` | AI | Public | Content safety classifier across 5 categories |
| `placeholder_lqip` | AI | Public | Low-quality image placeholder (data-URI) |
| `placeholder_blurhash` | AI | Public | BlurHash + data-URI pair for hash-deduped caching |
| `chat_ask` | AI | Public | RAG concierge — ask the platform anything; degrades to curated FAQ |
| `remove_background` | AI | Public | Background removal (HTTP 501 until Workers AI ships a matting model) |
| `webhook_list` | Webhooks | AccountKey | List registered webhooks |
| `webhook_create` | Webhooks | AccountKey | Subscribe an HTTPS URL to event types (HMAC-signed delivery) |
| `webhook_delete` | Webhooks | AccountKey | Revoke a webhook |
| `token_list` | Auth | AccountKey | List API tokens (redacted) |
| `token_create` | Auth | AccountKey | Mint a scoped API token |
| `token_revoke` | Auth | AccountKey | Revoke an API token by ID |
| `logs_query` | Operations | AccountKey | Stream or page operational logs |

## Resources (6)

| URI | Description |
|-----|-------------|
| `cloudcdn://manifest` | Full asset manifest (names, paths, projects, sizes) |
| `cloudcdn://zones` | All zones with file counts and storage usage |
| `cloudcdn://rules` | Current `_headers` and `_redirects` edge configuration |
| `cloudcdn://health` | Live health snapshot — binding state + per-binding latency |
| `cloudcdn://openapi` | Full OpenAPI 3.1 spec — every path, schema, example |
| `cloudcdn://insights/today` | Today's analytics summary — requests, bandwidth, cache hit ratio |

## Setup

### Environment Variables

```sh
export CLOUDCDN_ACCESS_KEY="sk_live_..."    # Storage, Assets, Insights
export CLOUDCDN_ACCOUNT_KEY="ak_live_..."   # Core, Pipeline
export CLOUDCDN_PURGE_KEY="pk_live_..."     # Cache purge
export CLOUDCDN_BASE_URL="https://cloudcdn.pro"  # Optional, defaults to production
```

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cloudcdn": {
      "command": "node",
      "args": ["/path/to/cloudcdn.pro/mcp/index.js"],
      "env": {
        "CLOUDCDN_ACCESS_KEY": "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cloudcdn": {
      "command": "node",
      "args": ["/path/to/cloudcdn.pro/mcp/index.js"],
      "env": {
        "CLOUDCDN_ACCESS_KEY": "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "cloudcdn": {
      "command": "node",
      "args": ["./mcp/index.js"],
      "env": {
        "CLOUDCDN_ACCESS_KEY": "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "cloudcdn": {
      "command": "node",
      "args": ["./mcp/index.js"],
      "env": {
        "CLOUDCDN_ACCESS_KEY": "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```

## Local Development

Run against a local Wrangler dev server:

```sh
export CLOUDCDN_BASE_URL="http://localhost:8788"
node mcp/index.js
```

## Testing

```sh
cd mcp
npm test
```
