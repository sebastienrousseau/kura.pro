# CloudCDN

High-performance static asset delivery powered by Cloudflare's global edge network. Sub-100ms latency across 300+ PoPs.

## Features

- **Edge-optimized delivery** — Static assets served from Cloudflare's 300+ data centers
- **Image Transformation API** — On-the-fly resize, format conversion, blur, and sharpen via `/api/transform`
- **AI Concierge** — RAG-powered chat assistant using Workers AI + Vectorize
- **Asset Dashboard** — Browse and search all CDN assets with filtering
- **Automated CI/CD** — Image compression, manifest generation, and knowledge sync via GitHub Actions

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm i -g wrangler`)
- Cloudflare account with Workers AI and Vectorize enabled

## Local Development

```bash
wrangler pages dev .
```

Runs at `http://localhost:8788`. Pages Functions in `functions/` are served automatically.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | For scripts |
| `CLOUDFLARE_API_TOKEN` | API token with Workers AI + Vectorize permissions | For scripts |

Pages Functions bindings (configured in `wrangler.toml` or dashboard):

| Binding | Type | Description |
|---------|------|-------------|
| `AI` | Workers AI | LLM inference and embeddings |
| `VECTOR_INDEX` | Vectorize | Knowledge base vector index |
| `RATE_KV` | KV Namespace | Rate limiting counters |

## Scripts

Run from the `scripts/` directory:

| Script | Usage | Description |
|--------|-------|-------------|
| `convert.mjs` | `node convert.mjs <dir>` | Convert images to WebP/AVIF |
| `generate-manifest.mjs` | `node generate-manifest.mjs` | Generate `manifest.json` for the dashboard |
| `sync-knowledge.mjs` | `node sync-knowledge.mjs [content-dir]` | Chunk markdown docs and sync to Vectorize |

## Testing

```bash
npm ci            # install root deps (vitest)
cd scripts && npm ci  # install script deps (sharp)
cd ..
npm test          # single run
npm run test:watch  # watch mode
npm run test:coverage  # with 100% coverage enforcement
```

## Directory Structure

```
.
├── functions/
│   └── api/
│       ├── chat.js          # AI Concierge SSE endpoint
│       └── transform.js     # Image Transformation API
├── dashboard/
│   ├── index.html           # Asset manager UI
│   ├── app.js               # Dashboard logic
│   └── styles.css            # Dashboard styles
├── scripts/
│   ├── convert.mjs          # Image conversion
│   ├── generate-manifest.mjs # Manifest builder
│   ├── sync-knowledge.mjs   # Knowledge base sync
│   └── tests/               # Vitest test suite
├── content/                  # Markdown knowledge base docs
├── kura/                     # Static assets (images, icons)
├── index.html                # Landing page
├── 404.html                  # Custom 404 page
├── robots.txt                # Crawler directives
├── sitemap.xml               # Search engine sitemap
├── _headers                  # Cloudflare Pages headers
├── _redirects                # Cloudflare Pages redirects
└── .github/workflows/        # CI/CD pipelines
```

## Deployment

Pushes to `main` trigger automatic deployment via Cloudflare Pages. GitHub Actions run image compression, manifest generation, and knowledge sync as needed.
