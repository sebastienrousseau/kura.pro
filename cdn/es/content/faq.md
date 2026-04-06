# CloudCDN — Preguntas frecuentes

## Primeros pasos

### ¿Qué es CloudCDN?
CloudCDN es un CDN de imágenes nativo de Git. Sube imágenes a un repositorio de GitHub y se optimizan automáticamente (WebP + AVIF) y se sirven globalmente desde las más de 300 ubicaciones edge de Cloudflare con una latencia inferior a 100 ms.

### ¿En qué se diferencia CloudCDN de Cloudinary o Imgix?
CloudCDN utiliza un flujo de trabajo nativo de Git: sin subidas por panel, sin SDK, sin sistemas de créditos. Haces `git push` y tus activos están en línea. Cloudinary utiliza facturación basada en créditos a partir de 89 $/mes en sus planes de pago. Imgix utiliza paquetes de créditos a partir de 25 $/mes. El plan Pro de CloudCDN cuesta 29 $/mes con facturación directa por ancho de banda.

### ¿CloudCDN es gratuito para proyectos de código abierto?
Sí. El plan gratuito es gratis para siempre con 10 GB/mes de ancho de banda. Sin tarjeta de crédito y sin expiración de prueba. Ideal para logotipos, banners, iconos y activos de documentación de proyectos OSS.

### ¿Necesito instalar algo?
No. Solo necesitas Git (2.34+) y una clave SSH para los commits firmados. Sin Node.js, sin gestores de paquetes, sin herramientas de compilación. El pipeline de CI/CD se encarga de toda la optimización de imágenes en el servidor.

## Formatos de archivo

### ¿Qué formatos de archivo se admiten?
Subida: PNG, JPEG, SVG, ICO, WebP. El pipeline genera automáticamente variantes WebP y AVIF para todas las subidas de PNG y JPEG. Los archivos SVG e ICO se sirven tal cual.

### ¿Qué ajustes de calidad se usan para la conversión automática?
WebP: calidad 80 (casi sin pérdida, ~60 % más ligero que el PNG). AVIF: calidad 65 (alta eficiencia, ~70 % más ligero que el PNG). Están optimizados para el mejor equilibrio entre calidad visual y tamaño de archivo.

### ¿Puedo anular los ajustes de calidad?
En el plan Pro, la API de transformación de imágenes admite calidad personalizada mediante parámetros de URL: `?q=90` para mayor calidad, `?q=50` para más compresión. El plan gratuito utiliza los ajustes predeterminados.

### ¿Y JPEG XL?
A fecha de 2026, JPEG XL está detrás de un flag en Chrome y Firefox, con soporte parcial en Safari. Añadiremos la conversión automática de JPEG XL cuando el soporte de los navegadores supere el 80 %. Actualmente, AVIF ofrece mejor compresión con una compatibilidad más amplia (más del 93 % de los navegadores).

### ¿Cuál es el tamaño máximo de archivo?
25 MB por archivo para la entrega vía CDN. Los archivos de más de 25 MB permanecen en el repositorio Git pero se excluyen del despliegue edge. Como referencia, un PNG 4K de alta calidad suele pesar entre 5 y 15 MB.

## Rendimiento

### ¿Qué tan rápida es la entrega de activos?
TTFB mediano inferior a 50 ms en Norteamérica y Europa, inferior a 100 ms a escala global. Los activos se sirven con cabeceras de caché inmutables (max-age de un año), por lo que las visitas repetidas se sirven directamente desde la caché del navegador.

### ¿Cómo funciona la caché?
Todos los activos se sirven con `Cache-Control: public, max-age=31536000, immutable`. Los navegadores y los edges del CDN almacenan en caché los archivos durante un año. Para actualizar un activo, cambia el nombre del archivo (por ejemplo, `logo-v2.webp`); es la estrategia estándar para invalidar la caché.

### ¿Cuál es el ratio de aciertos de caché?
Los activos en producción suelen tener un ratio de aciertos superior al 95 %. El archivo manifest.json se almacena en caché durante 5 minutos para mantenerse fresco. El panel nunca se almacena en caché.

### ¿Puedo purgar la caché manualmente?
Plan gratuito: las purgas de caché se hacen automáticamente al desplegar. Pro/Enterprise: puedes purgar URL específicas o patrones con comodín mediante el panel o la API de Cloudflare.

## API de transformación de imágenes (Pro y superior)

### ¿Cómo funciona la API de transformación?
Añade parámetros de URL a cualquier URL de activo:
```
https://cloudcdn.pro/proyecto/image.png?w=800&h=600&fit=cover&format=auto&q=80
```

### ¿Qué parámetros están disponibles?
- `w` — Ancho en píxeles (por ejemplo, `?w=400`)
- `h` — Alto en píxeles (por ejemplo, `?h=300`)
- `fit` — Modo de redimensionado: `cover`, `contain`, `fill`, `inside`, `outside`
- `format` — Formato de salida: `auto` (lo mejor para el navegador), `webp`, `avif`, `png`, `jpeg`
- `q` — Calidad: 1-100 (el valor por defecto varía según el formato)
- `blur` — Desenfoque gaussiano: 1-250 (por ejemplo, `?blur=20` para un marcador LQIP)
- `sharpen` — Enfoque: 1-10
- `gravity` — Anclaje del recorte: `center`, `north`, `south`, `east`, `west`, `face` (IA)

### ¿CloudCDN admite negociación automática de formato?
Sí (Pro y superior). Cuando usas `?format=auto`, CloudCDN lee la cabecera `Accept` del navegador y sirve AVIF (si es compatible), luego WebP, y luego el formato original. Esto garantiza que cada visitante recibe el archivo más pequeño posible.

## Configuración y flujo de trabajo

### ¿Cómo subo activos?
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cp my-logo.png cloudcdn.pro/my-project/images/logos/
cd cloudcdn.pro
git add my-project/
git commit -S -m "add my-project logo"
git push origin main
```
En 1 a 2 minutos, tu activo estará disponible en `https://cloudcdn.pro/my-project/images/logos/my-logo.webp`.

### ¿Puedo usar un dominio personalizado?
Los planes Pro y Enterprise admiten dominios personalizados. Los dominios personalizados obtienen aprovisionamiento automático de SSL y configuración CNAME mediante Cloudflare DNS. Contacta con support@cloudcdn.pro para configurarlo.

### ¿Funciona en macOS, Linux y WSL2?
Sí. En todas las plataformas con Git y SSH. Consulta la guía de configuración para instrucciones específicas de cada plataforma, incluida la generación de claves SSH y la configuración de la firma de Git.

## Seguridad

### ¿Son obligatorios los commits firmados?
Sí. Todas las subidas a la rama `main` requieren commits firmados (SSH Ed25519 o GPG). Esto garantiza que cada cambio de activo está verificado criptográficamente. Consulta la guía de seguridad para configurarlo.

### ¿Mis datos están seguros?
Los activos se sirven sobre HTTPS con TLS 1.3. El repositorio de origen está en GitHub con protección de rama. Cloudflare proporciona protección DDoS, WAF y mitigación de bots en todos los planes.

## Facturación

### ¿Cómo funciona la facturación por ancho de banda?
Gratis: 10 GB/mes. Pro: 100 GB/mes incluidos, exceso a 0,05 $/GB. Enterprise: ilimitado. El ancho de banda = total de bytes entregados desde el edge a los usuarios finales. Las extracciones de origen y las transferencias de CI/CD no cuentan.

### ¿Puedo subir o bajar de plan en cualquier momento?
Sí. Las subidas de plan tienen efecto inmediato (prorrateadas). Las bajadas de plan tienen efecto en el siguiente ciclo de facturación. Cancelable en cualquier momento, sin contratos.

### ¿Hay una prueba gratuita para Pro?
Sí. 14 días con acceso completo. Sin tarjeta de crédito requerida. Vuelve automáticamente al plan gratuito si no te suscribes.

### ¿Qué pasa si supero el ancho de banda del plan gratuito?
Los activos dejan de servirse desde el CDN durante el resto del mes. Permanecen en el repositorio Git y vuelven a servirse al inicio del mes siguiente. Recibirás un aviso por correo al alcanzar el 80 % de uso.

## Cumplimiento

### ¿CloudCDN cumple con el RGPD?
Sí. CloudCDN utiliza la infraestructura de Cloudflare, que procesa los datos de acuerdo con el RGPD. Ofrecemos un Acuerdo de Tratamiento de Datos (DPA) para clientes Enterprise. No se almacenan datos personales de usuarios: solo servimos archivos estáticos.

### ¿Dónde se almacenan los datos?
Los archivos de activos se almacenan en el repositorio de GitHub (EE. UU.) y se almacenan en caché en las más de 300 ubicaciones edge globales de Cloudflare. Las copias en caché expiran tras un año o con un nuevo despliegue.
