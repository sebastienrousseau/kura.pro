# CloudCDN 소개

## CloudCDN이란 무엇인가요?
CloudCDN은 개발자를 위한 Git 네이티브 정적 자산 전송 네트워크입니다. GitHub 저장소에 이미지를 푸시하면 자동으로 최적화되어 Cloudflare의 엣지 네트워크(300개 이상의 데이터 센터, 100개 이상의 국가, 100ms 미만의 지연 시간)에서 전 세계로 제공됩니다.

대시보드, 업로드 API 또는 SDK 통합이 필요한 기존 이미지 CDN과 달리, CloudCDN은 개발자가 이미 알고 있는 워크플로(`git push`)를 그대로 사용합니다.

## 작동 방식
1. **푸시:** GitHub 저장소에 이미지를 추가하고 서명된 키로 커밋합니다.
2. **최적화:** GitHub Actions가 이미지를 자동으로 압축하고 WebP(품질 80, 약 60% 더 작음) 및 AVIF(품질 65, 약 70% 더 작음) 변형을 생성합니다.
3. **배포:** 변경된 파일은 증분 배포를 통해 Cloudflare Pages에 업로드됩니다(콘텐츠 해시 중복 제거 — 새 파일이나 변경된 파일만 전송됨).
4. **전송:** 자산은 불변 캐시 헤더(`max-age=31536000`)와 함께 300개 이상의 엣지 위치 중 가장 가까운 곳에서 제공됩니다.

## 기술 스택
- **엣지 네트워크:** 전 세계 300개 이상의 PoP에 배포된 Cloudflare Pages. 세계 인구의 95%가 Cloudflare 데이터 센터로부터 50ms 이내에 위치합니다.
- **이미지 형식:** PNG(무손실 원본), WebP(손실 압축, 품질 80), AVIF(손실 압축, 품질 65), SVG(원본 그대로 전달), ICO(원본 그대로 전달).
- **형식 협상:** Pro 플랜은 브라우저의 `Accept` 헤더에 따라 최적의 형식을 제공합니다(AVIF > WebP > 원본).
- **캐싱:** 1년 max-age로 불변 엣지 및 브라우저 캐싱. 파일 이름이나 경로 변경을 통한 캐시 무효화.
- **CI/CD:** 압축(Sharp), 매니페스트 생성, Cloudflare Pages 배포(Wrangler)를 위한 GitHub Actions.
- **보안:** SSH Ed25519 서명된 커밋 필수. `main` 브랜치 보호. GitHub Secrets를 통한 암호화된 API 토큰.
- **AI 컨시어지:** 홈페이지에서 지능형 문서 검색을 위한 Cloudflare Workers AI(Llama 3.1) + Vectorize RAG.

## 성능
- **TTFB:** 북미/유럽에서 중앙값 50ms 미만, 전 세계적으로 100ms 미만(Cloudflare 엣지 캐시 적중).
- **캐시 적중률:** 프로덕션 자산에서 95% 이상(불변 캐싱).
- **배포 속도:** 증분 업로드 — 변경된 파일만 전송됩니다. 일반적인 배포: 5~30초.
- **압축:** WebP는 PNG 대비 약 60% 절약. AVIF는 PNG 대비 약 70% 절약. 둘 다 자동으로 생성됩니다.

## 자산 구성
```
project-name/
  images/
    banners/    — 와이드 형식 그래픽(1200x630 권장)
    icons/      — 멀티 해상도(16x16부터 512x512까지, @2x/@3x 포함)
    logos/      — 브랜드 로고와 마크
    github/     — 소셜 미리보기 이미지
    titles/     — 타이틀 그래픽과 헤더
  README.md     — 선택적 프로젝트 설명
```

## 주요 지표
- **1,400개 이상의 최적화된 자산**이 54개의 테넌트 영역에 분산되어 있습니다.
- **이미지당 단일 소스** — 파생 이미지는 `/api/transform`을 통해 요청 시 생성됩니다.
- 100개 이상의 국가에 분산된 **300개 이상의 엣지 PoP**.
- 엣지 캐시 적중 시 **글로벌 TTFB 100ms 미만**.
- **빌드 단계 없음** — `npm install`, webpack, 프레임워크 모두 불필요.

## CloudCDN을 사용하는 곳
CloudCDN은 다음과 같은 자산을 제공합니다:
- **오픈소스 프로젝트:** 로고, 배너, 아이콘, 문서 그래픽.
- **개발자 도구:** Rust, Python, AI 개발자 브랜딩(rustdev, pythondev, llamadev).
- **핀테크 플랫폼:** 뱅킹 및 양자 컴퓨팅 자산 라이브러리.
- **오디오 애플리케이션:** 파형 시각화와 UI 구성 요소.
- **정적 사이트 생성기:** Shokunin, Kaishi 및 기타 SSG 프레임워크.

## 왜 [경쟁사]가 아닌가요?

| vs Cloudinary | vs Imgix | vs Bunny CDN |
|---|---|---|
| 복잡한 크레딧 시스템 없음 | 크레딧 기반 청구 없음 | AVIF 지원 포함 |
| Git 네이티브 워크플로 | Git 네이티브 워크플로 | Git 네이티브 워크플로 |
| 무료 플랜, 신용카드 불필요 | 무료 플랜 사용 가능 | 평가판 만료 없음 |
| 내장 AI 컨시어지 | 표준 문서만 제공 | 표준 문서만 제공 |

## 오픈소스
CDN 인프라는 MIT 라이선스에 따라 오픈소스로 제공됩니다. 저장소: github.com/sebastienrousseau/cloudcdn.pro.

## 연락처
- **지원:** support@cloudcdn.pro
- **영업:** sales@cloudcdn.pro
- **GitHub:** github.com/sebastienrousseau/cloudcdn.pro
- **상태:** cloudcdn.pro(홈페이지에 운영 상태가 표시됨)
