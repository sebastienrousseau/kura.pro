# CloudCDN frente a Bunny CDN

## De un vistazo

| Característica | CloudCDN | Bunny CDN |
|----------------|----------|-----------|
| **Precio de entrada** | 29 $/mes (Pro) | 9,50 $/mes plano |
| **Plan gratuito** | 10 GB/mes de ancho de banda | Solo prueba de 14 días |
| **Modelo de facturación** | Tramos de ancho de banda | Por GB (precios por volumen desde 0,01 $/GB) |
| **Flujo de trabajo** | Nativo de Git (git push) | Panel / FTP / API |
| **Auto-optimización** | WebP + AVIF + JXL en el push | Bunny Optimizer (complemento aparte) |
| **API de almacenamiento** | Esquema JSON compatible con Bunny.net | Nativo |
| **Funciones de IA** | Búsqueda semántica + concierge RAG + servidor MCP | Ninguna |
| **Commits firmados** | Obligatorios (integridad de la cadena de suministro) | No aplica |
| **Ubicaciones edge** | Más de 300 (Cloudflare) | 114 PoP |
| **TTFB** | Mediana inferior a 50 ms (NA/EU) | Habitualmente 40-80 ms |
| **Edge Compute** | Cloudflare Workers (runtime JS completo) | Bunny Script (limitado) |
| **Perma-Cache** | Cabeceras inmutables de 1 año | Función Perma-Cache |
| **JPEG XL** | Compatible | No disponible en Optimizer |
| **Procedencia de activos** | Criptográfica (commits Git firmados) | Ninguna |
| **Servidor MCP** | Integrado | No disponible |

## Por qué CloudCDN usa API compatibles con Bunny

La API de almacenamiento de CloudCDN devuelve un esquema JSON compatible con Bunny.net (Guid, StorageZoneName, Path, ObjectName, etc.). Esto significa que las herramientas de migración y los scripts creados para Bunny funcionan con CloudCDN sin modificaciones.

## Cuándo elegir CloudCDN

- Quieres un **flujo de trabajo nativo de Git** (sin FTP, sin subidas por panel)
- Necesitas **búsqueda con IA** e **integración con agentes** (MCP)
- Necesitas **procedencia criptográfica** para cada activo
- Quieres **generación automática de JPEG XL** además de WebP y AVIF
- Quieres un **plan gratuito permanente** (la prueba de Bunny expira)

## Cuándo elegir Bunny CDN

- Necesitas el **precio por GB más bajo posible** (0,01 $/GB en algunas regiones)
- Necesitas **acceso FTP/SFTP** a tu almacenamiento
- Necesitas **Bunny Stream** para alojamiento de vídeo
- Tienes un volumen de tráfico muy alto (más de 100 TB/mes) y necesitas descuentos por volumen
- Necesitas **protección DDoS** como complemento con reglas personalizadas

## Comparación de costes

Para un sitio que sirve 50 GB/mes:

- **CloudCDN Pro**: 29 $/mes
- **Bunny CDN**: ~2,50 $/mes (EU/US a 0,05 $/GB) + 0,50 $/mes de almacenamiento

Para 500 GB/mes:

- **CloudCDN Pro**: 29 $ + (400 GB × 0,05 $) = 49 $/mes
- **Bunny CDN**: ~25 $/mes (EU/US) + almacenamiento

Bunny gana en coste bruto de ancho de banda. CloudCDN gana en flujo de trabajo, funciones de IA, procedencia y plan gratuito.
