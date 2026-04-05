#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const specPath = path.join(process.cwd(), 'website', 'api-reference', 'openapi.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

spec['x-tagGroups'] = [
  {
    name: 'Data Plane',
    tags: ['Storage', 'Assets'],
  },
  {
    name: 'Control Plane',
    tags: ['Core', 'Insights'],
  },
  {
    name: 'Edge Services',
    tags: ['Delivery', 'AI'],
  },
];

spec.tags = [
  {
    name: 'Storage',
    description: `## Storage API

Upload, download, and manage files across your CDN. The Storage API is the write layer — every file mutation flows through here.

### How it works

1. **Upload** a file with \`PUT /api/storage/{path}\` — committed to the repository via the GitHub Git API
2. **The CI/CD pipeline** deploys it to 300+ edge locations (~60-90 seconds)
3. **Download** it instantly via \`GET /api/storage/{path}\` or the public CDN URL

### Quick start

\`\`\`bash
# Upload an SVG logo
curl -X PUT -H "AccessKey: YOUR_KEY" \\
  -H "Content-Type: image/svg+xml" \\
  -T ./logo.svg \\
  https://cloudcdn.pro/api/storage/clients/myproject/v1/logos/logo.svg

# List a directory
curl -H "AccessKey: YOUR_KEY" \\
  https://cloudcdn.pro/api/storage/clients/myproject/v1/logos/

# Batch upload (single atomic commit)
curl -X POST -H "AccessKey: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "files": [{ "path": "clients/myproject/v1/logos/logo.svg", "content": "PHN2Zy4uLg==", "encoding": "base64" }] }' \\
  https://cloudcdn.pro/api/storage/batch
\`\`\`

### Authentication

All Storage endpoints require an **AccessKey** header. This key grants read/write access to files but cannot modify zones or edge configuration.

### Limits

| Limit | Value |
|-------|-------|
| Max file size | 25 MB |
| Max batch size | 50 files |
| Checksum verification | SHA-256 (optional) |
| Edge sync | ~60-90 seconds after commit |`,
  },
  {
    name: 'Assets',
    description: `## Assets API

Browse and search your entire asset catalog. The Assets API is the read-only layer — it queries the auto-generated manifest for instant, filterable access to every file on your CDN.

### How it works

Every time a file changes, the manifest regenerates automatically. The Assets API reads this manifest (cached 30 seconds at the edge) and provides:

- **Paginated listing** — filter by project, category, format
- **Full-text search** — across filenames and paths
- **Per-asset metadata** — size, content type, CDN URL, available formats

### Quick start

\`\`\`bash
# List all SVG assets sorted by size
curl -H "AccessKey: YOUR_KEY" \\
  'https://cloudcdn.pro/api/assets?format=svg&sort=size&order=desc'

# Search for banking logos
curl -H "AccessKey: YOUR_KEY" \\
  'https://cloudcdn.pro/api/assets?q=banking+logo'

# Get metadata for a specific asset
curl -H "AccessKey: YOUR_KEY" \\
  'https://cloudcdn.pro/api/assets/metadata?path=akande/v1/logos/akande.svg'
\`\`\`

### Pagination

Results paginate with \`page\` and \`per_page\` (max 200). The response includes \`Pagination.TotalItems\`, \`Pagination.TotalPages\`, and the current page.`,
  },
  {
    name: 'Core',
    description: `## Core API

Manage your CDN infrastructure — zones, domains, edge rules, and statistics. The Core API is the control plane for platform administrators.

### Zones

A **zone** is a tenant namespace (e.g., \`akande\`, \`bankingonai\`). Each zone maps to a directory with a standardized structure:

\`\`\`
clients/{zone}/v1/
  banners/    — Hero images and promotional banners
  github/     — Social card images for GitHub
  icons/      — PWA icons (180, 192, 512)
  logos/       — Brand logos (SVG source)
  titles/      — Title card images
\`\`\`

### Quick start

\`\`\`bash
# Create a new zone
curl -X POST -H "AccountKey: YOUR_KEY" \\
  -d '{ "Name": "newclient" }' \\
  https://cloudcdn.pro/api/core/zones

# Add a custom domain
curl -X POST -H "AccountKey: YOUR_KEY" \\
  -d '{ "Hostname": "cdn.newclient.com" }' \\
  https://cloudcdn.pro/api/core/zones/newclient/domains

# Update edge caching rules
curl -X POST -H "AccountKey: YOUR_KEY" \\
  -d '{ "File": "_headers", "Content": "/*.webp\\n  Cache-Control: public, max-age=86400" }' \\
  https://cloudcdn.pro/api/core/rules
\`\`\`

### Authentication

All Core endpoints require an **AccountKey** header. This is the admin key — it can create/delete zones, manage domains, and modify edge rules. Never share it with CI/CD bots.

### Reserved zone names

These names cannot be used: \`stocks\`, \`shared\`, \`website\`, \`functions\`, \`api\`, \`dashboard\`, \`dist\`, \`content\`, \`global\`, \`clients\`.`,
  },
  {
    name: 'Insights',
    description: `## Insights API

Monitor your CDN performance in real time. The Insights API provides analytics data collected by the edge middleware on every asset request.

### What is tracked

| Metric | Description |
|--------|-------------|
| **Requests** | Total hits per day |
| **Bandwidth** | Estimated bytes served |
| **Cache ratio** | Edge hits vs origin misses |
| **Geography** | Requests by country code |
| **Top assets** | Most requested files |
| **Errors** | 4xx/5xx breakdown with paths |

### Quick start

\`\`\`bash
# 7-day summary
curl -H "AccountKey: YOUR_KEY" \\
  https://cloudcdn.pro/api/insights/summary?days=7

# Top 20 assets this month
curl -H "AccountKey: YOUR_KEY" \\
  https://cloudcdn.pro/api/insights/top-assets?days=30&limit=20

# Geographic distribution
curl -H "AccountKey: YOUR_KEY" \\
  https://cloudcdn.pro/api/insights/geography?days=7

# Error tracking
curl -H "AccountKey: YOUR_KEY" \\
  https://cloudcdn.pro/api/insights/errors?days=7
\`\`\`

### Per-zone filtering

Add \`?zone=akande\` to any endpoint to filter analytics for a specific tenant.

### Authentication

Insights accept either **AccountKey** or **AccessKey** — read-only and safe for dashboards.`,
  },
  {
    name: 'Delivery',
    description: `## Delivery API

Transform, optimize, and deliver assets at the edge. These endpoints run on Cloudflare's global network — results are cached at 300+ locations worldwide.

### Image Transformation

Resize, convert, blur, and sharpen any image on the fly:

\`\`\`
https://cloudcdn.pro/api/transform?url=/akande/v1/logos/akande.svg&w=400&format=webp&q=85
\`\`\`

| Parameter | Range | Description |
|-----------|-------|-------------|
| \`w\` | 1–8192 | Width in pixels |
| \`h\` | 1–8192 | Height in pixels |
| \`fit\` | cover, contain, fill | Resize behavior |
| \`format\` | webp, avif, png, jpeg, auto | Output format |
| \`q\` | 1–100 | Quality (lower = smaller file) |
| \`blur\` | 1–250 | Gaussian blur radius |
| \`sharpen\` | 1–10 | Sharpening amount |
| \`gravity\` | center, face, auto | Crop focus point |

### Automatic Format Negotiation

Request any image without a format — the edge reads the browser's \`Accept\` header and serves the optimal format (AVIF > WebP > PNG):

\`\`\`
https://cloudcdn.pro/api/auto?path=/akande/v1/logos/akande
\`\`\`

### Signed URLs

Protect premium assets with time-limited, HMAC-signed URLs that expire automatically.

### Video Streaming (HLS)

Adaptive bitrate video via HTTP Live Streaming playlists.

### Cache Purge

Instantly invalidate assets by URL, surrogate tag, or purge everything.

### No authentication required

All Delivery endpoints are public — they are the URLs your end users hit directly. Rate limits prevent abuse (50,000 transforms/month, 100 purges/day).`,
  },
  {
    name: 'AI',
    description: `## AI Services

Search and explore your asset catalog using natural language. Powered by Cloudflare Workers AI and Vectorize.

### Semantic Search

Find assets by description, not filename:

\`\`\`bash
# Find dark banking backgrounds
curl 'https://cloudcdn.pro/api/search?q=dark+blue+banking+background'

# Find minimalist logos
curl 'https://cloudcdn.pro/api/search?q=minimalist+logo+svg'
\`\`\`

The engine uses a hybrid approach: vector similarity (Vectorize embeddings) with fuzzy text fallback. Results are scored and ranked by relevance.

### AI Concierge

An intelligent chat assistant that knows your entire CDN — pricing, setup, performance, compliance, and troubleshooting. Powered by RAG over the knowledge base.

\`\`\`bash
curl -X POST -H "Content-Type: application/json" \\
  -d '{ "message": "How do I set up custom domains?", "history": [] }' \\
  https://cloudcdn.pro/api/chat
\`\`\`

### No authentication required

AI endpoints are public. Rate limits: 1,000 chat queries/month, 100 search requests/minute.`,
  },
];

fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
console.log('Updated', spec.tags.length, 'tags and', spec['x-tagGroups'].length, 'tag groups');
