# CloudCDN MCP Server

MCP (Model Context Protocol) server for CloudCDN. Lets AI agents autonomously manage static assets, zones, transforms, analytics, and cache across 300+ edge locations.

## Tools (22)

| Tool | Plane | Auth | Description |
|------|-------|------|-------------|
| `storage_list` | Storage | AccessKey | List files in a directory |
| `storage_upload` | Storage | AccessKey | Upload a file (committed via Git) |
| `storage_delete` | Storage | AccessKey | Delete a file |
| `storage_batch_upload` | Storage | AccessKey | Upload up to 50 files in one atomic commit |
| `zone_list` | Core | AccountKey | List all tenant zones |
| `zone_get` | Core | AccountKey | Get zone details with all files |
| `zone_create` | Core | AccountKey | Create a new zone with standard scaffolding |
| `zone_delete` | Core | AccountKey | Delete a zone (destructive) |
| `domain_add` | Core | AccountKey | Add a custom domain to a zone |
| `rules_get` | Core | AccountKey | Read edge rules (_headers, _redirects) |
| `rules_update` | Core | AccountKey | Update edge rules via Git |
| `assets_list` | Assets | AccessKey | Browse/filter/paginate asset catalog |
| `assets_search` | Assets | AccessKey | Search assets by name/path |
| `insights_summary` | Insights | AccessKey | Analytics summary (requests, bandwidth, cache ratio) |
| `insights_top_assets` | Insights | AccessKey | Most requested assets |
| `insights_geography` | Insights | AccessKey | Request distribution by country |
| `insights_errors` | Insights | AccessKey | Error breakdown (4xx/5xx) |
| `transform_image` | Delivery | Public | Generate transformed image URL |
| `cache_purge` | Delivery | PurgeKey | Purge cache by URL, tag, or everything |
| `pipeline_ingest` | Delivery | AccountKey | Scaffold a zone from a single SVG |
| `semantic_search` | AI | Public | Natural language asset search |
| `health_check` | AI | Public | Service health and binding status |

## Resources (3)

| URI | Description |
|-----|-------------|
| `cloudcdn://manifest` | Full asset manifest (names, paths, sizes) |
| `cloudcdn://zones` | All zones with file counts and storage |
| `cloudcdn://rules` | Current edge configuration files |

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
