# CloudCDN — Riferimento API

## URL base
```
https://cloudcdn.pro
```

## Formato dell'URL degli asset
```
https://cloudcdn.pro/{progetto}/images/{categoria}/{nome-file}.{formato}
```

Esempio:
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## API di trasformazione delle immagini (piano Pro e superiori)

Aggiungi parametri di query a qualsiasi URL di asset per trasformare l'immagine al volo.

### Ridimensionamento
| Parametro | Tipo | Descrizione | Esempio |
|-----------|------|-------------|---------|
| `w` | intero | Larghezza in pixel (1-8192) | `?w=800` |
| `h` | intero | Altezza in pixel (1-8192) | `?h=600` |
| `fit` | stringa | Comportamento di ridimensionamento | `?fit=cover` |

**Modalità `fit`:**
- `cover` — Ridimensiona per riempire le dimensioni, ritagliando l'eccesso (predefinito)
- `contain` — Ridimensiona per adattarsi alle dimensioni mantenendo le proporzioni
- `fill` — Stira fino alle dimensioni esatte (ignora le proporzioni)
- `inside` — Ridimensiona per adattarsi, senza mai ingrandire
- `outside` — Ridimensiona per coprire, senza mai rimpicciolire

### Conversione di formato
| Parametro | Tipo | Descrizione | Esempio |
|-----------|------|-------------|---------|
| `format` | stringa | Formato di output | `?format=auto` |
| `q` | intero | Qualità (1-100) | `?q=80` |

**Valori di `format`:**
- `auto` — Serve AVIF, WebP o l'originale in base all'header `Accept` del browser
- `webp` — Forza output WebP
- `avif` — Forza output AVIF
- `png` — Forza output PNG
- `jpeg` — Forza output JPEG

### Effetti
| Parametro | Tipo | Descrizione | Esempio |
|-----------|------|-------------|---------|
| `blur` | intero | Sfocatura gaussiana (1-250) | `?blur=20` |
| `sharpen` | intero | Nitidezza (1-10) | `?sharpen=3` |
| `gravity` | stringa | Punto di ancoraggio del ritaglio | `?gravity=face` |

**Valori di `gravity`:** `center`, `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `face` (rilevato dall'IA).

### Concatenazione dei parametri
Combina più parametri con `&`:
```
https://cloudcdn.pro/progetto/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP (Low Quality Image Placeholder)
Genera un piccolo segnaposto sfocato per il caricamento progressivo:
```
https://cloudcdn.pro/progetto/image.png?w=40&blur=50&q=20
```
Questo produce un segnaposto di circa 500 byte che può essere incorporato come URI di dati base64.

## Manifest degli asset

### GET /manifest.json
Restituisce un array JSON di tutti gli asset nel CDN.

**Risposta:**
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

**Campi:**
| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `name` | stringa | Nome del file |
| `path` | stringa | Percorso completo relativo alla radice del CDN |
| `project` | stringa | Nome della directory del progetto |
| `category` | stringa | Categoria della sottodirectory (banners, icons, logos, ecc.) |
| `format` | stringa | Estensione del file (png, webp, avif, svg, ico) |
| `size` | intero | Dimensione del file in byte |

**Cache:** `max-age=300` (5 minuti), CORS abilitato.

## Header HTTP

### Risposte degli asset
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### Risposte di errore
| Stato | Significato |
|-------|-------------|
| `200` | Successo |
| `304` | Non modificato (richiesta condizionale) |
| `404` | Asset non trovato |
| `429` | Limite di velocità superato (solo API Concierge) |

## Purge della cache (Pro e superiori)

### Tramite la dashboard di Cloudflare
Workers & Pages → cloudcdn-pro → Caching → Purge by URL.

### Tramite l'API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/progetto/image.webp"]}'
```

## Limiti di velocità
| Endpoint | Limite |
|----------|--------|
| Distribuzione degli asset | Illimitato (edge Cloudflare) |
| Manifest.json | Illimitato (cache di 5 minuti) |
| Chat del Concierge | 1.000 richieste/mese |
| Trasformazioni di immagini (Pro) | 50.000/mese |
| Trasformazioni di immagini (Enterprise) | Illimitate |

## SDK e integrazione

### HTML (responsive con fallback di formato)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML (piano Pro con auto-formato)
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

// Componente
import Image from 'next/image';
<Image src="https://cloudcdn.pro/progetto/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/progetto/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/progetto/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/progetto/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/progetto/images/logos/logo.webp)
```
