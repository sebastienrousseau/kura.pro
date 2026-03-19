# CloudCDN Pricing (2026)

## Plan Comparison

| Feature | Free | Pro ($29/mo) | Enterprise (Custom) |
|---------|------|-------------|-------------------|
| Bandwidth | 10 GB/mo | 100 GB/mo | Unlimited |
| Storage | Unlimited files | Unlimited files | Dedicated storage |
| Image Formats | WebP + AVIF auto-convert | WebP + AVIF + quality controls | Full suite + batch |
| Image Transforms | None | Resize, crop, format via URL | Full API + batch processing |
| Custom Domains | Not included | Up to 5 (auto SSL) | Unlimited |
| Analytics | None | Basic dashboard | Real-time per-asset/region |
| Support | Community / GitHub Issues | Priority email (24hr SLA) | Dedicated manager + Slack |
| SLA | Best-effort (~99.9%) | 99.9% uptime guarantee | 99.99% + financial credits |
| Signed Commits | Required | Required | Required |
| SSO/SAML | No | No | Yes |
| Audit Logs | No | No | Yes |

## Free Tier (Open Source)
- **Target:** Personal projects, open-source software, hobbyists.
- **Cost:** $0/month — free forever, no credit card required.
- **Bandwidth:** 10 GB/month. Assets stop serving via CDN if exceeded (files remain in git).
- **Assets:** Unlimited static files (PNG, WebP, AVIF, SVG, ICO).
- **Auto-Optimization:** Every PNG/JPEG pushed is automatically converted to WebP (quality 80) and AVIF (quality 65).
- **Delivery:** Sub-100ms TTFB from Cloudflare's 300+ edge PoPs. Immutable caching (1-year max-age).
- **Limitations:** No custom domains, no image transformation API, no analytics dashboard.

## Pro Tier
- **Target:** Commercial projects, startups, high-traffic websites.
- **Cost:** $29/month (or $278/year — save 20%).
- **Bandwidth:** 100 GB/month included. Overage: $0.05/GB billed at cycle end.
- **Image Transformation API:** Resize, crop, and convert on-the-fly via URL parameters:
  ```
  https://cloudcdn.pro/project/image.png?w=800&h=600&fit=cover&format=auto&q=80
  ```
- **Format Negotiation:** Automatic AVIF/WebP serving based on browser `Accept` header.
- **Custom Domains:** Up to 5 domains with automatic SSL provisioning.
- **Priority Support:** Email support with 24-hour response guarantee.
- **SLA:** 99.9% uptime. If breached, 10% service credit per 0.1% below threshold.
- **Analytics:** Bandwidth, request count, cache hit ratio, format distribution.
- **14-day free trial** with full access. No credit card required.

## Enterprise Tier
- **Target:** Global platforms, media companies, e-commerce at scale.
- **Cost:** Custom pricing — contact sales@cloudcdn.pro.
- **Bandwidth:** Unlimited with dedicated edge allocation.
- **Full API Suite:** All Pro transformations plus batch processing, webhook notifications, and programmatic uploads.
- **Custom Domains:** Unlimited with wildcard SSL.
- **Dedicated Support:** Named account manager, private Slack channel, 1-hour response SLA.
- **SLA:** 99.99% uptime. Financial credits: 25% for <99.99%, 50% for <99.9%, 100% for <99.0%.
- **Security:** SSO/SAML, audit logs with 12-month retention, IP allowlisting.
- **Analytics:** Real-time dashboard with per-asset, per-region, and per-format breakdowns.
- **Compliance:** GDPR DPA available, data residency options (EU/US).

## How We Compare

| Provider | Free Tier | Entry Paid | Transform API |
|----------|-----------|------------|---------------|
| **CloudCDN** | 10 GB/mo | $29/mo (100 GB) | Yes (Pro+) |
| Cloudflare Images | 5K transforms/mo | Pay-as-you-go | Yes |
| ImageKit | 25 GB/mo | $9/mo | Yes |
| Cloudinary | ~5K transforms/mo | $89/mo | Yes (300+ params) |
| Bunny CDN | 14-day trial | $9.50/mo flat | Limited |
| Imgix | None | $25/mo | Yes |

**Our advantage:** Zero build step, Git-native workflow, automatic format conversion on push, AI-powered documentation assistant, and Cloudflare's 300+ PoP edge network — all included from the Free tier.

## Billing
- Monthly billing by default. Annual billing saves 20%.
- Free tier: no credit card, no trial expiration.
- Pro trial: 14 days, full feature access, no credit card.
- Overage: billed at cycle end, never mid-cycle service interruption.
- Cancel anytime. No long-term contracts. Data remains accessible for 30 days after cancellation.

## Fair Use Policy
CloudCDN is designed for serving static assets: images, icons, fonts, and documents. It is not intended for video streaming (>25 MB files), application binary distribution, or file hosting. Accounts exceeding fair use will be contacted to discuss an appropriate plan. We will never suspend without notice.
