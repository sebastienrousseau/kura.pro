# CloudCDN — Referencia de la API

## URL base
```
https://cloudcdn.pro
```

## Formato de URL de los activos
```
https://cloudcdn.pro/{proyecto}/images/{categoria}/{nombre-archivo}.{formato}
```

Ejemplo:
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## API de transformación de imágenes (plan Pro y superior)

Añade parámetros de consulta a cualquier URL de activo para transformar la imagen al vuelo.

### Redimensionado
| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `w` | entero | Ancho en píxeles (1-8192) | `?w=800` |
| `h` | entero | Alto en píxeles (1-8192) | `?h=600` |
| `fit` | cadena | Comportamiento del redimensionado | `?fit=cover` |

**Modos de `fit`:**
- `cover` — Redimensiona para cubrir las dimensiones, recortando el sobrante (predeterminado)
- `contain` — Redimensiona para encajar dentro de las dimensiones, conservando la relación de aspecto
- `fill` — Estira a las dimensiones exactas (ignora la relación de aspecto)
- `inside` — Redimensiona para encajar, sin ampliar nunca
- `outside` — Redimensiona para cubrir, sin reducir nunca

### Conversión de formato
| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `format` | cadena | Formato de salida | `?format=auto` |
| `q` | entero | Calidad (1-100) | `?q=80` |

**Valores de `format`:**
- `auto` — Sirve AVIF, WebP o el original según la cabecera `Accept` del navegador
- `webp` — Fuerza salida WebP
- `avif` — Fuerza salida AVIF
- `png` — Fuerza salida PNG
- `jpeg` — Fuerza salida JPEG

### Efectos
| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `blur` | entero | Desenfoque gaussiano (1-250) | `?blur=20` |
| `sharpen` | entero | Enfoque (1-10) | `?sharpen=3` |
| `gravity` | cadena | Punto de anclaje del recorte | `?gravity=face` |

**Valores de `gravity`:** `center`, `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `face` (detección por IA).

### Encadenando parámetros
Combina varios parámetros con `&`:
```
https://cloudcdn.pro/proyecto/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP (marcador de imagen de baja calidad)
Genera un pequeño marcador desenfocado para la carga progresiva:
```
https://cloudcdn.pro/proyecto/image.png?w=40&blur=50&q=20
```
Esto produce un marcador de unos 500 bytes que puede incrustarse como data URI en base64.

## Manifiesto de activos

### GET /manifest.json
Devuelve un array JSON con todos los activos del CDN.

**Respuesta:**
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

**Campos:**
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | cadena | Nombre del archivo |
| `path` | cadena | Ruta completa relativa a la raíz del CDN |
| `project` | cadena | Nombre del directorio del proyecto |
| `category` | cadena | Categoría del subdirectorio (banners, icons, logos, etc.) |
| `format` | cadena | Extensión del archivo (png, webp, avif, svg, ico) |
| `size` | entero | Tamaño del archivo en bytes |

**Caché:** `max-age=300` (5 minutos), CORS habilitado.

## Cabeceras HTTP

### Respuestas de activos
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### Respuestas de error
| Estado | Significado |
|--------|-------------|
| `200` | Éxito |
| `304` | No modificado (solicitud condicional) |
| `404` | Activo no encontrado |
| `429` | Límite de tasa superado (solo API del Concierge) |

## Purga de caché (Pro y superior)

### A través del panel de Cloudflare
Workers & Pages → cloudcdn-pro → Caching → Purge by URL.

### A través de la API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/proyecto/image.webp"]}'
```

## Límites de tasa
| Endpoint | Límite |
|----------|--------|
| Entrega de activos | Ilimitada (edge de Cloudflare) |
| Manifest.json | Ilimitado (caché de 5 min) |
| Chat del Concierge | 1.000 consultas/mes |
| Transformaciones de imágenes (Pro) | 50.000/mes |
| Transformaciones de imágenes (Enterprise) | Ilimitadas |

## SDK e integraciones

### HTML (responsivo con respaldo de formato)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML (plan Pro con auto-formato)
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
<Image src="https://cloudcdn.pro/proyecto/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/proyecto/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/proyecto/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/proyecto/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/proyecto/images/logos/logo.webp)
```
