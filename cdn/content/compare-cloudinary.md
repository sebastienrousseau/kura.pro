# CloudCDN vs Cloudinary

## At a Glance

| Feature | CloudCDN | Cloudinary |
|---------|----------|------------|
| **Entry Price** | $29/mo (Pro) | $89/mo (Plus) |
| **Free Tier** | 10 GB/mo bandwidth | 25 credits/mo (~5K transforms) |
| **Billing Model** | Bandwidth (GB) | Credit-based (complex) |
| **Workflow** | Git-native (git push) | Dashboard/SDK/API upload |
| **Auto-Optimization** | WebP + AVIF + JXL at push | On-the-fly only |
| **AI Features** | Semantic search + RAG concierge | AI background removal, generative fill |
| **Signed Commits** | Required (supply chain integrity) | Not applicable |
| **Edge Locations** | 300+ (Cloudflare) | ~60 CDN PoPs |
| **TTFB** | <50ms median (NA/EU) | ~80-120ms typical |
| **Custom Domains** | 5 (Pro), unlimited (Enterprise) | Unlimited (paid plans) |
| **SLA** | 99.9% (Pro), 99.99% (Enterprise) | 99.9% (Business+) |
| **SSO/SAML** | Enterprise | Enterprise |
| **MCP Server** | Built-in (AI agent integration) | Not available |
| **Asset Provenance** | Cryptographic (signed Git commits) | Upload timestamp only |

## When to Choose CloudCDN

- You want a **Git-native workflow** — no dashboard, no SDK, just `git push`
- You need **cryptographic provenance** for every asset (compliance, audit trail)
- You want **straightforward bandwidth billing** (no credit math)
- You serve **static assets** (logos, icons, banners, images) and want sub-50ms TTFB
- You want **AI-powered asset search** and an **MCP server** for agent-driven workflows

## When to Choose Cloudinary

- You need **advanced image AI** (background removal, generative fill, auto-cropping)
- You need **video transcoding** with adaptive streaming
- You need **400+ transformation parameters** for complex image pipelines
- You have an existing Cloudinary integration with SDKs

## Cost Comparison

For a site serving 50 GB/month of static assets:

- **CloudCDN Pro**: $29/mo flat
- **Cloudinary Plus**: $89/mo + potential overage on credits

For 200 GB/month:

- **CloudCDN Pro**: $29 + (100 GB overage x $0.05) = $34/mo
- **Cloudinary Advanced**: $224/mo
