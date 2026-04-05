# CloudCDN — API Reference

## Base URL
```
https://cloudcdn.pro
```

## Asset URL Format
```
https://cloudcdn.pro/{project}/images/{category}/{filename}.{format}
```

Example:
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## Image Transformation API (Pro+ Tier)

Append query parameters to any asset URL to transform on-the-fly.

### Resize
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `w` | integer | Width in pixels (1-8192) | `?w=800` |
| `h` | integer | Height in pixels (1-8192) | `?h=600` |
| `fit` | string | Resize behavior | `?fit=cover` |

**Fit modes:**
- `cover` — Resize to fill dimensions, crop excess (default)
- `contain` — Resize to fit within dimensions, preserve aspect ratio
- `fill` — Stretch to exact dimensions (ignores aspect ratio)
- `inside` — Resize to fit, never enlarge
- `outside` — Resize to cover, never shrink

### Format Conversion
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `format` | string | Output format | `?format=auto` |
| `q` | integer | Quality (1-100) | `?q=80` |

**Format values:**
- `auto` — Serve AVIF, WebP, or original based on browser `Accept` header
- `webp` — Force WebP output
- `avif` — Force AVIF output
- `png` — Force PNG output
- `jpeg` — Force JPEG output

### Effects
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `blur` | integer | Gaussian blur (1-250) | `?blur=20` |
| `sharpen` | integer | Sharpen (1-10) | `?sharpen=3` |
| `gravity` | string | Crop anchor point | `?gravity=face` |

**Gravity values:** `center`, `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `face` (AI-detected).

### Chaining Parameters
Combine multiple parameters with `&`:
```
https://cloudcdn.pro/project/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP (Low Quality Image Placeholder)
Generate a tiny blurred placeholder for progressive loading:
```
https://cloudcdn.pro/project/image.png?w=40&blur=50&q=20
```
This produces a ~500 byte placeholder that can be inlined as a base64 data URI.

## Asset Manifest

### GET /manifest.json
Returns a JSON array of all assets in the CDN.

**Response:**
```json
[
  {
    "name": "banner-akande.webp",
    "path": "akande/images/banners/banner-akande.webp",
    "project": "akande",
    "category": "banners",
    "format": "webp",
    "size": 10850
  }
]
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Filename |
| `path` | string | Full path relative to CDN root |
| `project` | string | Project directory name |
| `category` | string | Subdirectory category (banners, icons, logos, etc.) |
| `format` | string | File extension (png, webp, avif, svg, ico) |
| `size` | integer | File size in bytes |

**Caching:** `max-age=300` (5 minutes), CORS enabled.

## HTTP Headers

### Asset Responses
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### Error Responses
| Status | Meaning |
|--------|---------|
| `200` | Success |
| `304` | Not Modified (conditional request) |
| `404` | Asset not found |
| `429` | Rate limit exceeded (Concierge API only) |

## Cache Purging (Pro+)

### Via Cloudflare Dashboard
Workers & Pages → kura-pro → Caching → Purge by URL.

### Via API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/project/image.webp"]}'
```

## Rate Limits
| Endpoint | Limit |
|----------|-------|
| Asset delivery | Unlimited (Cloudflare edge) |
| Manifest.json | Unlimited (5-min cache) |
| Concierge chat | 1,000 queries/month |
| Image transforms (Pro) | 50,000/month |
| Image transforms (Enterprise) | Unlimited |

## SDKs & Integration

### HTML (Responsive with format fallback)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML (Pro tier with auto-format)
```html
<img src="https://cloudcdn.pro/p/img/logo.png?w=200&format=auto" alt="Logo" width="200" height="200">
```

### React
```jsx
function CdnImage({ project, path, alt, width, height, ...props }) {
  const base = `https://cloudcdn.pro/${project}/${path}`;
  return (
    <picture>
      <source srcSet={`${base.replace(/\.\w+$/, '.avif')}`} type="image/avif" />
      <source srcSet={`${base.replace(/\.\w+$/, '.webp')}`} type="image/webp" />
      <img src={base} alt={alt} width={width} height={height} loading="lazy" {...props} />
    </picture>
  );
}
```

### Next.js
```jsx
// next.config.js
module.exports = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'cloudcdn.pro' }],
  },
};

// Component
import Image from 'next/image';
<Image src="https://cloudcdn.pro/project/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/project/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/project/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/project/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/project/images/logos/logo.webp)
```
