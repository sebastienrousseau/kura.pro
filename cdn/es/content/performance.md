# CloudCDN — Rendimiento

## Red edge
CloudCDN se basa en la red global de Cloudflare:
- **Más de 300 centros de datos** en más de 100 países y más de 193 ciudades.
- **El 95 % de la población mundial** se encuentra a menos de 50 ms de un PoP de Cloudflare.
- **Más de 8.000 interconexiones de red** para un enrutamiento óptimo.
- El enrutamiento anycast dirige las solicitudes automáticamente al PoP más cercano.

## Latencia
| Región | TTFB mediano (acierto de caché) | TTFB P95 |
|--------|----------------------------------|----------|
| Norteamérica | < 30 ms | < 80 ms |
| Europa | < 35 ms | < 90 ms |
| Asia-Pacífico | < 50 ms | < 120 ms |
| Sudamérica | < 60 ms | < 150 ms |
| África | < 80 ms | < 200 ms |

Estos son tiempos de acierto de caché edge. La primera solicitud a un PoP requiere una obtención desde el origen (añade entre 50 y 200 ms una sola vez).

## Estrategia de caché
Todos los activos usan caché inmutable agresiva:
```
Cache-Control: public, max-age=31536000, immutable
```

Esto significa:
- **Caché del navegador:** 1 año. Sin solicitudes de revalidación.
- **Caché edge del CDN:** 1 año. Servida desde el PoP más cercano.
- **Ratio de aciertos de caché:** superior al 95 % en activos de producción.
- **Invalidación de caché:** cambia el nombre o la ruta del archivo para servir activos actualizados.

El manifest.json usa caché de corta duración:
```
Cache-Control: public, max-age=300
```

## Compresión de imágenes

### Comparación de formatos
| Formato | Tamaño típico (vs PNG) | Soporte de navegador | Caso de uso |
|---------|------------------------|----------------------|-------------|
| PNG | Base (100 %) | 100 % | Sin pérdida, transparencia |
| WebP | ~40 % del PNG | 97 % | Entrega web general |
| AVIF | ~30 % del PNG | 93 % | Compresión máxima |
| SVG | Variable | 100 % | Gráficos vectoriales, iconos |

### Ajustes de conversión automática
- **WebP:** calidad 80, con pérdida. Mejor equilibrio entre calidad y tamaño.
- **AVIF:** calidad 65, con pérdida. Compresión máxima con buena fidelidad visual.
- Los originales (PNG/JPEG) siempre se conservan junto con las variantes generadas.

### Ahorros reales
Para un proyecto típico con 50 iconos (de 16x16 a 512x512):
- PNG total: ~5 MB
- WebP total: ~2 MB (reducción del 60 %)
- AVIF total: ~1,5 MB (reducción del 70 %)

Para imágenes de banner (1200x630):
- PNG: ~500 KB de media
- WebP: ~150 KB de media
- AVIF: ~90 KB de media

## Impacto en los Core Web Vitals
Servir imágenes optimizadas a través de CloudCDN mejora directamente:

### LCP (Largest Contentful Paint)
- Objetivo: inferior a 2,5 segundos.
- Impacto: servir AVIF en lugar de PNG puede reducir el LCP entre un 40 y un 60 % en páginas con muchas imágenes.
- Consejo: precarga las imágenes above the fold con `<link rel="preload" as="image">`.

### CLS (Cumulative Layout Shift)
- Objetivo: inferior a 0,1.
- Impacto: define siempre los atributos `width` y `height` en las etiquetas `<img>` para reservar espacio.
- Consejo: utiliza el campo `size` del manifest.json para los cálculos de diseño responsivo.

### INP (Interaction to Next Paint)
- Objetivo: inferior a 200 ms.
- Impacto: las imágenes más pequeñas implican menos trabajo de decodificación en el hilo principal.
- Consejo: utiliza `loading="lazy"` en las imágenes below the fold para reducir el peso inicial de la página.

## Rendimiento de despliegue
| Métrica | Valor |
|---------|-------|
| Despliegue incremental (1 a 10 archivos modificados) | 5 a 15 segundos |
| Despliegue completo (más de 10.000 archivos) | 30 a 60 segundos |
| Compresión de imagen (por PNG, CI) | ~200 ms |
| Generación del manifiesto (más de 10.000 activos) | menos de 5 segundos |

Los despliegues utilizan deduplicación por hash de contenido: solo se suben los archivos nuevos o modificados. Tras el despliegue inicial, los push posteriores normalmente solo suben los archivos modificados.

## Monitorización
- **Cloudflare Analytics:** disponible en el panel de Cloudflare → Workers & Pages → cloudcdn-pro → Metrics.
- **GitHub Actions:** los registros de build y despliegue están en la pestaña Actions.
- **Estado:** la página de inicio (cloudcdn.pro) muestra el estado operativo.

## Consejos de optimización
1. **Usa URL de AVIF** siempre que sea posible: son un 70 % más ligeras que las de PNG.
2. **Usa el elemento `<picture>`** para el respaldo de formato (AVIF → WebP → PNG).
3. **Precarga las imágenes críticas** above the fold.
4. **Carga en diferido todo lo que esté below the fold** con `loading="lazy"`.
5. **Define dimensiones explícitas** en todas las etiquetas `<img>` para evitar saltos de diseño.
6. **Usa el tamaño de icono más pequeño necesario**: no sirvas 512x512 cuando basta con 64x64.
7. **Plan Pro:** usa `?format=auto` para que CloudCDN sirva automáticamente el formato óptimo.
