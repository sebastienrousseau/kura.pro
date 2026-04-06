# CloudCDN frente a Imgix

## De un vistazo

| Característica | CloudCDN | Imgix |
|----------------|----------|-------|
| **Precio de entrada** | 29 $/mes (Pro) | 25 $/mes (Basic) |
| **Plan gratuito** | 10 GB/mes de ancho de banda | Ninguno |
| **Modelo de facturación** | Ancho de banda (GB) | Imágenes de origen + ancho de banda |
| **Flujo de trabajo** | Nativo de Git (git push) | Panel / API / SDK |
| **Auto-optimización** | WebP + AVIF + JXL en el push | Solo al vuelo |
| **Parámetros de transformación** | 9 (redimensionar, formato, blur, sharpen, gravity, fit, quality) | Más de 400 |
| **Funciones de IA** | Búsqueda semántica + concierge RAG + servidor MCP | Detección facial, recorte automático |
| **Commits firmados** | Obligatorios (integridad de la cadena de suministro) | No aplica |
| **Ubicaciones edge** | Más de 300 (Cloudflare) | CDN de Imgix (~50 PoP) |
| **TTFB** | Mediana inferior a 50 ms (NA/EU) | Habitualmente 60-100 ms |
| **JPEG XL** | Compatible (generado automáticamente en el push) | Compatible |
| **Procedencia de activos** | Criptográfica (commits Git firmados) | Ninguna |
| **Servidor MCP** | Integrado | No disponible |

## Cuándo elegir CloudCDN

- Quieres un **plan gratuito** (Imgix no lo tiene)
- Quieres un **flujo de trabajo nativo de Git** sin SDK
- Necesitas **procedencia criptográfica de activos** para cumplimiento
- Sirves principalmente activos de marca estáticos y no necesitas 400 parámetros de transformación
- Quieres **integración con agentes de IA** mediante MCP

## Cuándo elegir Imgix

- Necesitas **más de 400 parámetros de transformación** para pipelines complejos
- Necesitas **renderizado en tiempo real** de contenido subido por usuarios
- Necesitas **purga por patrón de URL** (basada en regex)
- Tus imágenes están almacenadas en S3/GCS y necesitas un proxy de procesamiento

## Comparación de costes

Para un sitio con 500 imágenes de origen y 50 GB/mes de entrega:

- **CloudCDN Pro**: 29 $/mes
- **Imgix Basic**: 25 $/mes + exceso de ancho de banda

Para más de 1.000 imágenes de origen:

- **CloudCDN Pro**: 29 $/mes (imágenes de origen ilimitadas)
- **Imgix Growth**: 95 $/mes (1.500 imágenes de origen incluidas)
