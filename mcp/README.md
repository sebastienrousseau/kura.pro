<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->

<p align="center">
  <img src="https://cloudcdn.pro/cloudcdn/v1/logos/cloudcdn.svg" alt="CloudCDN logo" width="128" />
</p>

<h1 align="center">@cloudcdn/mcp-server</h1>

<p align="center">
  Model Context Protocol server for <a href="https://cloudcdn.pro">CloudCDN</a> —
  lets AI agents autonomously manage static assets, zones, transforms,
  analytics, and cache across 300+ edge locations.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cloudcdn/mcp-server"><img src="https://img.shields.io/npm/v/@cloudcdn/mcp-server?style=for-the-badge&logo=npm" alt="npm" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%E2%89%A518-339933?style=for-the-badge&logo=node.js" alt="Node >= 18" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-1.12%2B-6366f1?style=for-the-badge" alt="MCP SDK" /></a>
  <a href="#testing"><img src="https://img.shields.io/badge/coverage-100%25-15803d?style=for-the-badge" alt="Coverage" /></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue?style=for-the-badge" alt="License" /></a>
</p>

---

## Contents

- [Install](#install) — npm, npx, from source
- [Quick Start](#quick-start) — wire it into Claude Desktop in 30 seconds
- [Programmatic usage](#programmatic-usage) — embed the server in your own host
- [Tools (42)](#tools-42) — every callable, grouped by API plane
- [Resources (6)](#resources-6) — read-only context exposed to the agent
- [Configuration](#configuration) — environment variables
- [Host configs](#host-configs) — Claude Code, Claude Desktop, Cursor, VS Code, Windsurf
- [Examples](#examples) — runnable scripts under `examples/`
- [Local development](#local-development)
- [Testing](#testing)
- [License](#license)

---

## Install

```bash
# Run directly (no install — recommended for MCP hosts)
npx @cloudcdn/mcp-server

# Or install globally to get a `cloudcdn-mcp` binary on $PATH
npm install -g @cloudcdn/mcp-server

# Or as a project dependency
npm install @cloudcdn/mcp-server
# yarn add @cloudcdn/mcp-server
# pnpm add @cloudcdn/mcp-server
```

**Minimum runtime:** Node.js >= 18 (ESM-only).

---

## Quick Start

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "cloudcdn": {
      "command": "npx",
      "args": ["-y", "@cloudcdn/mcp-server"],
      "env": {
        "CLOUDCDN_ACCESS_KEY": "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```

Restart Claude Desktop. The agent now has 42 tools and 6 read-only resources for driving your CloudCDN tenant. The server identifies itself to the host as `cloudcdn`.

---

## Programmatic usage

Embed the server in your own host — custom transport, hosted MCP gateway, integration tests:

```js
// host.mjs
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '@cloudcdn/mcp-server/server';

// 1. Build the server with all 42 tools and 6 resources registered.
const server = createServer();

// 2. Attach a transport. Stdio is the default for desktop MCP hosts;
//    swap in a Streamable HTTP or SSE transport for a hosted gateway.
const transport = new StdioServerTransport();
await server.connect(transport);

// 3. Tool handlers read CLOUDCDN_ACCESS_KEY / CLOUDCDN_ACCOUNT_KEY /
//    CLOUDCDN_PURGE_KEY from process.env, so set those before connect().
```

The thin HTTP client is also exported if you want to talk to the CloudCDN
REST API directly from outside an MCP context:

```js
import { get, post } from '@cloudcdn/mcp-server/api-client';

// AccessKey-gated read.
const { ok, data } = await get('/api/assets', {
  auth: 'access',
  params: { project: 'akande', format: 'svg', per_page: 20 },
});

if (ok) console.log(`Found ${data.results.length} assets`);
```

---

## Tools (42)

| Tool | Plane | Auth | Description |
|---|---|---|---|
| `storage_list` | Storage | AccessKey | List files at a directory path |
| `storage_upload` | Storage | AccessKey | Upload a file (committed via Git, deployed in ~60–90 s) |
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
| `audit_logs` | Insights | AccountKey | 90-day immutable audit log of every control-plane mutation |
| `transform_image` | Delivery | Public | Generate a transformed image URL (resize / format / blur / sharpen) |
| `cache_purge` | Delivery | PurgeKey | Purge cache by URL, surrogate tag, or everything |
| `signed_url_generate` | Delivery | AccountKey | Mint a time-limited HMAC-signed URL for protected assets |
| `stream_playlist` | Delivery | Public | Build an HLS `.m3u8` playlist URL for adaptive-bitrate video |
| `pipeline_ingest` | Delivery | AccountKey | Scaffold a zone from a single SVG |
| `semantic_search` | AI | Public | Natural-language asset search (Vectorize + fuzzy fallback) |
| `health_check` | AI | Public | Service health + binding status |
| `generate_alt_text` | AI | Public | AI-generated accessibility alt text for an image |
| `smart_crop` | AI | Public | Subject-aware crop `gravity` value for transform |
| `moderate_image` | AI | Public | Content safety classifier across 5 categories |
| `placeholder_lqip` | AI | Public | Low-quality image placeholder (data-URI) |
| `placeholder_blurhash` | AI | Public | BlurHash + data-URI pair for hash-deduped caching |
| `chat_ask` | AI | Public | RAG concierge — degrades to curated FAQ on AI quota |
| `remove_background` | AI | Public | Background removal (HTTP 501 until a matting model lands) |
| `webhook_list` | Webhooks | AccountKey | List registered webhooks |
| `webhook_create` | Webhooks | AccountKey | Subscribe an HTTPS URL to event types (HMAC-signed delivery) |
| `webhook_delete` | Webhooks | AccountKey | Revoke a webhook |
| `token_list` | Auth | AccountKey | List API tokens (redacted) |
| `token_create` | Auth | AccountKey | Mint a scoped API token |
| `token_revoke` | Auth | AccountKey | Revoke an API token by ID |
| `logs_query` | Operations | AccountKey | Stream or page operational logs |

---

## Resources (6)

| URI | Description |
|---|---|
| `cloudcdn://manifest` | Full asset manifest (names, paths, projects, sizes) |
| `cloudcdn://zones` | All zones with file counts and storage usage |
| `cloudcdn://rules` | Current `_headers` and `_redirects` edge configuration |
| `cloudcdn://health` | Live health snapshot — binding state + per-binding latency |
| `cloudcdn://openapi` | Full OpenAPI 3.1 spec — every path, schema, example |
| `cloudcdn://insights/today` | Today's analytics summary (requests, bandwidth, cache hit ratio) |

---

## Configuration

All settings are environment variables read at startup; tool handlers fail
with a structured MCP error if a key required for the call is unset.

| Variable | Required for | Description |
|---|---|---|
| `CLOUDCDN_ACCESS_KEY` | Storage, Assets, Insights | Tenant read/write key (`sk_live_…`) |
| `CLOUDCDN_ACCOUNT_KEY` | Core, Pipeline, Webhooks, Tokens, Logs, Audit | Account-admin key (`ak_live_…`) |
| `CLOUDCDN_PURGE_KEY` | `cache_purge` | Cache-purge key (`pk_live_…`) |
| `CLOUDCDN_ANALYTICS_KEY` | Analytics endpoints | Optional analytics key |
| `CLOUDCDN_BASE_URL` | All | Defaults to `https://cloudcdn.pro`. Point at `http://localhost:8788` for local Wrangler dev. |

---

## Host configs

<details>
<summary><strong>Claude Code</strong> — <code>~/.claude/settings.json</code></summary>

```json
{
  "mcpServers": {
    "cloudcdn": {
      "command": "npx",
      "args": ["-y", "@cloudcdn/mcp-server"],
      "env": {
        "CLOUDCDN_ACCESS_KEY": "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor</strong> — <code>.cursor/mcp.json</code> in your project root</summary>

```json
{
  "mcpServers": {
    "cloudcdn": {
      "command": "npx",
      "args": ["-y", "@cloudcdn/mcp-server"],
      "env": {
        "CLOUDCDN_ACCESS_KEY": "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```
</details>

<details>
<summary><strong>VS Code (GitHub Copilot Chat)</strong> — <code>.vscode/mcp.json</code></summary>

```json
{
  "servers": {
    "cloudcdn": {
      "command": "npx",
      "args": ["-y", "@cloudcdn/mcp-server"],
      "env": {
        "CLOUDCDN_ACCESS_KEY": "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```
</details>

---

## Examples

Runnable scripts live under [`examples/`](./examples/). Set the env vars
first, then `node examples/<name>.mjs`:

| Script | What it does |
|---|---|
| [`quickstart-stdio.mjs`](./examples/quickstart-stdio.mjs) | Boots the server on stdio — the same code path `npx` uses |
| [`programmatic-embed.mjs`](./examples/programmatic-embed.mjs) | Builds a `createServer()` instance with a custom transport |
| [`semantic-search.mjs`](./examples/semantic-search.mjs) | Calls the underlying `/api/search` endpoint via the API client |
| [`cache-purge.mjs`](./examples/cache-purge.mjs) | Purges a URL via `/api/purge` (requires `CLOUDCDN_PURGE_KEY`) |
| [`transform-image.mjs`](./examples/transform-image.mjs) | Builds a width-400 WebP transform URL |

---

## Local development

```bash
git clone https://github.com/sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro/mcp
npm ci

# Point the server at a local Wrangler dev instance of the CloudCDN API.
export CLOUDCDN_BASE_URL="http://localhost:8788"
export CLOUDCDN_ACCESS_KEY="sk_test_local"
export CLOUDCDN_ACCOUNT_KEY="ak_test_local"

node index.js
```

---

## Testing

```bash
npm test              # vitest run — all unit + regression tests
npm run test:watch    # interactive
npm run test:coverage # v8 coverage report, 100% gate
```

Coverage thresholds are pinned at **100% statements / branches / functions / lines**
in `vitest.config.js`. CI fails on any drop.

---

## License

Dual-licensed under [MIT](../LICENSE) and [Apache-2.0](http://www.apache.org/licenses/LICENSE-2.0), at your option.
