# CloudCDN — Frequently Asked Questions

## General

### What is CloudCDN?
CloudCDN is a high-performance static asset delivery network powered by Cloudflare's global edge infrastructure. It serves images, icons, and static files from 300+ points of presence worldwide with sub-100ms latency.

### What file formats are supported?
CloudCDN supports PNG, WebP, AVIF, SVG, ICO, and MP4 files. When you upload a PNG or JPEG, the system automatically generates optimized WebP and AVIF variants for faster delivery.

### Is CloudCDN free for open-source projects?
Yes. The Free tier is permanently free for personal and open-source projects with up to 10 GB of bandwidth per month. No credit card required.

### How fast is CloudCDN?
Assets are served from Cloudflare's edge network with immutable caching (Cache-Control: max-age=31536000, immutable). First-byte delivery is typically under 100ms globally. Subsequent requests are served from edge cache with near-zero latency.

## Setup

### How do I upload assets?
Push your assets to the GitHub repository. The CI/CD pipeline automatically compresses images, generates WebP/AVIF variants, and deploys to the edge network. Example:
```bash
git add my-project/images/logo.png
git commit -S -m "add logo asset"
git push origin main
```

### How do I reference assets in my website?
Use the CDN URL format: `https://cloudcdn.pro/{project}/{path}`. For example:
```html
<img src="https://cloudcdn.pro/akande/images/banners/banner-akande.webp" alt="Banner">
```

### Can I use a custom domain?
Pro and Enterprise tiers support custom domains. Contact support to configure your domain with automatic SSL provisioning.

### Does it work with macOS, Linux, and WSL2?
Yes. All you need is Git and a terminal. Clone the repository, add your assets, commit with a signed key, and push. The pipeline handles the rest.

## Technical

### How does caching work?
All assets are served with `Cache-Control: public, max-age=31536000, immutable` headers. This means browsers and CDN edges cache files for one year. If you need to update an asset, change the filename or path — this is the cache-busting strategy.

### What is the maximum file size?
Individual files must be under 25 MB for CDN delivery. Files larger than 25 MB are excluded from the edge deployment but remain in the Git repository.

### Are commits required to be signed?
Yes. All pushes to the main branch must use signed commits (GPG or SSH). This ensures asset integrity and provides an audit trail. See the Security Guide for setup instructions.

### How do I purge the cache?
Cache purging is handled automatically when new assets are deployed. For manual purging, Pro and Enterprise customers can use the Cloudflare dashboard or contact support.

### What is the uptime SLA?
- Free tier: Best-effort (typically 99.9%+)
- Pro tier: 99.9% uptime guarantee
- Enterprise tier: 99.99% uptime guarantee with financial credits

## Billing

### How does bandwidth billing work?
Free tier includes 10 GB/month. Pro tier includes 100 GB/month with $0.05/GB overage. Enterprise has unlimited bandwidth. Bandwidth is measured as the total bytes delivered from the edge to end users.

### Can I upgrade or downgrade at any time?
Yes. Plan changes take effect immediately. If you upgrade mid-cycle, you're billed a prorated amount. Downgrades take effect at the next billing cycle.

### Is there a free trial for Pro?
Yes. The Pro tier includes a 14-day free trial with full access to all features. No credit card required to start the trial.
