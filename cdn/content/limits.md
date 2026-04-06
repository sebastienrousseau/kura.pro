# CloudCDN — Limits & Quotas

## File Limits
| Limit | Value |
|-------|-------|
| Maximum file size (CDN delivery) | 25 MB |
| Maximum file size (Git repository) | No hard limit (GitHub LFS available) |
| Supported image formats | PNG, JPEG, WebP, AVIF, SVG, ICO |
| Supported video formats | MP4 (≤25 MB) |
| Maximum filename length | 255 characters |
| URL case sensitivity | Yes — paths are case-sensitive |

## Bandwidth Limits
| Tier | Monthly Bandwidth | Overage |
|------|------------------|---------|
| Free | 10 GB | Service pauses until next month |
| Pro | 100 GB | $0.05/GB |
| Enterprise | Unlimited | N/A |

Bandwidth is measured as bytes delivered from edge to end users. Origin pulls, CI/CD transfers, and Concierge API calls do not count.

## Deployment Limits
| Limit | Value |
|-------|-------|
| Maximum files per deployment | 20,000 |
| Maximum deployment size | No hard cap (incremental uploads) |
| Concurrent deployments | 1 (queued if overlapping) |
| Deploy frequency | No limit (triggered on every push to main) |

## Image Transformation Limits (Pro+)
| Limit | Pro | Enterprise |
|-------|-----|-----------|
| Transformations/month | 50,000 | Unlimited |
| Max output dimensions | 8192 x 8192 px | 8192 x 8192 px |
| Max quality parameter | 100 | 100 |
| Max blur radius | 250 | 250 |
| Supported output formats | auto, webp, avif, png, jpeg | auto, webp, avif, png, jpeg |

## API & Rate Limits
| Endpoint | Limit |
|----------|-------|
| Asset delivery | Unlimited (Cloudflare edge) |
| manifest.json | Unlimited (5-min edge cache) |
| Concierge chat API | 1,000 queries/month (all tiers) |
| Cache purge API (Pro+) | 1,000 purges/day |

## Custom Domains
| Tier | Custom Domains |
|------|---------------|
| Free | 0 |
| Pro | Up to 5 |
| Enterprise | Unlimited (including wildcard) |

## Storage
There is no storage quota — you can push unlimited files to the repository. The practical limit is GitHub's repository size recommendations (ideally under 5 GB, with GitHub LFS for larger repos).

## Auto-Conversion
| Limit | Value |
|-------|-------|
| Formats generated per upload | 2 (WebP + AVIF) |
| Max concurrent conversions (CI) | Based on GitHub Actions runner (2 CPU cores) |
| Conversion timeout | 6 hours (GitHub Actions limit) |

## Concierge AI
| Limit | Value |
|-------|-------|
| Monthly queries | 1,000 |
| Session queries (client-side) | 100 |
| Conversation history | Current session only (not persisted) |
| Knowledge base size | 5 content documents, ~30 chunks |
| Response max tokens | 512 |

## What Happens at Limits
- **Bandwidth exceeded (Free):** Assets stop serving until next month. Email warning at 80%.
- **Bandwidth exceeded (Pro):** Overage billed at $0.05/GB. No service interruption.
- **Concierge limit reached:** Chat widget disables for the month.
- **Transform limit reached (Pro):** Transforms return original format until next month.
- **File too large:** Files >25 MB excluded from CDN but remain in Git.
