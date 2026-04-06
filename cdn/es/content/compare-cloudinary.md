# CloudCDN frente a Cloudinary

## De un vistazo

| Característica | CloudCDN | Cloudinary |
|----------------|----------|------------|
| **Precio de entrada** | 29 $/mes (Pro) | 89 $/mes (Plus) |
| **Plan gratuito** | 10 GB/mes de ancho de banda | 25 créditos/mes (~5.000 transformaciones) |
| **Modelo de facturación** | Ancho de banda (GB) | Basado en créditos (complejo) |
| **Flujo de trabajo** | Nativo de Git (git push) | Subida por panel / SDK / API |
| **Auto-optimización** | WebP + AVIF + JXL en el push | Solo al vuelo |
| **Funciones de IA** | Búsqueda semántica + concierge RAG | Eliminación de fondo con IA, relleno generativo |
| **Commits firmados** | Obligatorios (integridad de la cadena de suministro) | No aplica |
| **Ubicaciones edge** | Más de 300 (Cloudflare) | Unos 60 PoP de CDN |
| **TTFB** | Mediana inferior a 50 ms (NA/EU) | Habitualmente 80-120 ms |
| **Dominios personalizados** | 5 (Pro), ilimitados (Enterprise) | Ilimitados (planes de pago) |
| **SLA** | 99,9 % (Pro), 99,99 % (Enterprise) | 99,9 % (Business y superior) |
| **SSO/SAML** | Enterprise | Enterprise |
| **Servidor MCP** | Integrado (integración con agentes de IA) | No disponible |
| **Procedencia de activos** | Criptográfica (commits Git firmados) | Solo marca de tiempo de subida |

## Cuándo elegir CloudCDN

- Quieres un **flujo de trabajo nativo de Git**: sin panel, sin SDK, solo `git push`
- Necesitas **procedencia criptográfica** para cada activo (cumplimiento, pista de auditoría)
- Quieres una **facturación sencilla por ancho de banda** (sin matemáticas de créditos)
- Sirves **activos estáticos** (logotipos, iconos, banners, imágenes) y buscas un TTFB inferior a 50 ms
- Quieres **búsqueda de activos con IA** y un **servidor MCP** para flujos dirigidos por agentes

## Cuándo elegir Cloudinary

- Necesitas **IA avanzada para imágenes** (eliminación de fondo, relleno generativo, recorte automático)
- Necesitas **transcodificación de vídeo** con streaming adaptativo
- Necesitas **más de 400 parámetros de transformación** para pipelines de imágenes complejos
- Ya tienes una integración existente con Cloudinary mediante SDK

## Comparación de costes

Para un sitio que sirve 50 GB/mes de activos estáticos:

- **CloudCDN Pro**: 29 $/mes plano
- **Cloudinary Plus**: 89 $/mes + posible exceso en créditos

Para 200 GB/mes:

- **CloudCDN Pro**: 29 $ + (100 GB de exceso × 0,05 $) = 34 $/mes
- **Cloudinary Advanced**: 224 $/mes
