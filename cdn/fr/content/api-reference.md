# CloudCDN — Référence de l'API

## URL de base
```
https://cloudcdn.pro
```

## Format d'URL des actifs
```
https://cloudcdn.pro/{projet}/images/{catégorie}/{nom-de-fichier}.{format}
```

Exemple :
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## API de transformation d'images (palier Pro et supérieur)

Ajoutez des paramètres de requête à n'importe quelle URL d'actif pour transformer l'image à la volée.

### Redimensionnement
| Paramètre | Type | Description | Exemple |
|-----------|------|-------------|---------|
| `w` | entier | Largeur en pixels (1-8192) | `?w=800` |
| `h` | entier | Hauteur en pixels (1-8192) | `?h=600` |
| `fit` | chaîne | Comportement de redimensionnement | `?fit=cover` |

**Modes de `fit` :**
- `cover` — Redimensionne pour remplir les dimensions, recadre l'excédent (par défaut)
- `contain` — Redimensionne pour tenir dans les dimensions, préserve le rapport d'aspect
- `fill` — Étire aux dimensions exactes (ignore le rapport d'aspect)
- `inside` — Redimensionne pour tenir, sans jamais agrandir
- `outside` — Redimensionne pour couvrir, sans jamais réduire

### Conversion de format
| Paramètre | Type | Description | Exemple |
|-----------|------|-------------|---------|
| `format` | chaîne | Format de sortie | `?format=auto` |
| `q` | entier | Qualité (1-100) | `?q=80` |

**Valeurs de `format` :**
- `auto` — Sert AVIF, WebP ou l'original selon l'en-tête `Accept` du navigateur
- `webp` — Force la sortie WebP
- `avif` — Force la sortie AVIF
- `png` — Force la sortie PNG
- `jpeg` — Force la sortie JPEG

### Effets
| Paramètre | Type | Description | Exemple |
|-----------|------|-------------|---------|
| `blur` | entier | Flou gaussien (1-250) | `?blur=20` |
| `sharpen` | entier | Netteté (1-10) | `?sharpen=3` |
| `gravity` | chaîne | Point d'ancrage du recadrage | `?gravity=face` |

**Valeurs de `gravity` :** `center`, `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `face` (détection par IA).

### Chaînage des paramètres
Combinez plusieurs paramètres avec `&` :
```
https://cloudcdn.pro/projet/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP (Low Quality Image Placeholder)
Génère un minuscule espace réservé flou pour le chargement progressif :
```
https://cloudcdn.pro/projet/image.png?w=40&blur=50&q=20
```
Cela produit un espace réservé d'environ 500 octets qui peut être intégré sous forme de data URI base64.

## Manifeste des actifs

### GET /manifest.json
Retourne un tableau JSON de tous les actifs du CDN.

**Réponse :**
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

**Champs :**
| Champ | Type | Description |
|-------|------|-------------|
| `name` | chaîne | Nom du fichier |
| `path` | chaîne | Chemin complet relatif à la racine du CDN |
| `project` | chaîne | Nom du répertoire de projet |
| `category` | chaîne | Catégorie de sous-répertoire (banners, icons, logos, etc.) |
| `format` | chaîne | Extension du fichier (png, webp, avif, svg, ico) |
| `size` | entier | Taille du fichier en octets |

**Mise en cache :** `max-age=300` (5 minutes), CORS activé.

## En-têtes HTTP

### Réponses d'actifs
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### Réponses d'erreur
| Statut | Signification |
|--------|---------------|
| `200` | Succès |
| `304` | Non modifié (requête conditionnelle) |
| `404` | Actif introuvable |
| `429` | Limite de débit dépassée (API Concierge uniquement) |

## Purge du cache (Pro et supérieur)

### Via le tableau de bord Cloudflare
Workers & Pages → cloudcdn-pro → Caching → Purge by URL.

### Via l'API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/projet/image.webp"]}'
```

## Limites de débit
| Endpoint | Limite |
|----------|--------|
| Diffusion d'actifs | Illimité (edge Cloudflare) |
| Manifest.json | Illimité (cache de 5 min) |
| Chat du Concierge | 1 000 requêtes/mois |
| Transformations d'images (Pro) | 50 000/mois |
| Transformations d'images (Enterprise) | Illimité |

## SDK et intégrations

### HTML (responsive avec repli de format)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML (palier Pro avec auto-format)
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

// Composant
import Image from 'next/image';
<Image src="https://cloudcdn.pro/projet/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/projet/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/projet/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/projet/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/projet/images/logos/logo.webp)
```
