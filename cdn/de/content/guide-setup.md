# CloudCDN — Einrichtungsleitfaden

## Voraussetzungen
- Git (Version 2.34 oder höher empfohlen)
- SSH-Schlüssel für signierte Commits (Ed25519 empfohlen)
- Ein GitHub-Konto mit Zugriff auf das Repository

## Schnellstart (alle Plattformen)

### 1. Repository klonen
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. Projektverzeichnis erstellen
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. Assets hinzufügen
Legen Sie Ihre PNG-, SVG- oder WebP-Dateien in das passende Unterverzeichnis:
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. Committen und pushen
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. Auf Ihre Assets zugreifen
Ihre Dateien sind nun verfügbar unter:
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (automatisch erzeugt)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (automatisch erzeugt)
```

## Plattformspezifische Hinweise

### macOS
Installieren Sie Git über Homebrew, falls noch nicht vorhanden:
```bash
brew install git
```

Erzeugen Sie einen SSH-Signaturschlüssel:
```bash
ssh-keygen -t ed25519 -C "ihre@email.com"
```

Konfigurieren Sie Git für signierte Commits:
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "ihre@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Arch/CachyOS)
```bash
sudo pacman -S git openssh
ssh-keygen -t ed25519 -C "ihre@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### WSL2 (Windows Subsystem for Linux)
Öffnen Sie Ihr WSL2-Terminal (Ubuntu empfohlen):
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "ihre@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Fügen Sie Ihren SSH-Schlüssel zum ssh-agent hinzu:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## Verzeichnis-Konvention
Folgen Sie dieser Struktur für Konsistenz:
```
my-project/
  images/
    banners/       # Breitformat-Grafiken (1200x630 empfohlen)
    icons/         # Multi-Auflösungs-Icons (16x16 bis 512x512)
    logos/         # Markenlogos und Wortmarken
    github/        # GitHub-spezifische Assets (Social-Preview usw.)
    titles/        # Titelgrafiken und Header
  README.md        # Optionale Projektbeschreibung
```

## Automatische Bildoptimierung
Wenn Sie PNG- oder JPEG-Dateien pushen, führt die CI/CD-Pipeline automatisch Folgendes aus:
1. Erzeugung einer WebP-Variante (Qualität 80) — ca. 60 % kleiner
2. Erzeugung einer AVIF-Variante (Qualität 65) — ca. 70 % kleiner
3. Aktualisierung des Asset-Manifests (`manifest.json`)
4. Deployment aller Varianten ins globale Edge-Netzwerk

Sie müssen WebP- oder AVIF-Dateien nicht manuell erstellen.

## CDN-URLs in Ihren Projekten verwenden

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
