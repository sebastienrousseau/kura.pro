# CloudCDN — Guia de configuração

## Pré-requisitos
- Git (recomendado 2.34+)
- Chave SSH para commits assinados (Ed25519 recomendado)
- Uma conta GitHub com acesso ao repositório

## Início rápido (todas as plataformas)

### 1. Clone o repositório
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. Crie o diretório do seu projeto
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. Adicione seus ativos
Coloque seus arquivos PNG, SVG ou WebP no subdiretório apropriado:
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

### 5. Acesse seus ativos
Seus arquivos agora estão disponíveis em:
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (gerado automaticamente)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (gerado automaticamente)
```

## Notas específicas da plataforma

### macOS
Instale o Git via Homebrew se ainda não estiver presente:
```bash
brew install git
```

Gere uma chave de assinatura SSH:
```bash
ssh-keygen -t ed25519 -C "your@email.com"
```

Configure o Git para commits assinados:
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
Abra seu terminal WSL2 (Ubuntu recomendado):
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Adicione sua chave SSH ao ssh-agent:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## Convenção de diretórios
Siga esta estrutura para consistência:
```
my-project/
  images/
    banners/       # Gráficos em formato amplo (1200x630 recomendado)
    icons/         # Ícones multi-resolução (de 16x16 a 512x512)
    logos/          # Logos da marca
    github/        # Ativos específicos do GitHub (social preview, etc.)
    titles/        # Gráficos de títulos e cabeçalhos
  README.md        # Descrição opcional do projeto
```

## Otimização automática de imagens
Quando você envia arquivos PNG ou JPEG, o pipeline CI/CD automaticamente:
1. Gera uma variante WebP (qualidade 80) — ~60% menor
2. Gera uma variante AVIF (qualidade 65) — ~70% menor
3. Atualiza o manifesto de ativos (`manifest.json`)
4. Faz deploy de todas as variantes na rede de edge global

Você não precisa criar arquivos WebP ou AVIF manualmente.

## Usando URLs do CDN em seus projetos

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
