# CloudCDN — Referência da API

## URL base
```
https://cloudcdn.pro
```

## Formato da URL dos ativos
```
https://cloudcdn.pro/{projeto}/images/{categoria}/{nome-do-arquivo}.{formato}
```

Exemplo:
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## API de transformação de imagens (plano Pro e superior)

Adicione parâmetros de consulta a qualquer URL de ativo para transformar a imagem em tempo real.

### Redimensionamento
| Parâmetro | Tipo | Descrição | Exemplo |
|-----------|------|-----------|---------|
| `w` | inteiro | Largura em pixels (1-8192) | `?w=800` |
| `h` | inteiro | Altura em pixels (1-8192) | `?h=600` |
| `fit` | string | Comportamento do redimensionamento | `?fit=cover` |

**Modos `fit`:**
- `cover` — Redimensiona para preencher as dimensões, recortando o excesso (padrão)
- `contain` — Redimensiona para caber nas dimensões mantendo as proporções
- `fill` — Estica até as dimensões exatas (ignora as proporções)
- `inside` — Redimensiona para caber, sem nunca aumentar
- `outside` — Redimensiona para cobrir, sem nunca diminuir

### Conversão de formato
| Parâmetro | Tipo | Descrição | Exemplo |
|-----------|------|-----------|---------|
| `format` | string | Formato de saída | `?format=auto` |
| `q` | inteiro | Qualidade (1-100) | `?q=80` |

**Valores de `format`:**
- `auto` — Serve AVIF, WebP ou o original com base no cabeçalho `Accept` do navegador
- `webp` — Força saída WebP
- `avif` — Força saída AVIF
- `png` — Força saída PNG
- `jpeg` — Força saída JPEG

### Efeitos
| Parâmetro | Tipo | Descrição | Exemplo |
|-----------|------|-----------|---------|
| `blur` | inteiro | Desfoque gaussiano (1-250) | `?blur=20` |
| `sharpen` | inteiro | Nitidez (1-10) | `?sharpen=3` |
| `gravity` | string | Ponto de ancoragem do recorte | `?gravity=face` |

**Valores de `gravity`:** `center`, `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `face` (detectado por IA).

### Encadeamento de parâmetros
Combine vários parâmetros com `&`:
```
https://cloudcdn.pro/projeto/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP (Low Quality Image Placeholder)
Gera um pequeno placeholder desfocado para carregamento progressivo:
```
https://cloudcdn.pro/projeto/image.png?w=40&blur=50&q=20
```
Isso produz um placeholder de cerca de 500 bytes que pode ser incorporado como URI de dados base64.

## Manifesto de ativos

### GET /manifest.json
Retorna um array JSON de todos os ativos no CDN.

**Resposta:**
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
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | string | Nome do arquivo |
| `path` | string | Caminho completo relativo à raiz do CDN |
| `project` | string | Nome do diretório do projeto |
| `category` | string | Categoria do subdiretório (banners, icons, logos, etc.) |
| `format` | string | Extensão do arquivo (png, webp, avif, svg, ico) |
| `size` | inteiro | Tamanho do arquivo em bytes |

**Cache:** `max-age=300` (5 minutos), CORS habilitado.

## Cabeçalhos HTTP

### Respostas de ativos
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### Respostas de erro
| Status | Significado |
|--------|-------------|
| `200` | Sucesso |
| `304` | Não modificado (requisição condicional) |
| `404` | Ativo não encontrado |
| `429` | Limite de taxa excedido (apenas API do Concierge) |

## Purga de cache (Pro e superior)

### Pelo painel do Cloudflare
Workers & Pages → cloudcdn-pro → Caching → Purge by URL.

### Pela API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/projeto/image.webp"]}'
```

## Limites de taxa
| Endpoint | Limite |
|----------|--------|
| Entrega de ativos | Ilimitado (edge Cloudflare) |
| Manifest.json | Ilimitado (cache de 5 minutos) |
| Chat do Concierge | 1.000 requisições/mês |
| Transformações de imagens (Pro) | 50.000/mês |
| Transformações de imagens (Enterprise) | Ilimitadas |

## SDKs e integração

### HTML (responsivo com fallback de formato)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML (plano Pro com auto-formato)
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
<Image src="https://cloudcdn.pro/projeto/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/projeto/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/projeto/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/projeto/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/projeto/images/logos/logo.webp)
```
