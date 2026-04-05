# CloudCDN — Setup Guide

## Prerequisites
- Git (2.34+ recommended)
- SSH key for signed commits (Ed25519 recommended)
- A GitHub account with access to the repository

## Quick Start (All Platforms)

### 1. Clone the Repository
```bash
git clone git@github.com:sebastienrousseau/kura.pro.git
cd kura.pro
```

### 2. Create Your Project Directory
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. Add Your Assets
Place your PNG, SVG, or WebP files in the appropriate subdirectory:
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. Commit and Push
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. Access Your Assets
Your files are now available at:
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (auto-generated)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (auto-generated)
```

## Platform-Specific Notes

### macOS
Install Git via Homebrew if not already present:
```bash
brew install git
```

Generate an SSH signing key:
```bash
ssh-keygen -t ed25519 -C "your@email.com"
```

Configure Git for signed commits:
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Arch/CachyOS)
```bash
sudo pacman -S git openssh
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### WSL2 (Windows Subsystem for Linux)
Open your WSL2 terminal (Ubuntu recommended):
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Add your SSH key to the ssh-agent:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## Directory Convention
Follow this structure for consistency:
```
my-project/
  images/
    banners/       # Wide format graphics (1200x630 recommended)
    icons/         # Multi-resolution icons (16x16 through 512x512)
    logos/          # Brand logos and marks
    github/        # GitHub-specific assets (social preview, etc.)
    titles/        # Title graphics and headers
  README.md        # Optional project description
```

## Automatic Image Optimization
When you push PNG or JPEG files, the CI/CD pipeline automatically:
1. Generates a WebP variant (quality 80) — ~60% smaller
2. Generates an AVIF variant (quality 65) — ~70% smaller
3. Updates the asset manifest (`manifest.json`)
4. Deploys all variants to the global edge network

You do not need to create WebP or AVIF files manually.

## Using CDN URLs in Your Projects

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
