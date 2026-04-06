# Precios de CloudCDN (2026)

## Comparación de planes

| Característica | Gratis | Pro (29 $/mes) | Enterprise (a medida) |
|----------------|--------|-----------------|------------------------|
| Ancho de banda | 10 GB/mes | 100 GB/mes | Ilimitado |
| Almacenamiento | Archivos ilimitados | Archivos ilimitados | Almacenamiento dedicado |
| Formatos de imagen | Conversión automática WebP + AVIF | WebP + AVIF + control de calidad | Suite completa + lotes |
| Transformaciones de imagen | Ninguna | Redimensionar, recortar, formato vía URL | API completa + procesamiento por lotes |
| Dominios personalizados | No incluidos | Hasta 5 (SSL automático) | Ilimitados |
| Analítica | Ninguna | Panel básico | Tiempo real por activo/región |
| Soporte | Comunidad / GitHub Issues | Correo prioritario (SLA 24 h) | Gestor dedicado + Slack |
| SLA | Best-effort (~99,9 %) | Garantía de disponibilidad del 99,9 % | 99,99 % + créditos económicos |
| Commits firmados | Obligatorios | Obligatorios | Obligatorios |
| SSO/SAML | No | No | Sí |
| Registros de auditoría | No | No | Sí |

## Plan gratuito (open source)
- **Público:** proyectos personales, software de código abierto, aficionados.
- **Coste:** 0 $/mes — gratis para siempre, sin tarjeta de crédito.
- **Ancho de banda:** 10 GB/mes. Los activos dejan de servirse vía CDN si se supera el límite (los archivos permanecen en git).
- **Activos:** archivos estáticos ilimitados (PNG, WebP, AVIF, SVG, ICO).
- **Auto-optimización:** cada PNG/JPEG subido se convierte automáticamente a WebP (calidad 80) y AVIF (calidad 65).
- **Entrega:** TTFB inferior a 100 ms desde los más de 300 PoP edge de Cloudflare. Caché inmutable (max-age de un año).
- **Limitaciones:** sin dominios personalizados, sin API de transformación de imágenes, sin panel de analítica.

## Plan Pro
- **Público:** proyectos comerciales, startups, sitios con mucho tráfico.
- **Coste:** 29 $/mes (o 278 $/año — ahorra un 20 %).
- **Ancho de banda:** 100 GB/mes incluidos. Exceso: 0,05 $/GB facturado al final del ciclo.
- **API de transformación de imágenes:** redimensiona, recorta y convierte al vuelo mediante parámetros de URL:
  ```
  https://cloudcdn.pro/proyecto/image.png?w=800&h=600&fit=cover&format=auto&q=80
  ```
- **Negociación de formato:** entrega automática de AVIF/WebP según la cabecera `Accept` del navegador.
- **Dominios personalizados:** hasta 5 dominios con aprovisionamiento automático de SSL.
- **Soporte prioritario:** soporte por correo con garantía de respuesta en 24 horas.
- **SLA:** disponibilidad del 99,9 %. En caso de incumplimiento, crédito de servicio del 10 % por cada 0,1 % por debajo del umbral.
- **Analítica:** ancho de banda, número de solicitudes, ratio de aciertos de caché, distribución de formatos.
- **14 días de prueba gratuita** con acceso completo. Sin tarjeta de crédito requerida.

## Plan Enterprise
- **Público:** plataformas globales, grupos de medios, comercio electrónico a gran escala.
- **Coste:** precios personalizados — contacta con sales@cloudcdn.pro.
- **Ancho de banda:** ilimitado con asignación edge dedicada.
- **Suite completa de API:** todas las transformaciones de Pro más procesamiento por lotes, notificaciones por webhook y subidas programáticas.
- **Dominios personalizados:** ilimitados con SSL comodín.
- **Soporte dedicado:** gestor de cuenta nominado, canal Slack privado, SLA de respuesta de 1 hora.
- **SLA:** disponibilidad del 99,99 %. Créditos económicos: 25 % por debajo del 99,99 %, 50 % por debajo del 99,9 %, 100 % por debajo del 99,0 %.
- **Seguridad:** SSO/SAML, registros de auditoría con retención de 12 meses, listas de IP permitidas.
- **Analítica:** panel en tiempo real con desgloses por activo, región y formato.
- **Cumplimiento:** DPA del RGPD disponible, opciones de residencia de datos (UE/EE. UU.).

## Cómo nos comparamos

| Proveedor | Plan gratuito | Entrada de pago | API de transformación |
|-----------|---------------|-----------------|------------------------|
| **CloudCDN** | 10 GB/mes | 29 $/mes (100 GB) | Sí (Pro y superior) |
| Cloudflare Images | 5.000 transformaciones/mes | Pago por uso | Sí |
| ImageKit | 25 GB/mes | 9 $/mes | Sí |
| Cloudinary | ~5.000 transformaciones/mes | 89 $/mes | Sí (más de 300 parámetros) |
| Bunny CDN | Prueba de 14 días | 9,50 $/mes plano | Limitado |
| Imgix | Ninguno | 25 $/mes | Sí |

**Nuestra ventaja:** sin paso de compilación, flujo de trabajo nativo de Git, conversión automática de formato al hacer push, asistente de documentación con IA y la red edge de más de 300 PoP de Cloudflare, todo incluido desde el plan gratuito.

## Facturación
- Facturación mensual por defecto. La facturación anual ahorra un 20 %.
- Plan gratuito: sin tarjeta de crédito, sin expiración de prueba.
- Prueba Pro: 14 días, acceso completo a las funciones, sin tarjeta de crédito.
- Exceso: facturado al final del ciclo, nunca interrumpe el servicio a mitad de ciclo.
- Cancela en cualquier momento. Sin contratos a largo plazo. Los datos siguen siendo accesibles durante 30 días tras la cancelación.

## Política de uso aceptable
CloudCDN está diseñado para servir activos estáticos: imágenes, iconos, fuentes y documentos. No está destinado al streaming de vídeo (archivos de más de 25 MB), la distribución de binarios de aplicaciones o el alojamiento de archivos. Las cuentas que excedan el uso aceptable serán contactadas para discutir un plan adecuado. Nunca suspendemos sin previo aviso.
