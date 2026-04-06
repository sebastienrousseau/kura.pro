# Acerca de CloudCDN

## ¿Qué es CloudCDN?
CloudCDN es una red de entrega de activos estáticos nativa de Git pensada para desarrolladores. Sube imágenes a un repositorio de GitHub y se optimizan automáticamente para luego servirse globalmente desde la red edge de Cloudflare: más de 300 centros de datos, más de 100 países y latencia inferior a 100 ms.

A diferencia de los CDN de imágenes tradicionales que requieren paneles de control, API de subida o integraciones con SDK, CloudCDN utiliza el flujo de trabajo que los desarrolladores ya conocen: `git push`.

## Cómo funciona
1. **Subir:** Añade imágenes al repositorio de GitHub y haz commit con una clave firmada.
2. **Optimizar:** GitHub Actions comprime automáticamente las imágenes y genera variantes WebP (calidad 80, ~60 % más ligeras) y AVIF (calidad 65, ~70 % más ligeras).
3. **Desplegar:** Los archivos modificados se suben a Cloudflare Pages mediante despliegue incremental (deduplicación por hash de contenido: solo se transfieren archivos nuevos o modificados).
4. **Entregar:** Los activos se sirven con cabeceras de caché inmutables (`max-age=31536000`) desde el punto edge más cercano entre los más de 300 disponibles.

## Stack tecnológico
- **Red edge:** Cloudflare Pages en más de 300 PoP globales. El 95 % de la población mundial se encuentra a menos de 50 ms de un centro de datos de Cloudflare.
- **Formatos de imagen:** PNG (original sin pérdida), WebP (con pérdida, calidad 80), AVIF (con pérdida, calidad 65), SVG (sin procesar), ICO (sin procesar).
- **Negociación de formato:** El plan Pro sirve el formato óptimo según la cabecera `Accept` del navegador (AVIF > WebP > original).
- **Caché:** Caché inmutable en el edge y en el navegador con max-age de un año. Invalidación mediante cambio de nombre o ruta de archivo.
- **CI/CD:** GitHub Actions para compresión (Sharp), generación del manifiesto y despliegue en Cloudflare Pages (Wrangler).
- **Seguridad:** Commits firmados con SSH Ed25519 obligatorios. Protección de rama en `main`. Tokens de API cifrados mediante GitHub Secrets.
- **Concierge IA:** Cloudflare Workers AI (Llama 3.1) + Vectorize RAG para búsqueda inteligente en la documentación desde la página de inicio.

## Rendimiento
- **TTFB:** Mediana inferior a 50 ms en Norteamérica y Europa, inferior a 100 ms a escala global (en aciertos del caché edge de Cloudflare).
- **Ratio de aciertos de caché:** Superior al 95 % en activos de producción (caché inmutable).
- **Velocidad de despliegue:** Subidas incrementales: solo se transfieren los archivos modificados. Despliegue típico: entre 5 y 30 segundos.
- **Compresión:** WebP ahorra aproximadamente un 60 % frente a PNG. AVIF ahorra aproximadamente un 70 % frente a PNG. Ambos se generan automáticamente.

## Organización de activos
```
project-name/
  images/
    banners/    — Gráficos de formato ancho (1200x630 recomendado)
    icons/      — Multirresolución (de 16x16 a 512x512, con @2x/@3x)
    logos/      — Logotipos y marcas corporativas
    github/     — Imágenes para vista previa en redes sociales
    titles/     — Títulos y cabeceras gráficas
  README.md     — Descripción opcional del proyecto
```

## Métricas clave
- **Más de 1.400 activos optimizados** distribuidos en 54 zonas de inquilinos.
- **Una única fuente por imagen** – las variantes se generan bajo demanda a través de `/api/transform`.
- **Más de 300 PoP edge** en más de 100 países.
- **TTFB global inferior a 100 ms** en aciertos de caché edge.
- **Sin paso de compilación** – sin `npm install`, sin webpack, sin framework necesario.

## ¿Quién usa CloudCDN?
CloudCDN sirve activos para:
- **Proyectos de código abierto:** logotipos, banners, iconos y gráficos de documentación.
- **Herramientas para desarrolladores:** branding de desarrolladores de Rust, Python e IA (rustdev, pythondev, llamadev).
- **Plataformas fintech:** bibliotecas de activos para banca y computación cuántica.
- **Aplicaciones de audio:** visualizaciones de formas de onda y componentes de interfaz.
- **Generadores de sitios estáticos:** Shokunin, Kaishi y otros frameworks SSG.

## ¿Por qué no [competidor]?

| vs. Cloudinary | vs. Imgix | vs. Bunny CDN |
|---|---|---|
| Sin la complejidad del sistema de créditos | Sin facturación basada en créditos | Soporte AVIF incluido |
| Flujo de trabajo nativo de Git | Flujo de trabajo nativo de Git | Flujo de trabajo nativo de Git |
| Plan gratuito, sin tarjeta de crédito | Plan gratuito disponible | Sin expiración de prueba |
| Concierge IA integrado | Solo documentación estándar | Solo documentación estándar |

## Código abierto
La infraestructura del CDN es de código abierto bajo la licencia MIT. Repositorio: github.com/sebastienrousseau/cloudcdn.pro.

## Contacto
- **Soporte:** support@cloudcdn.pro
- **Ventas:** sales@cloudcdn.pro
- **GitHub:** github.com/sebastienrousseau/cloudcdn.pro
- **Estado:** cloudcdn.pro (la página de inicio muestra el estado operativo)
