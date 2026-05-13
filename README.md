<p align="center">
  <img src="https://cloudcdn.pro/cloudcdn/v1/logos/cloudcdn.svg" alt="CloudCDN logo" width="128" />
</p>

<h1 align="center">CloudCDN</h1>

<p align="center">
  <strong>Enterprise-grade static asset delivery on Cloudflare's global edge network. Sub-100ms TTFB across 300+ PoPs.</strong>
</p>

<p align="center">
  <a href="https://github.com/sebastienrousseau/cloudcdn.pro/actions"><img src="https://img.shields.io/github/actions/workflow/status/sebastienrousseau/cloudcdn.pro/deploy.yml?style=for-the-badge&logo=github" alt="Build" /></a>
  <a href="https://cloudcdn.pro"><img src="https://img.shields.io/badge/edge-300%2B%20PoPs-6366f1?style=for-the-badge&logo=cloudflare" alt="Edge" /></a>
  <a href="https://cloudcdn.pro/api-reference"><img src="https://img.shields.io/badge/api-OpenAPI%203.1-34d399?style=for-the-badge&logo=openapiinitiative" alt="API" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License" /></a>
</p>

---

## Overview

CloudCDN is a multi-tenant CDN platform built entirely on Cloudflare Workers, Pages, KV, Vectorize, and Workers AI. A single SVG upload scaffolds a complete project directory. Every image is optimized, cached at the edge, and served in under 100ms globally.

- **54 tenant zones** with isolated `v1/` directory structures
- **1,400+ optimized assets** — single source per image, derivatives on demand
- **12 edge API endpoints** across 6 planes (Storage, Core, Assets, Insights, Delivery, AI)
- **2,140+ tests** with 100% statement/branch/function/line coverage
- **Quota-resilient AI** — response cache, neuron budget, circuit breaker, and curated FAQ fallback keep `/api/search` and `/api/chat` answering when Workers AI is exhausted
- **Signed commits** enforced end-to-end — from developer machine to edge deployment

## Architecture

```mermaid
graph TD
    A[Developer] -->|signed commit| B{GitHub}
    B -->|CI/CD| C[Cloudflare Pages]
    C --> D[Edge Middleware]
    D --> E[clients/]
    D --> F[stocks/]
    D --> G[cdn/]
    D --> H[Edge Functions]
    H --> I[Storage API]
    H --> J[Core API]
    H --> K[Assets API]
    H --> L[Insights API]
    H --> M[Delivery API]
    H --> N[AI Services]
```

```
/
├── clients/          54 tenant asset directories
├── stocks/           Global stock media (images, diagrams, videos)
├── cdn/              Application layer (localized pages, dashboard, docs)
│   ├── en/           English homepage (canonical)
│   ├── fr/, de/...   27 more localized homepages
│   ├── dashboard/    Asset dashboard UI
│   ├── api-reference/ OpenAPI docs
│   └── content/      Markdown knowledge base
├── scripts/          Build scripts, i18n, tests (not deployed as content)
├── functions/        Cloudflare edge functions (middleware + 12 APIs)
├── manifest.json     Auto-generated asset registry
└── wrangler.toml     Cloudflare bindings (AI, Vectorize, KV)
```

## Features

| | |
| :--- | :--- |
| **Edge Delivery** | Static assets served from 300+ Cloudflare data centers with immutable 1-year cache headers and automatic CORS. |
| **Image Transforms** | On-the-fly resize, format conversion, blur, and sharpen via `/api/transform`. Supports WebP, AVIF, PNG, JPEG. |
| **Format Negotiation** | `/api/auto` reads the browser `Accept` header and serves the optimal format (AVIF > WebP > PNG) automatically. |
| **Signed URLs** | HMAC-SHA256 time-limited URLs for protected assets with constant-time signature verification. |
| **HLS Streaming** | Adaptive bitrate video delivery via HTTP Live Streaming playlists and byte-range segmentation. |
| **Semantic Search** | Natural language asset search powered by Workers AI embeddings and Vectorize vector similarity. Day-bucketed edge cache, neuron budget, and fuzzy fallback keep results flowing when AI quota is exhausted — responses are annotated with `mode: vector \| fuzzy \| cached`. |
| **AI Concierge** | RAG-powered chat assistant with SSE streaming, confidence scoring, and follow-up suggestions. Layered fallback: edge response cache → 30-entry curated FAQ → templated default. Failures never surface as HTTP errors; `metadata.source` is `ai \| cached \| curated`. |
| **Asset Pipeline** | Upload a single SVG → automatic directory scaffold with PWA icons, banners, and favicon. |
| **Zone Management** | Create, delete, and configure tenant zones via GitOps commits through the Core API. |
| **Edge Analytics** | Real-time request tracking, bandwidth monitoring, cache ratio, geo distribution, and error tracking. |
| **Cache Purge** | Instant invalidation by URL, surrogate tag (`Cache-Tag`), or full purge via the Cloudflare API. |
| **Dashboard** | Protected asset browser with faceted search, transform builder, insights charts, and upload pipeline. |

## API

Six distinct planes with strict authentication separation:

| Plane | Prefix | Auth | Description |
| :--- | :--- | :--- | :--- |
| **Storage** | `/api/storage/` | AccessKey | Upload, download, delete, batch operations |
| **Core** | `/api/core/` | AccountKey | Zones, domains, edge rules, statistics |
| **Assets** | `/api/assets` | AccessKey | Paginated catalog, per-asset metadata |
| **Insights** | `/api/insights/` | Any key | Summary, top assets, geography, errors |
| **Delivery** | `/api/transform` `/api/auto` `/api/signed` `/api/stream` `/api/purge` | Public | Edge transforms, format negotiation, signed URLs, HLS, cache |
| **AI** | `/api/search` `/api/chat` | Public | Semantic search, RAG concierge |

Interactive reference with Try It console: **[cloudcdn.pro/api-reference](https://cloudcdn.pro/api-reference)**

## Install

```bash
git clone https://github.com/sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
npm ci
```

## First 5 Minutes

```bash
# Start local development server
wrangler pages dev .

# Run the full test suite (2,000 tests)
npm test

# Generate the asset manifest
npm run build:manifest

# Build the dashboard CSS
npm run build:css
```

<details>
<summary><strong>Upload your first asset</strong></summary>

```bash
# Upload via the Storage API
curl -X PUT -H "AccessKey: YOUR_KEY" \
  -H "Content-Type: image/svg+xml" \
  -T ./logo.svg \
  https://cloudcdn.pro/api/storage/clients/myproject/v1/logos/logo.svg

# Or use the Asset Pipeline to scaffold a full directory
curl -X POST -H "AccountKey: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "client", "name": "myproject", "svg": "<base64>" }' \
  https://cloudcdn.pro/api/pipeline
```

</details>

<details>
<summary><strong>Transform an image on the fly</strong></summary>

```bash
# Resize to 400px WebP
curl 'https://cloudcdn.pro/api/transform?url=/myproject/v1/logos/logo.svg&w=400&format=webp'

# Generate a blur placeholder
curl 'https://cloudcdn.pro/api/transform?url=/myproject/v1/logos/logo.svg&w=32&q=1&blur=20'

# Auto-negotiate format (no auth needed)
curl 'https://cloudcdn.pro/api/auto?path=/myproject/v1/logos/logo'
```

</details>

## Environment Variables

| Variable | Description |
| :--- | :--- |
| `ACCOUNT_KEY` | Core API authentication (admin) |
| `STORAGE_KEY` | Storage API authentication (files) |
| `DASHBOARD_PASSWORD` | Dashboard login |
| `GITHUB_TOKEN` | GitOps mutations (upload/delete) |
| `GITHUB_REPO` | Repository for Git-based storage |
| `CLOUDFLARE_ACCOUNT_ID` | Custom domains, analytics |
| `CLOUDFLARE_API_TOKEN` | Cache purge, domains |
| `CLOUDFLARE_ZONE_ID` | Cache invalidation |
| `SIGNED_URL_SECRET` | HMAC signed URL generation |
| `AI_DAILY_BUDGET` | Workers AI neuron soft cap per UTC day (default `9000`). When tripped, `/api/search` and `/api/chat` switch to cached + fuzzy / curated answers. |
| `AI_CB_TTL_SEC` | Circuit-breaker open duration in seconds after a quota error (default `60`). |

## Testing

```bash
npm test                # 2,140+ tests across 55 suites
npm run test:coverage   # 100% statement/branch/function/line
npm run test:visual     # Playwright visual regression (10 screenshots)
npm run test:load       # k6 load test (1,000 VUs)
npm run test:audit      # npm dependency security audit
```

<details>
<summary><strong>Test suite breakdown</strong></summary>

| Category | Suites | Tests |
| :--- | :--- | :--- |
| Endpoint unit tests | 14 | 600+ |
| Domain regression (Data/Control/Edge) | 13 | 250+ |
| Cross-cutting (auth, CORS, pagination, streaming) | 13 | 250+ |
| OpenAPI spec validation | 2 | 500+ |
| Infrastructure (manifest, client libs) | 8 | 400+ |
| AI fallback (cache, budget, breaker, curated) | 5 | 40+ |
| **Total** | **55** | **2,140+** |

</details>

## Security

- **Timing-safe HMAC** — XOR-based constant-time comparison on all signature verifications
- **Fail-closed auth** — production endpoints deny access when secrets are not configured
- **Path traversal hardened** — URL decoding, null byte rejection, `.git` blocking
- **CSP headers** — per-section Content-Security-Policy on dashboard, dist, and API reference
- **HSTS preload** — `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- **SHA-pinned Actions** — all GitHub Actions pinned by commit hash
- **Signed commits** — every deployment verified via GitHub API before reaching the edge

## Resilience — AI quota fallback

`/api/search` and `/api/chat` depend on Cloudflare Workers AI and Vectorize, both of which have daily quotas. To keep users error-free when those exhaust, both endpoints run three layered fallbacks (see `functions/api/_shared.js`):

1. **Edge response cache** — Workers Cache API, day-bucketed key path. Hot queries replay instantly with zero AI cost. Search TTL 1h, chat TTL 24h.
2. **Neuron budget + circuit breaker** — per-day usage counter in KV (`ai:neurons:YYYY-MM-DD`) against `AI_DAILY_BUDGET`. Quota-shaped errors (429, codes 3040/7006/9001, or `quota|capacity|too many|rate limit|exceeded` substrings) flip `ai:cb:open` for `AI_CB_TTL_SEC`, short-circuiting subsequent AI calls.
3. **Curated fallback for chat** — 30-entry FAQ at `functions/api/chat-fallback.json` (seeded from `cdn/en/content/{faq,pricing,limits}.md`). Token-Jaccard match against question variants; replay through the same SSE event sequence (`metadata`/`token`/`done`) so the client only needs `metadata.source` (`ai | cached | curated`) and `metadata.degraded` to render.

Search annotates its mode (`vector | fuzzy | cached`) on every response. AI failures never surface as 5xx — chat falls back to the curated answer, search falls back to fuzzy.

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run build:manifest` | Rebuild `manifest.json` + TypeScript definitions |
| `npm run build:css` | Rebuild dashboard Tailwind CSS |
| `node scripts/prune-icons.mjs` | Remove legacy icon variants |
| `node scripts/prune-formats.mjs` | Keep single source per image |
| `node scripts/generate-client-libs.mjs` | Generate API client libraries (JS, TS, Python, cURL) |
| `node scripts/index-assets.mjs` | Build Vectorize embeddings for semantic search |
| `node scripts/patch-openapi.mjs` | Patch OpenAPI spec with missing response codes |

## Deployment

Pushes to `main` trigger automatic deployment via Cloudflare Pages:

1. **Verify signatures** — every commit must be cryptographically signed
2. **Deploy to edge** — `wrangler pages deploy` across 300+ PoPs
3. **Compress images** — auto-generate WebP/AVIF from new PNGs (signed commit)
4. **Regenerate manifest** — update asset registry via GitHub API (signed commit)

## License

The project is dual-licensed under the terms of both the [MIT license](LICENSE) and the [Apache License (Version 2.0)](http://www.apache.org/licenses/LICENSE-2.0).

## Acknowledgements

Built by [Sebastien Rousseau](https://github.com/sebastienrousseau) on [Cloudflare Workers](https://workers.cloudflare.com/), [Pages](https://pages.cloudflare.com/), [KV](https://developers.cloudflare.com/kv/), [Vectorize](https://developers.cloudflare.com/vectorize/), and [Workers AI](https://developers.cloudflare.com/workers-ai/).
