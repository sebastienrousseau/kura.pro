# CloudCDN — Guide d'installation

## Prérequis
- Git (version 2.34 ou plus récente recommandée)
- Clé SSH pour les commits signés (Ed25519 recommandée)
- Un compte GitHub avec accès au dépôt

## Démarrage rapide (toutes plateformes)

### 1. Cloner le dépôt
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. Créer votre répertoire de projet
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. Ajouter vos actifs
Placez vos fichiers PNG, SVG ou WebP dans le sous-répertoire approprié :
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. Committer et pousser
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. Accéder à vos actifs
Vos fichiers sont désormais disponibles à :
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (généré automatiquement)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (généré automatiquement)
```

## Notes spécifiques aux plateformes

### macOS
Installez Git via Homebrew s'il n'est pas déjà présent :
```bash
brew install git
```

Générez une clé SSH de signature :
```bash
ssh-keygen -t ed25519 -C "vous@email.com"
```

Configurez Git pour les commits signés :
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "vous@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Arch/CachyOS)
```bash
sudo pacman -S git openssh
ssh-keygen -t ed25519 -C "vous@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### WSL2 (Windows Subsystem for Linux)
Ouvrez votre terminal WSL2 (Ubuntu recommandé) :
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "vous@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Ajoutez votre clé SSH à l'agent ssh :
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## Convention de répertoires
Suivez cette structure pour assurer la cohérence :
```
my-project/
  images/
    banners/       # Graphismes au format large (1200x630 recommandé)
    icons/         # Icônes multi-résolution (de 16x16 à 512x512)
    logos/         # Logos de marque et emblèmes
    github/        # Actifs spécifiques à GitHub (aperçu social, etc.)
    titles/        # Graphismes de titres et en-têtes
  README.md        # Description optionnelle du projet
```

## Optimisation automatique des images
Lorsque vous poussez des fichiers PNG ou JPEG, le pipeline CI/CD effectue automatiquement :
1. La génération d'une variante WebP (qualité 80) — environ 60 % plus légère
2. La génération d'une variante AVIF (qualité 65) — environ 70 % plus légère
3. La mise à jour du manifeste des actifs (`manifest.json`)
4. Le déploiement de toutes les variantes sur le réseau edge mondial

Vous n'avez pas besoin de créer manuellement les fichiers WebP ou AVIF.

## Utilisation des URL du CDN dans vos projets

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
