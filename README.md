# CloudCDN

Enterprise-grade static asset delivery on Cloudflare's global edge network. Sub-100ms TTFB across 300+ PoPs. 1,400+ assets, 54 tenant zones, zero-config deployment.

## Architecture

```
/
├── clients/          54 tenant asset directories (GitOps-managed)
├── stocks/           Global stock media (images, diagrams, videos)
├── website/          Application layer (dashboard, docs, scripts)
├── functions/        Cloudflare edge computing (middleware + 12 API endpoints)
├── manifest.json     Auto-generated asset registry (1,400+ entries)
├── wrangler.toml     Cloudflare bindings (AI, Vectorize, KV)
└── package.json      Dependencies + npm scripts
```

## API Surface

| Plane | Endpoints | Auth | Purpose |
|-------|-----------|------|---------|
| **Storage** | `/api/storage/*` | AccessKey | Upload, download, delete, batch |
| **Core** | `/api/core/*` | AccountKey | Zones, domains, rules, statistics |
| **Assets** | `/api/assets/*` | AccessKey | Paginated catalog, metadata |
| **Insights** | `/api/insights/*` | Any key | Summary, top assets, geo, errors |
| **Delivery** | `/api/transform`, `/api/auto`, `/api/signed`, `/api/stream`, `/api/purge` | Public/PurgeKey | Image transforms, format negotiation, signed URLs, HLS, cache purge |
| **AI** | `/api/search`, `/api/chat` | Public | Semantic search, RAG concierge |

Interactive reference: [cloudcdn.pro/api-reference](https://cloudcdn.pro/api-reference)

## Local Development

```bash
npm ci
wrangler pages dev .     # http://localhost:8788
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACCOUNT_KEY` | Core API authentication |
| `STORAGE_KEY` | Storage API authentication |
| `DASHBOARD_PASSWORD` | Dashboard login |
| `GITHUB_TOKEN` | Upload/delete via Git (Storage API) |
| `GITHUB_REPO` | Repository for GitOps mutations |
| `CLOUDFLARE_ACCOUNT_ID` | Custom domains, analytics |
| `CLOUDFLARE_API_TOKEN` | Purge, domains, Workers AI |
| `CLOUDFLARE_ZONE_ID` | Cache purge |
| `SIGNED_URL_SECRET` | HMAC signed URL generation |

## Testing

```bash
npm test                # 605 tests, 22 suites
npm run test:coverage   # 100% statement/branch/function/line
npm run test:visual     # Playwright visual regression (10 screenshots)
npm run test:load       # k6 load test (1,000 VUs)
npm run test:audit      # npm security audit
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Generate manifest | `npm run build:manifest` | Rebuild `manifest.json` + TypeScript defs |
| Build CSS | `npm run build:css` | Rebuild dashboard Tailwind CSS |
| Prune icons | `node website/scripts/prune-icons.mjs` | Remove legacy icon variants |
| Prune formats | `node website/scripts/prune-formats.mjs` | Keep single source per image |
| Generate clients | `node website/scripts/generate-client-libs.mjs` | Generate API client libraries |
| Index assets | `node website/scripts/index-assets.mjs` | Vectorize embeddings for semantic search |

## Deployment

Pushes to `main` trigger automatic deployment via Cloudflare Pages. The CI pipeline:

1. **Verify signatures** — every commit must be cryptographically signed
2. **Deploy to edge** — `wrangler pages deploy` across 300+ PoPs
3. **Compress images** — auto-generate WebP/AVIF from new PNGs
4. **Regenerate manifest** — update asset registry via GitHub API (signed commit)

## License

[MIT](LICENSE)
