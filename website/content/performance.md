# CloudCDN — Performance

## Edge Network
CloudCDN is built on Cloudflare's global network:
- **300+ data centers** across 100+ countries, 193+ cities.
- **95% of the world's population** is within 50ms of a Cloudflare PoP.
- **8,000+ network interconnections** for optimal routing.
- Anycast routing automatically directs requests to the nearest PoP.

## Latency
| Region | Median TTFB (cache hit) | P95 TTFB |
|--------|------------------------|----------|
| North America | <30ms | <80ms |
| Europe | <35ms | <90ms |
| Asia Pacific | <50ms | <120ms |
| South America | <60ms | <150ms |
| Africa | <80ms | <200ms |

These are edge cache hit times. First request to a PoP requires origin fetch (adds 50-200ms one time).

## Caching Strategy
All assets use aggressive immutable caching:
```
Cache-Control: public, max-age=31536000, immutable
```

This means:
- **Browser cache:** 1 year. No revalidation requests.
- **CDN edge cache:** 1 year. Served from nearest PoP.
- **Cache hit ratio:** >95% for production assets.
- **Cache-busting:** Change filename/path to serve updated assets.

The manifest.json uses short-lived caching:
```
Cache-Control: public, max-age=300
```

## Image Compression

### Format Comparison
| Format | Typical Size (vs PNG) | Browser Support | Use Case |
|--------|----------------------|-----------------|----------|
| PNG | Baseline (100%) | 100% | Lossless, transparency |
| WebP | ~40% of PNG | 97% | General web delivery |
| AVIF | ~30% of PNG | 93% | Maximum compression |
| SVG | Varies | 100% | Vector graphics, icons |

### Auto-Conversion Settings
- **WebP:** Quality 80, lossy. Best balance of quality and size.
- **AVIF:** Quality 65, lossy. Maximum compression with good visual fidelity.
- Originals (PNG/JPEG) are always preserved alongside generated variants.

### Real-World Savings
For a typical project with 50 icons (16x16 to 512x512):
- PNG total: ~5 MB
- WebP total: ~2 MB (60% reduction)
- AVIF total: ~1.5 MB (70% reduction)

For banner images (1200x630):
- PNG: ~500 KB average
- WebP: ~150 KB average
- AVIF: ~90 KB average

## Core Web Vitals Impact
Serving optimized images via CloudCDN directly improves:

### LCP (Largest Contentful Paint)
- Target: <2.5 seconds.
- Impact: Serving AVIF instead of PNG can reduce LCP by 40-60% for image-heavy pages.
- Tip: Preload above-the-fold images with `<link rel="preload" as="image">`.

### CLS (Cumulative Layout Shift)
- Target: <0.1.
- Impact: Always set `width` and `height` attributes on `<img>` tags to reserve space.
- Tip: Use the manifest.json `size` field for responsive layout calculations.

### INP (Interaction to Next Paint)
- Target: <200ms.
- Impact: Smaller images mean less main-thread decoding work.
- Tip: Use `loading="lazy"` on below-the-fold images to reduce initial page weight.

## Deploy Performance
| Metric | Value |
|--------|-------|
| Incremental deploy (1-10 changed files) | 5-15 seconds |
| Full deploy (10,000+ files) | 30-60 seconds |
| Image compression (per PNG, CI) | ~200ms |
| Manifest generation (10,000+ assets) | <5 seconds |

Deploys use content-hash deduplication — only new or changed files are uploaded. After the initial deploy, subsequent pushes typically upload only the changed files.

## Monitoring
- **Cloudflare Analytics:** Available in the Cloudflare dashboard → Workers & Pages → cloudcdn-pro → Metrics.
- **GitHub Actions:** Build and deploy logs available in the Actions tab.
- **Status:** Homepage (cloudcdn.pro) displays operational status.

## Optimization Tips
1. **Use AVIF URLs** where possible — they're 70% smaller than PNG.
2. **Use the `<picture>` element** for format fallback (AVIF → WebP → PNG).
3. **Preload critical images** above the fold.
4. **Lazy-load everything below the fold** with `loading="lazy"`.
5. **Set explicit dimensions** on all `<img>` tags to prevent layout shift.
6. **Use the smallest icon size needed** — don't serve 512x512 when 64x64 will do.
7. **Pro tier:** Use `?format=auto` to let CloudCDN serve the optimal format automatically.
