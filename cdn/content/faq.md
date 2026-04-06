# CloudCDN — Frequently Asked Questions

## Getting Started

### What is CloudCDN?
CloudCDN is a Git-native image CDN. Push images to a GitHub repo, and they're automatically optimized (WebP + AVIF) and served globally from Cloudflare's 300+ edge locations with sub-100ms latency.

### How is CloudCDN different from Cloudinary or Imgix?
CloudCDN uses a Git-native workflow — no dashboard uploads, no SDKs, no credit systems. You `git push` and your assets are live. Cloudinary uses credit-based billing starting at $89/mo for paid plans. Imgix uses credit bundles starting at $25/mo. CloudCDN's Pro tier is $29/mo with straightforward bandwidth billing.

### Is CloudCDN free for open-source projects?
Yes. The Free tier is permanently free with 10 GB/month bandwidth. No credit card, no trial expiration. Ideal for OSS project logos, banners, icons, and documentation assets.

### Do I need to install anything?
No. You only need Git (2.34+) and an SSH key for signed commits. No Node.js, no package managers, no build tools. The CI/CD pipeline handles all image optimization server-side.

## File Formats

### What file formats are supported?
Upload: PNG, JPEG, SVG, ICO, WebP. The pipeline auto-generates WebP and AVIF variants for all PNG and JPEG uploads. SVG and ICO files are served as-is.

### What quality settings are used for auto-conversion?
WebP: quality 80 (near-lossless, ~60% smaller than PNG). AVIF: quality 65 (high efficiency, ~70% smaller than PNG). These are optimized for the best balance of visual quality and file size.

### Can I override the quality settings?
On the Pro tier, the Image Transformation API supports custom quality via URL parameters: `?q=90` for higher quality, `?q=50` for more compression. Free tier uses the default settings.

### What about JPEG XL?
As of 2026, JPEG XL is behind a flag in Chrome and Firefox, with partial Safari support. We'll add JPEG XL auto-conversion once browser support reaches >80%. Currently, AVIF provides better compression at wider compatibility (93%+ browser support).

### What's the maximum file size?
25 MB per file for CDN delivery. Files over 25 MB remain in the Git repository but are excluded from the edge deployment. For reference, a high-quality 4K PNG is typically 5-15 MB.

## Performance

### How fast is asset delivery?
Median TTFB under 50ms in North America and Europe, under 100ms globally. Assets are served with immutable cache headers (1-year max-age), so repeat visits are served directly from the browser cache.

### How does caching work?
All assets are served with `Cache-Control: public, max-age=31536000, immutable`. Browsers and CDN edges cache files for one year. To update an asset, change the filename (e.g., `logo-v2.webp`) — this is the standard cache-busting approach.

### What is the cache hit ratio?
Production assets typically see >95% cache hit ratio. The manifest.json file is cached for 5 minutes to stay fresh. The dashboard is never cached.

### Can I purge the cache manually?
Free tier: cache purges happen automatically on deploy. Pro/Enterprise: you can purge specific URLs or wildcard patterns via the Cloudflare dashboard or API.

## Image Transformation API (Pro+)

### How does the transformation API work?
Append URL parameters to any asset URL:
```
https://cloudcdn.pro/project/image.png?w=800&h=600&fit=cover&format=auto&q=80
```

### What parameters are available?
- `w` — Width in pixels (e.g., `?w=400`)
- `h` — Height in pixels (e.g., `?h=300`)
- `fit` — Resize mode: `cover`, `contain`, `fill`, `inside`, `outside`
- `format` — Output format: `auto` (best for browser), `webp`, `avif`, `png`, `jpeg`
- `q` — Quality: 1-100 (default varies by format)
- `blur` — Gaussian blur: 1-250 (e.g., `?blur=20` for LQIP placeholder)
- `sharpen` — Sharpening: 1-10
- `gravity` — Crop anchor: `center`, `north`, `south`, `east`, `west`, `face` (AI)

### Does CloudCDN support automatic format negotiation?
Yes (Pro+). When you use `?format=auto`, CloudCDN reads the browser's `Accept` header and serves AVIF (if supported), then WebP, then the original format. This ensures every visitor gets the smallest possible file.

## Setup & Workflow

### How do I upload assets?
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cp my-logo.png cloudcdn.pro/my-project/images/logos/
cd cloudcdn.pro
git add my-project/
git commit -S -m "add my-project logo"
git push origin main
```
Within 1-2 minutes, your asset is live at `https://cloudcdn.pro/my-project/images/logos/my-logo.webp`.

### Can I use a custom domain?
Pro and Enterprise tiers support custom domains. Custom domains get automatic SSL provisioning and CNAME setup through Cloudflare DNS. Contact support@cloudcdn.pro to configure.

### Does it work on macOS, Linux, and WSL2?
Yes. All platforms with Git and SSH. See the Setup Guide for platform-specific instructions including SSH key generation and Git signing configuration.

## Security

### Are signed commits mandatory?
Yes. All pushes to the main branch require signed commits (SSH Ed25519 or GPG). This ensures every asset change is cryptographically verified. See the Security Guide for setup.

### Is my data secure?
Assets are served over HTTPS with TLS 1.3. The origin repository is on GitHub with branch protection. Cloudflare provides DDoS protection, WAF, and bot mitigation on all plans.

## Billing

### How does bandwidth billing work?
Free: 10 GB/month. Pro: 100 GB/month included, $0.05/GB overage. Enterprise: unlimited. Bandwidth = total bytes delivered from edge to end users. Origin pulls and CI/CD transfers don't count.

### Can I upgrade or downgrade anytime?
Yes. Upgrades take effect immediately (prorated). Downgrades take effect at the next billing cycle. Cancel anytime — no contracts.

### Is there a free trial for Pro?
Yes. 14-day full-access trial. No credit card required. Automatically reverts to Free tier if you don't subscribe.

### What happens if I exceed the Free tier bandwidth?
Assets stop serving from the CDN for the remainder of the month. They remain in the Git repository and resume serving at the start of the next month. You'll receive an email warning at 80% usage.

## Compliance

### Is CloudCDN GDPR compliant?
Yes. CloudCDN uses Cloudflare's infrastructure, which processes data in accordance with GDPR. We offer a Data Processing Agreement (DPA) for Enterprise customers. No personal user data is stored — we only serve static files.

### Where is data stored?
Asset files are stored in the GitHub repository (US) and cached at Cloudflare's 300+ global edge locations. Cached copies expire after 1 year or on new deployment.
