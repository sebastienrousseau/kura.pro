# CloudCDN — 设置指南

## 先决条件
- Git（推荐 2.34+）
- 用于签名提交的 SSH 密钥（推荐 Ed25519）
- 具有仓库访问权限的 GitHub 帐户

## 快速开始（所有平台）

### 1. 克隆仓库
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. 创建项目目录
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. 添加资源
将你的 PNG、SVG 或 WebP 文件放入相应的子目录：
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. 提交并推送
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. 访问你的资源
你的文件现在可以通过以下地址访问：
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  （自动生成）
https://cloudcdn.pro/my-project/images/logos/logo.avif  （自动生成）
```

## 平台特定说明

### macOS
如果尚未安装 Git，请通过 Homebrew 安装：
```bash
brew install git
```

生成 SSH 签名密钥：
```bash
ssh-keygen -t ed25519 -C "your@email.com"
```

为签名提交配置 Git：
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux（Ubuntu/Debian）
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux（Arch/CachyOS）
```bash
sudo pacman -S git openssh
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### WSL2（Windows Subsystem for Linux）
打开你的 WSL2 终端（推荐 Ubuntu）：
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

将你的 SSH 密钥添加到 ssh-agent：
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## 目录约定
为保持一致性，请遵循以下结构：
```
my-project/
  images/
    banners/       # 宽幅图形（推荐 1200x630）
    icons/         # 多分辨率图标（16x16 到 512x512）
    logos/          # 品牌徽标和标识
    github/        # GitHub 特定资源（社交预览等）
    titles/        # 标题图形和页眉
  README.md        # 可选的项目描述
```

## 自动图像优化
当你推送 PNG 或 JPEG 文件时，CI/CD 管道会自动：
1. 生成 WebP 变体（质量 80）— 小约 60%
2. 生成 AVIF 变体（质量 65）— 小约 70%
3. 更新资源清单（`manifest.json`）
4. 将所有变体部署到全球边缘网络

你不需要手动创建 WebP 或 AVIF 文件。

## 在你的项目中使用 CDN URL

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
