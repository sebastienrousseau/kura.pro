# About CloudCDN

## What is CloudCDN?
CloudCDN is a Git-native static asset delivery network for developers. Push images to a GitHub repository, and they're automatically optimized and served globally from Cloudflare's edge network — 300+ data centers, 100+ countries, sub-100ms latency.

Unlike traditional image CDNs that require dashboards, upload APIs, or SDK integrations, CloudCDN uses the workflow developers already know: `git push`.

## How It Works
1. **Push:** Add images to the GitHub repository and commit with a signed key.
2. **Optimize:** GitHub Actions automatically compress images and generate WebP (quality 80, ~60% smaller) and AVIF (quality 65, ~70% smaller) variants.
3. **Deploy:** Changed files are uploaded to Cloudflare Pages via incremental deploy (content-hash deduplication — only new/changed files transfer).
4. **Deliver:** Assets are served with immutable cache headers (`max-age=31536000`) from the nearest of 300+ edge locations.

## Technology Stack
- **Edge Network:** Cloudflare Pages on 300+ global PoPs. 95% of the world's population is within 50ms of a Cloudflare data center.
- **Image Formats:** PNG (original lossless), WebP (lossy, quality 80), AVIF (lossy, quality 65), SVG (passthrough), ICO (passthrough).
- **Format Negotiation:** Pro tier serves optimal format based on browser `Accept` header (AVIF > WebP > original).
- **Caching:** Immutable edge + browser caching with 1-year max-age. Cache-busting via filename/path changes.
- **CI/CD:** GitHub Actions for compression (Sharp), manifest generation, and Cloudflare Pages deployment (Wrangler).
- **Security:** SSH Ed25519 signed commits required. Branch protection on main. Encrypted API tokens via GitHub Secrets.
- **AI Concierge:** Cloudflare Workers AI (Llama 3.1) + Vectorize RAG for intelligent documentation search on the homepage.

## Performance
- **TTFB:** Median <50ms in North America/Europe, <100ms globally (Cloudflare edge cache hit).
- **Cache Hit Ratio:** >95% for production assets (immutable caching).
- **Deploy Speed:** Incremental uploads — only changed files transfer. Typical deploy: 5-30 seconds.
- **Compression:** WebP saves ~60% vs PNG. AVIF saves ~70% vs PNG. Both generated automatically.

## Asset Organization
```
project-name/
  images/
    banners/    — Wide-format graphics (1200x630 recommended)
    icons/      — Multi-resolution (16x16 through 512x512, with @2x/@3x)
    logos/       — Brand logos and marks
    github/     — Social preview images
    titles/     — Title graphics and headers
  README.md     — Optional project description
```

## Key Metrics
- **1,400+ optimized assets** across 54 tenant zones.
- **Single source per image** — derivatives generated on demand via `/api/transform`.
- **300+ edge PoPs** across 100+ countries.
- **<100ms global TTFB** on edge cache hits.
- **Zero build step** — no `npm install`, no webpack, no framework required.

## Who Uses CloudCDN?
CloudCDN serves assets for:
- **Open-source projects:** Logos, banners, icons, and documentation graphics.
- **Developer tools:** Rust, Python, and AI developer branding (rustdev, pythondev, llamadev).
- **Fintech platforms:** Banking and quantum computing asset libraries.
- **Audio applications:** Waveform visualizations and UI components.
- **Static site generators:** Shokunin, Kaishi, and other SSG frameworks.

## Why Not [Competitor]?

| vs. Cloudinary | vs. Imgix | vs. Bunny CDN |
|---|---|---|
| No credit system complexity | No credit-based billing | AVIF support included |
| Git-native workflow | Git-native workflow | Git-native workflow |
| Free tier, no credit card | Free tier available | No trial expiration |
| AI concierge built-in | Standard docs only | Standard docs only |

## Open Source
The CDN infrastructure is open-source under the MIT License. Repository: github.com/sebastienrousseau/cloudcdn.pro.

## Contact
- **Support:** support@cloudcdn.pro
- **Sales:** sales@cloudcdn.pro
- **GitHub:** github.com/sebastienrousseau/cloudcdn.pro
- **Status:** cloudcdn.pro (homepage shows operational status)
