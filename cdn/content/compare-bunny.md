# CloudCDN vs Bunny CDN

## At a Glance

| Feature | CloudCDN | Bunny CDN |
|---------|----------|-----------|
| **Entry Price** | $29/mo (Pro) | $9.50/mo flat |
| **Free Tier** | 10 GB/mo bandwidth | 14-day trial only |
| **Billing Model** | Bandwidth tiers | Per-GB (volume pricing from $0.01/GB) |
| **Workflow** | Git-native (git push) | Dashboard/FTP/API |
| **Auto-Optimization** | WebP + AVIF + JXL at push | Bunny Optimizer (separate add-on) |
| **Storage API** | Bunny.net-compatible JSON schema | Native |
| **AI Features** | Semantic search + RAG concierge + MCP server | None |
| **Signed Commits** | Required (supply chain integrity) | Not applicable |
| **Edge Locations** | 300+ (Cloudflare) | 114 PoPs |
| **TTFB** | <50ms median (NA/EU) | ~40-80ms typical |
| **Edge Compute** | Cloudflare Workers (full JS runtime) | Bunny Script (limited) |
| **Perma-Cache** | Immutable 1-year headers | Perma-Cache feature |
| **JPEG XL** | Supported | Not available in Optimizer |
| **Asset Provenance** | Cryptographic (signed Git commits) | None |
| **MCP Server** | Built-in | Not available |

## Why CloudCDN Uses Bunny-Compatible APIs

CloudCDN's Storage API returns Bunny.net-compatible JSON schema (Guid, StorageZoneName, Path, ObjectName, etc.). This means migration tools and scripts built for Bunny work with CloudCDN out of the box.

## When to Choose CloudCDN

- You want **Git-native workflow** (no FTP, no dashboard uploads)
- You need **AI-powered search** and **agent integration** (MCP)
- You need **cryptographic provenance** for every asset
- You want **JPEG XL** auto-generation alongside WebP and AVIF
- You want a **permanent free tier** (Bunny's trial expires)

## When to Choose Bunny CDN

- You need the **lowest possible per-GB pricing** ($0.01/GB in some regions)
- You need **FTP/SFTP access** to your storage
- You need **Bunny Stream** for video hosting
- You have very high bandwidth (100+ TB/month) and need volume discounts
- You need **DDoS protection** as an add-on with custom rules

## Cost Comparison

For a site serving 50 GB/month:

- **CloudCDN Pro**: $29/mo
- **Bunny CDN**: ~$2.50/mo (EU/US at $0.05/GB) + $0.50/mo storage

For 500 GB/month:

- **CloudCDN Pro**: $29 + (400 GB x $0.05) = $49/mo
- **Bunny CDN**: ~$25/mo (EU/US) + storage

Bunny wins on raw bandwidth cost. CloudCDN wins on workflow, AI features, provenance, and free tier.
