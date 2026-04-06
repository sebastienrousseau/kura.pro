# CloudCDN — Guida al setup

## Prerequisiti
- Git (raccomandato 2.34+)
- Chiave SSH per i commit firmati (Ed25519 raccomandato)
- Un account GitHub con accesso al repository

## Avvio rapido (tutte le piattaforme)

### 1. Clona il repository
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. Crea la directory del tuo progetto
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. Aggiungi i tuoi asset
Posiziona i tuoi file PNG, SVG o WebP nella sottodirectory appropriata:
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. Commit e push
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. Accedi ai tuoi asset
I tuoi file sono ora disponibili a:
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (generato automaticamente)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (generato automaticamente)
```

## Note specifiche per piattaforma

### macOS
Installa Git tramite Homebrew se non è già presente:
```bash
brew install git
```

Genera una chiave di firma SSH:
```bash
ssh-keygen -t ed25519 -C "your@email.com"
```

Configura Git per i commit firmati:
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
Apri il tuo terminale WSL2 (Ubuntu raccomandato):
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Aggiungi la tua chiave SSH all'ssh-agent:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## Convenzione delle directory
Segui questa struttura per coerenza:
```
my-project/
  images/
    banners/       # Grafica in formato largo (1200x630 raccomandato)
    icons/         # Icone multi-risoluzione (da 16x16 a 512x512)
    logos/          # Loghi del brand
    github/        # Asset specifici di GitHub (social preview, ecc.)
    titles/        # Grafica per titoli e header
  README.md        # Descrizione opzionale del progetto
```

## Ottimizzazione automatica delle immagini
Quando carichi file PNG o JPEG, la pipeline CI/CD automaticamente:
1. Genera una variante WebP (qualità 80) — ~60% più piccola
2. Genera una variante AVIF (qualità 65) — ~70% più piccola
3. Aggiorna il manifest degli asset (`manifest.json`)
4. Distribuisce tutte le varianti sulla rete edge globale

Non è necessario creare file WebP o AVIF manualmente.

## Utilizzo degli URL CDN nei tuoi progetti

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
