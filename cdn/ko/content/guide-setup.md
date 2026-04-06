# CloudCDN — 설정 가이드

## 사전 요구 사항
- Git (2.34+ 권장)
- 서명된 커밋용 SSH 키 (Ed25519 권장)
- 리포지토리 액세스 권한이 있는 GitHub 계정

## 빠른 시작 (모든 플랫폼)

### 1. 리포지토리 복제
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. 프로젝트 디렉터리 생성
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. 에셋 추가
PNG, SVG 또는 WebP 파일을 적절한 하위 디렉터리에 배치합니다:
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. 커밋 및 푸시
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. 에셋에 액세스
이제 파일을 다음에서 사용할 수 있습니다:
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (자동 생성됨)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (자동 생성됨)
```

## 플랫폼별 참고 사항

### macOS
이미 존재하지 않는 경우 Homebrew를 통해 Git을 설치합니다:
```bash
brew install git
```

SSH 서명 키를 생성합니다:
```bash
ssh-keygen -t ed25519 -C "your@email.com"
```

서명된 커밋을 위해 Git을 구성합니다:
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
WSL2 터미널을 엽니다 (Ubuntu 권장):
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

ssh-agent에 SSH 키를 추가합니다:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## 디렉터리 규칙
일관성을 위해 다음 구조를 따르십시오:
```
my-project/
  images/
    banners/       # 와이드 형식 그래픽 (1200x630 권장)
    icons/         # 다중 해상도 아이콘 (16x16부터 512x512까지)
    logos/          # 브랜드 로고 및 마크
    github/        # GitHub 전용 에셋 (소셜 미리보기 등)
    titles/        # 제목 그래픽 및 헤더
  README.md        # 선택적 프로젝트 설명
```

## 자동 이미지 최적화
PNG 또는 JPEG 파일을 푸시하면 CI/CD 파이프라인이 자동으로:
1. WebP 변형 생성 (품질 80) — ~60% 더 작음
2. AVIF 변형 생성 (품질 65) — ~70% 더 작음
3. 에셋 매니페스트 업데이트 (`manifest.json`)
4. 모든 변형을 글로벌 엣지 네트워크에 배포

WebP 또는 AVIF 파일을 수동으로 만들 필요가 없습니다.

## 프로젝트에서 CDN URL 사용

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
