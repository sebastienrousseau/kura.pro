# CloudCDN vs Imgix

## At a Glance

| Feature | CloudCDN | Imgix |
|---------|----------|-------|
| **Entry Price** | $29/mo (Pro) | $25/mo (Basic) |
| **Free Tier** | 10 GB/mo bandwidth | None |
| **Billing Model** | Bandwidth (GB) | Origin images + bandwidth |
| **Workflow** | Git-native (git push) | Dashboard/API/SDK |
| **Auto-Optimization** | WebP + AVIF + JXL at push | On-the-fly only |
| **Transform Params** | 9 (resize, format, blur, sharpen, gravity, fit, quality) | 400+ |
| **AI Features** | Semantic search + RAG concierge + MCP server | Face detection, auto-crop |
| **Signed Commits** | Required (supply chain integrity) | Not applicable |
| **Edge Locations** | 300+ (Cloudflare) | Imgix CDN (~50 PoPs) |
| **TTFB** | <50ms median (NA/EU) | ~60-100ms typical |
| **JPEG XL** | Supported (auto-generated at push) | Supported |
| **Asset Provenance** | Cryptographic (signed Git commits) | None |
| **MCP Server** | Built-in | Not available |

## When to Choose CloudCDN

- You want a **free tier** (Imgix has none)
- You want **Git-native workflow** with zero SDKs
- You need **cryptographic asset provenance** for compliance
- You serve mostly static brand assets and don't need 400 transform parameters
- You want **AI agent integration** via MCP

## When to Choose Imgix

- You need **400+ transform parameters** for complex image pipelines
- You need **real-time rendering** of user-uploaded content
- You need **purging by URL pattern** (regex-based)
- Your images are stored in S3/GCS and you need a processing proxy

## Cost Comparison

For a site with 500 source images and 50 GB/month delivery:

- **CloudCDN Pro**: $29/mo
- **Imgix Basic**: $25/mo + bandwidth overage

For 1,000+ source images:

- **CloudCDN Pro**: $29/mo (unlimited source images)
- **Imgix Growth**: $95/mo (1,500 origin images included)
