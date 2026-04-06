# CloudCDN — Límites y cuotas

## Límites de archivos
| Límite | Valor |
|--------|-------|
| Tamaño máximo de archivo (entrega CDN) | 25 MB |
| Tamaño máximo de archivo (repositorio Git) | Sin límite estricto (GitHub LFS disponible) |
| Formatos de imagen admitidos | PNG, JPEG, WebP, AVIF, SVG, ICO |
| Formatos de vídeo admitidos | MP4 (≤ 25 MB) |
| Longitud máxima del nombre de archivo | 255 caracteres |
| Sensibilidad de URL a mayúsculas/minúsculas | Sí: las rutas distinguen mayúsculas de minúsculas |

## Límites de ancho de banda
| Plan | Ancho de banda mensual | Exceso |
|------|------------------------|--------|
| Gratis | 10 GB | El servicio se pausa hasta el mes siguiente |
| Pro | 100 GB | 0,05 $/GB |
| Enterprise | Ilimitado | No aplica |

El ancho de banda se mide como bytes entregados desde el edge a los usuarios finales. Las extracciones de origen, las transferencias de CI/CD y las llamadas a la API del Concierge no cuentan.

## Límites de despliegue
| Límite | Valor |
|--------|-------|
| Máximo de archivos por despliegue | 20.000 |
| Tamaño máximo de despliegue | Sin tope estricto (subidas incrementales) |
| Despliegues simultáneos | 1 (en cola si se solapan) |
| Frecuencia de despliegue | Sin límite (se activa con cada push a `main`) |

## Límites de transformación de imágenes (Pro y superior)
| Límite | Pro | Enterprise |
|--------|-----|------------|
| Transformaciones por mes | 50.000 | Ilimitadas |
| Dimensiones máximas de salida | 8192 × 8192 px | 8192 × 8192 px |
| Parámetro de calidad máximo | 100 | 100 |
| Radio máximo de desenfoque | 250 | 250 |
| Formatos de salida admitidos | auto, webp, avif, png, jpeg | auto, webp, avif, png, jpeg |

## Límites de API y de tasa
| Endpoint | Límite |
|----------|--------|
| Entrega de activos | Ilimitada (edge de Cloudflare) |
| manifest.json | Ilimitado (caché edge de 5 min) |
| API de chat del Concierge | 1.000 consultas/mes (todos los planes) |
| API de purga de caché (Pro y superior) | 1.000 purgas/día |

## Dominios personalizados
| Plan | Dominios personalizados |
|------|------------------------|
| Gratis | 0 |
| Pro | Hasta 5 |
| Enterprise | Ilimitados (incluyendo comodín) |

## Almacenamiento
No hay cuota de almacenamiento: puedes subir un número ilimitado de archivos al repositorio. El límite práctico corresponde a las recomendaciones de tamaño de repositorio de GitHub (idealmente menos de 5 GB, con GitHub LFS para repositorios más grandes).

## Conversión automática
| Límite | Valor |
|--------|-------|
| Formatos generados por subida | 2 (WebP + AVIF) |
| Conversiones simultáneas máximas (CI) | Según el runner de GitHub Actions (2 núcleos de CPU) |
| Tiempo de espera de conversión | 6 horas (límite de GitHub Actions) |

## Concierge IA
| Límite | Valor |
|--------|-------|
| Consultas mensuales | 1.000 |
| Consultas por sesión (cliente) | 100 |
| Historial de conversación | Solo sesión actual (no persistente) |
| Tamaño de la base de conocimiento | 5 documentos, ~30 fragmentos |
| Tokens máximos por respuesta | 512 |

## Qué ocurre al alcanzar los límites
- **Ancho de banda superado (Gratis):** los activos dejan de servirse hasta el mes siguiente. Aviso por correo al 80 %.
- **Ancho de banda superado (Pro):** el exceso se factura a 0,05 $/GB. Sin interrupción del servicio.
- **Límite del Concierge alcanzado:** el widget de chat se desactiva durante el resto del mes.
- **Límite de transformaciones alcanzado (Pro):** las transformaciones devuelven el formato original hasta el mes siguiente.
- **Archivo demasiado grande:** los archivos de más de 25 MB se excluyen del CDN pero permanecen en Git.
