# MCP — agent-driven CDN management

CloudCDN ships an [MCP](https://modelcontextprotocol.io) server so AI
agents can manage the CDN without writing custom HTTP integrations.
The server exposes the full API surface as **42 typed tools** + **6
read-only resources** across 9 planes.

## Why MCP, not just an SDK

| MCP server | SDK |
|---|---|
| Drop-in for Claude Code, Claude Desktop, Cursor, Windsurf, Cline, VS Code Copilot — no per-agent integration | Per-language port, per-agent glue, no agent-discoverable schema |
| Tools self-describe — argument types, descriptions, examples — so the agent picks the right call without prompting | Agent has to be taught what's available + how to call it |
| Resources let agents *read* state (manifest, openapi, today's analytics) without naming an endpoint | Read calls require knowing the endpoint exists |
| Zero-config auth — env vars, no per-agent secret routing | Each agent re-implements auth |

You can still hit the REST API directly — the MCP server is a wrapper
over the same HTTP surface, and the [OpenAPI spec](../cdn/en/api-reference/openapi.json)
is the contract.

## Full inventory

42 tools across 9 planes — see [`mcp/README.md`](../mcp/README.md) for
the full table with auth requirements. Summary by plane:

| Plane | Tools | What |
|---|---|---|
| Storage | 4 | List / upload / delete / batch-upload (committed via Git) |
| Core | 8 | Statistics + zone CRUD + domain + edge rules |
| Assets | 3 | Catalog browse + single-asset metadata + search |
| Insights | 6 | Summary / top / geo / errors / per-asset / audit log |
| Delivery | 5 | Image transform / cache purge / signed URL / HLS playlist / pipeline ingest |
| AI | 9 | Semantic search / chat / alt-text / smart-crop / moderate / placeholders / background-remove |
| Webhooks | 3 | List / create / delete (HMAC-signed delivery, queue + DLQ) |
| Auth | 3 | List / create / revoke scoped API tokens |
| Operations | 1 | Stream or page the operational log |

## Resources

| URI | Use case |
|---|---|
| `cloudcdn://manifest` | "Show me everything in the catalog" |
| `cloudcdn://zones` | "List my tenant zones with sizes" |
| `cloudcdn://rules` | "Read the current `_headers` / `_redirects`" |
| `cloudcdn://health` | "Is the platform up? Which bindings?" |
| `cloudcdn://openapi` | "Read the API contract" (source-of-truth) |
| `cloudcdn://insights/today` | "How's traffic today?" |

## Setup

### Environment

```sh
export CLOUDCDN_ACCESS_KEY="sk_live_..."         # Storage, Assets, Insights
export CLOUDCDN_ACCOUNT_KEY="ak_live_..."        # Core, Pipeline, Webhooks, Tokens, Logs
export CLOUDCDN_PURGE_KEY="pk_live_..."          # Cache purge
export CLOUDCDN_BASE_URL="https://cloudcdn.pro"  # Or http://localhost:8788 for dev
```

### Claude Code

`~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cloudcdn": {
      "command": "node",
      "args": ["/absolute/path/to/cloudcdn.pro/mcp/index.js"],
      "env": {
        "CLOUDCDN_ACCESS_KEY":  "sk_live_...",
        "CLOUDCDN_ACCOUNT_KEY": "ak_live_..."
      }
    }
  }
}
```

### Claude Desktop

Same JSON, in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

### Cursor

Project-scoped `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cloudcdn": {
      "command": "node",
      "args": ["./mcp/index.js"],
      "env": { "CLOUDCDN_ACCESS_KEY": "sk_live_...", "CLOUDCDN_ACCOUNT_KEY": "ak_live_..." }
    }
  }
}
```

### VS Code (GitHub Copilot)

Project-scoped `.vscode/mcp.json`:

```json
{
  "servers": {
    "cloudcdn": {
      "command": "node",
      "args": ["./mcp/index.js"],
      "env": { "CLOUDCDN_ACCESS_KEY": "sk_live_...", "CLOUDCDN_ACCOUNT_KEY": "ak_live_..." }
    }
  }
}
```

## Example agent prompts

Things that work today, end-to-end, with the tools above:

- *"Create a zone called `newbrand`, upload `logo.svg` (base64 below), and confirm the homepage embed works at https://cloudcdn.pro/newbrand/v1/logos/newbrand.svg."*
  → uses `zone_create`, `storage_upload` (or `pipeline_ingest` for the full scaffold), `health_check`.
- *"Which assets in the akande zone got more than 1,000 requests yesterday? Generate alt text for any that don't have it."*
  → uses `assets_list`, `insights_top_assets`, `insights_asset`, `generate_alt_text`, `asset_metadata_get`.
- *"Purge every banner across all zones."*
  → uses `assets_search`, `cache_purge` (tag-based: `type-banner`).
- *"Mint a 24-hour signed URL for `/clients/acme/contract.pdf`, send the URL to the webhook at `https://acme.example/cdn`."*
  → uses `signed_url_generate`, `webhook_list` (find target), or direct webhook delivery.
- *"What's our cache hit ratio today vs last week?"*
  → reads `cloudcdn://insights/today`, then calls `insights_summary?range=7d`.

## Adding a new tool

Tools live in `mcp/lib/tools/<plane>.js`. Pattern:

```js
import { z } from 'zod';
import * as api from '../api-client.js';

export function registerYourPlaneTools(server) {
  server.tool(
    'your_tool_name',
    'One-line description — what the tool does. Then a longer description with edge cases, auth requirements, and example shapes. Agents read this verbatim to decide whether to call.',
    {
      param: z.string().min(1).describe('What this is, in one line.'),
      limit: z.number().int().min(1).max(100).default(20).optional(),
    },
    async ({ param, limit }) => {
      const res = await api.get('/api/your-endpoint', { auth: 'access', params: { param, limit } });
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
```

Then:

1. Add the new file to the registrations list in `mcp/server.js` if
   it's a new plane.
2. Add the tool name to `expectedTools` in `mcp/tests/server.test.js`
   and bump the `length` assertion.
3. Add a row to the table in `mcp/README.md` and the by-plane summary
   in `mcp/server.js`'s header comment.
4. `cd mcp && npm test` — assert the count and registration are
   green.

## Testing the MCP

```sh
cd mcp
npm test
```

91 unit tests cover:
- The server constructs without error
- Every expected tool name is registered
- Every expected resource URI is registered
- The HTTP client handles `auth: 'access' | 'account' | 'purge'` correctly
- Error responses bubble up as structured tool-results, not thrown errors

Integration with a real MCP client (Claude Code) is verified
manually; the MCP SDK doesn't expose enough internals for full
client-side mocking yet.
