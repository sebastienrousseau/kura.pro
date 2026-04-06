# CloudCDN — セットアップガイド

## 前提条件
- Git(2.34 以上を推奨)
- 署名付きコミット用の SSH キー(Ed25519 を推奨)
- リポジトリへのアクセス権を持つ GitHub アカウント

## クイックスタート(全プラットフォーム)

### 1. リポジトリをクローンする
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. プロジェクトディレクトリを作成する
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. アセットを追加する
PNG、SVG、または WebP ファイルを適切なサブディレクトリに配置します:
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. コミットしてプッシュする
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. アセットにアクセスする
ファイルは次の URL で利用できます:
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (自動生成)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (自動生成)
```

## プラットフォーム別の注意事項

### macOS
Git がまだない場合は Homebrew でインストール:
```bash
brew install git
```

SSH 署名キーを生成:
```bash
ssh-keygen -t ed25519 -C "あなた@email.com"
```

署名付きコミット用に Git を設定:
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux(Ubuntu/Debian)
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "あなた@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux(Arch/CachyOS)
```bash
sudo pacman -S git openssh
ssh-keygen -t ed25519 -C "あなた@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### WSL2(Windows Subsystem for Linux)
WSL2 ターミナル(Ubuntu 推奨)を開きます:
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "あなた@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

SSH キーを ssh-agent に追加:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## ディレクトリ構造の規約
一貫性を保つため、次の構造に従ってください:
```
my-project/
  images/
    banners/       # ワイドフォーマットのグラフィック(1200x630 推奨)
    icons/         # マルチ解像度アイコン(16x16 から 512x512 まで)
    logos/         # ブランドロゴとマーク
    github/        # GitHub 専用アセット(ソーシャルプレビューなど)
    titles/        # タイトルグラフィックとヘッダー
  README.md        # 任意のプロジェクト説明
```

## 自動画像最適化
PNG または JPEG ファイルをプッシュすると、CI/CD パイプラインが自動的に次を実行します:
1. WebP バリアントの生成(品質 80) — 約 60% 軽量化
2. AVIF バリアントの生成(品質 65) — 約 70% 軽量化
3. アセットマニフェスト(`manifest.json`)の更新
4. すべてのバリアントをグローバルエッジネットワークにデプロイ

WebP や AVIF ファイルを手動で作成する必要はありません。

## プロジェクトでの CDN URL の使用

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
