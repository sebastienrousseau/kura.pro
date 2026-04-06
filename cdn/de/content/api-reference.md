# CloudCDN — API-Referenz

## Basis-URL
```
https://cloudcdn.pro
```

## Asset-URL-Format
```
https://cloudcdn.pro/{projekt}/images/{kategorie}/{dateiname}.{format}
```

Beispiel:
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## Bildtransformations-API (Pro-Tarif und höher)

Hängen Sie Query-Parameter an eine beliebige Asset-URL an, um das Bild on-the-fly zu transformieren.

### Größenänderung
| Parameter | Typ | Beschreibung | Beispiel |
|-----------|-----|--------------|----------|
| `w` | Ganzzahl | Breite in Pixel (1-8192) | `?w=800` |
| `h` | Ganzzahl | Höhe in Pixel (1-8192) | `?h=600` |
| `fit` | String | Verhalten bei der Größenänderung | `?fit=cover` |

**`fit`-Modi:**
- `cover` — Größe anpassen, damit die Dimensionen ausgefüllt werden, Überhang zuschneiden (Standard)
- `contain` — Größe so anpassen, dass es in die Dimensionen passt, Seitenverhältnis erhalten
- `fill` — Auf exakte Dimensionen dehnen (Seitenverhältnis wird ignoriert)
- `inside` — Verkleinern bis es passt, niemals vergrößern
- `outside` — Vergrößern, damit es bedeckt, niemals verkleinern

### Formatkonvertierung
| Parameter | Typ | Beschreibung | Beispiel |
|-----------|-----|--------------|----------|
| `format` | String | Ausgabeformat | `?format=auto` |
| `q` | Ganzzahl | Qualität (1-100) | `?q=80` |

**`format`-Werte:**
- `auto` — Liefert AVIF, WebP oder das Original abhängig vom `Accept`-Header des Browsers
- `webp` — Erzwingt WebP-Ausgabe
- `avif` — Erzwingt AVIF-Ausgabe
- `png` — Erzwingt PNG-Ausgabe
- `jpeg` — Erzwingt JPEG-Ausgabe

### Effekte
| Parameter | Typ | Beschreibung | Beispiel |
|-----------|-----|--------------|----------|
| `blur` | Ganzzahl | Gaußscher Weichzeichner (1-250) | `?blur=20` |
| `sharpen` | Ganzzahl | Schärfen (1-10) | `?sharpen=3` |
| `gravity` | String | Ankerpunkt beim Zuschnitt | `?gravity=face` |

**`gravity`-Werte:** `center`, `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `face` (KI-erkannt).

### Parameter verketten
Kombinieren Sie mehrere Parameter mit `&`:
```
https://cloudcdn.pro/projekt/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP (Low Quality Image Placeholder)
Erzeugen Sie einen winzigen, unscharfen Platzhalter für progressives Laden:
```
https://cloudcdn.pro/projekt/image.png?w=40&blur=50&q=20
```
Dies erzeugt einen etwa 500 Byte großen Platzhalter, der als Base64-Daten-URI inline eingebunden werden kann.

## Asset-Manifest

### GET /manifest.json
Gibt ein JSON-Array aller Assets im CDN zurück.

**Antwort:**
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

**Felder:**
| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `name` | String | Dateiname |
| `path` | String | Vollständiger Pfad relativ zur CDN-Wurzel |
| `project` | String | Name des Projektverzeichnisses |
| `category` | String | Unterverzeichnis-Kategorie (banners, icons, logos usw.) |
| `format` | String | Dateierweiterung (png, webp, avif, svg, ico) |
| `size` | Ganzzahl | Dateigröße in Byte |

**Caching:** `max-age=300` (5 Minuten), CORS aktiviert.

## HTTP-Header

### Asset-Antworten
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### Fehlerantworten
| Status | Bedeutung |
|--------|-----------|
| `200` | Erfolg |
| `304` | Nicht modifiziert (bedingte Anfrage) |
| `404` | Asset nicht gefunden |
| `429` | Rate Limit überschritten (nur Concierge-API) |

## Cache-Purging (Pro und höher)

### Über das Cloudflare-Dashboard
Workers & Pages → cloudcdn-pro → Caching → Purge by URL.

### Über die API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/projekt/image.webp"]}'
```

## Rate Limits
| Endpoint | Limit |
|----------|-------|
| Asset-Auslieferung | Unbegrenzt (Cloudflare Edge) |
| Manifest.json | Unbegrenzt (5 Min. Cache) |
| Concierge-Chat | 1.000 Anfragen/Monat |
| Bildtransformationen (Pro) | 50.000/Monat |
| Bildtransformationen (Enterprise) | Unbegrenzt |

## SDKs und Integration

### HTML (responsiv mit Format-Fallback)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML (Pro-Tarif mit Auto-Format)
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

// Komponente
import Image from 'next/image';
<Image src="https://cloudcdn.pro/projekt/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/projekt/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/projekt/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/projekt/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/projekt/images/logos/logo.webp)
```
