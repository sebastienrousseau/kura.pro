# CloudCDN — Guía de configuración

## Requisitos previos
- Git (versión 2.34 o superior recomendada)
- Clave SSH para commits firmados (Ed25519 recomendada)
- Una cuenta de GitHub con acceso al repositorio

## Inicio rápido (todas las plataformas)

### 1. Clonar el repositorio
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. Crear el directorio del proyecto
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. Añadir tus activos
Coloca tus archivos PNG, SVG o WebP en el subdirectorio adecuado:
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. Hacer commit y push
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. Acceder a tus activos
Tus archivos ya están disponibles en:
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (generado automáticamente)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (generado automáticamente)
```

## Notas específicas por plataforma

### macOS
Instala Git mediante Homebrew si aún no está presente:
```bash
brew install git
```

Genera una clave SSH de firma:
```bash
ssh-keygen -t ed25519 -C "tu@email.com"
```

Configura Git para commits firmados:
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "tu@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Arch/CachyOS)
```bash
sudo pacman -S git openssh
ssh-keygen -t ed25519 -C "tu@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### WSL2 (Windows Subsystem for Linux)
Abre tu terminal WSL2 (Ubuntu recomendado):
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "tu@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Añade tu clave SSH al ssh-agent:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## Convención de directorios
Sigue esta estructura para mantener la coherencia:
```
my-project/
  images/
    banners/       # Gráficos en formato ancho (1200x630 recomendado)
    icons/         # Iconos en varias resoluciones (de 16x16 a 512x512)
    logos/         # Logotipos y marcas
    github/        # Activos específicos de GitHub (vista previa social, etc.)
    titles/        # Gráficos de títulos y cabeceras
  README.md        # Descripción opcional del proyecto
```

## Optimización automática de imágenes
Cuando subes archivos PNG o JPEG, el pipeline de CI/CD realiza automáticamente:
1. Generación de una variante WebP (calidad 80) — ~60 % más ligera
2. Generación de una variante AVIF (calidad 65) — ~70 % más ligera
3. Actualización del manifiesto de activos (`manifest.json`)
4. Despliegue de todas las variantes en la red edge global

No necesitas crear archivos WebP o AVIF manualmente.

## Usar URL del CDN en tus proyectos

### HTML
```html
<picture>
  <source srcset="https://cloudcdn.pro/my-project/images/logos/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/my-project/images/logos/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/my-project/images/logos/logo.png" alt="Logo">
</picture>
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/my-project/images/logos/logo.webp)
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/my-project/images/banners/hero.webp');
}
```
