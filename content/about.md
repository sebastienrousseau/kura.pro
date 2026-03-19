# About CloudCDN

## What is CloudCDN?
CloudCDN is a high-performance static asset delivery network built for developers. It serves images, icons, fonts, and static files from Cloudflare's global edge network — 300+ data centers across 100+ countries — with sub-100ms latency worldwide.

## How It Works
1. **Push:** Upload assets to the GitHub repository via signed commits.
2. **Optimize:** The CI/CD pipeline automatically compresses images and generates WebP and AVIF variants.
3. **Deliver:** Assets are deployed to Cloudflare Pages and served with immutable cache headers from the nearest edge location.

## Technology Stack
- **Edge Network:** Cloudflare Pages with 300+ global points of presence.
- **Image Formats:** PNG (original), WebP (80% quality, ~60% smaller), AVIF (65% quality, ~70% smaller), SVG, ICO.
- **Caching:** Immutable headers with 1-year max-age. Assets are cached at both the CDN edge and in user browsers.
- **Automation:** GitHub Actions for image compression, format conversion, and manifest generation.
- **Security:** Signed commits (SSH Ed25519), branch protection, and encrypted API tokens.
- **AI Concierge:** Cloudflare Workers AI + Vectorize for intelligent documentation search.

## Asset Organization
Assets are organized by project in a consistent directory structure:
```
project-name/
  images/
    banners/    — Wide-format graphics
    icons/      — Multi-resolution icons (16x16 to 512x512)
    logos/      — Brand logos and marks
    github/     — GitHub social preview images
    titles/     — Title graphics
```

## Key Metrics
- **10,300+ assets** across 57 projects.
- **3 formats per image** (PNG + WebP + AVIF) for optimal browser compatibility.
- **Sub-100ms TTFB** globally via Cloudflare's edge network.
- **99.9%+ uptime** backed by Cloudflare's infrastructure SLA.
- **Automatic optimization** — push a PNG, get WebP and AVIF for free.

## Who Uses CloudCDN?
CloudCDN serves assets for open-source projects, developer tools, and commercial applications including:
- Rust and Python developer tool branding
- Financial technology platforms
- Audio processing applications
- Static site generators
- Enterprise software documentation

## Open Source
The CDN infrastructure is open-source under the MIT License. Contributions are welcome via pull request with signed commits.

## Contact
- **Support:** support@cloudcdn.pro
- **Sales:** sales@cloudcdn.pro
- **GitHub:** github.com/sebastienrousseau/kura.pro
