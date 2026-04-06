# CloudCDN — API 레퍼런스

## 기본 URL
```
https://cloudcdn.pro
```

## 에셋 URL 형식
```
https://cloudcdn.pro/{프로젝트}/images/{카테고리}/{파일명}.{형식}
```

예시:
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## 이미지 변환 API (Pro 플랜 이상)

모든 에셋 URL에 쿼리 매개변수를 추가하여 이미지를 즉시 변환할 수 있습니다.

### 크기 조정
| 매개변수 | 타입 | 설명 | 예시 |
|----------|------|------|------|
| `w` | 정수 | 너비 (픽셀, 1-8192) | `?w=800` |
| `h` | 정수 | 높이 (픽셀, 1-8192) | `?h=600` |
| `fit` | 문자열 | 크기 조정 방식 | `?fit=cover` |

**`fit` 모드:**
- `cover` — 치수를 채우도록 크기 조정하고 초과분은 잘라냄 (기본값)
- `contain` — 비율을 유지하면서 치수에 맞게 크기 조정
- `fill` — 정확한 치수까지 늘림 (비율 무시)
- `inside` — 맞도록 크기 조정하되 절대 확대하지 않음
- `outside` — 덮도록 크기 조정하되 절대 축소하지 않음

### 형식 변환
| 매개변수 | 타입 | 설명 | 예시 |
|----------|------|------|------|
| `format` | 문자열 | 출력 형식 | `?format=auto` |
| `q` | 정수 | 품질 (1-100) | `?q=80` |

**`format` 값:**
- `auto` — 브라우저의 `Accept` 헤더에 따라 AVIF, WebP 또는 원본 제공
- `webp` — WebP 출력 강제
- `avif` — AVIF 출력 강제
- `png` — PNG 출력 강제
- `jpeg` — JPEG 출력 강제

### 효과
| 매개변수 | 타입 | 설명 | 예시 |
|----------|------|------|------|
| `blur` | 정수 | 가우시안 블러 (1-250) | `?blur=20` |
| `sharpen` | 정수 | 선명도 (1-10) | `?sharpen=3` |
| `gravity` | 문자열 | 자르기 기준점 | `?gravity=face` |

**`gravity` 값:** `center`, `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `face` (AI 감지).

### 매개변수 체이닝
여러 매개변수를 `&`로 결합:
```
https://cloudcdn.pro/프로젝트/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP (Low Quality Image Placeholder)
점진적 로딩을 위한 작은 흐릿한 자리표시자 생성:
```
https://cloudcdn.pro/프로젝트/image.png?w=40&blur=50&q=20
```
약 500바이트의 자리표시자를 생성하며, base64 데이터 URI로 인라인 임베드할 수 있습니다.

## 에셋 매니페스트

### GET /manifest.json
CDN의 모든 에셋이 담긴 JSON 배열을 반환합니다.

**응답:**
```json
[
  {
    "name": "banner-akande.webp",
    "path": "akande/images/banners/banner-akande.webp",
    "project": "akande",
    "category": "banners",
    "format": "webp",
    "size": 10850
  }
]
```

**필드:**
| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | 문자열 | 파일명 |
| `path` | 문자열 | CDN 루트 기준 전체 경로 |
| `project` | 문자열 | 프로젝트 디렉터리 이름 |
| `category` | 문자열 | 하위 디렉터리 카테고리 (banners, icons, logos 등) |
| `format` | 문자열 | 파일 확장자 (png, webp, avif, svg, ico) |
| `size` | 정수 | 파일 크기 (바이트) |

**캐시:** `max-age=300` (5분), CORS 활성화.

## HTTP 헤더

### 에셋 응답
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### 오류 응답
| 상태 | 의미 |
|------|------|
| `200` | 성공 |
| `304` | 변경되지 않음 (조건부 요청) |
| `404` | 에셋을 찾을 수 없음 |
| `429` | 속도 제한 초과 (Concierge API에만 해당) |

## 캐시 퍼지 (Pro 이상)

### Cloudflare 대시보드 사용
Workers & Pages → cloudcdn-pro → Caching → Purge by URL.

### API 사용
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/프로젝트/image.webp"]}'
```

## 속도 제한
| 엔드포인트 | 제한 |
|------------|------|
| 에셋 전송 | 무제한 (Cloudflare 엣지) |
| Manifest.json | 무제한 (5분 캐시) |
| Concierge 챗 | 월 1,000 요청 |
| 이미지 변환 (Pro) | 월 50,000회 |
| 이미지 변환 (Enterprise) | 무제한 |

## SDK 및 통합

### HTML (형식 폴백을 갖춘 반응형)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML (자동 형식이 적용된 Pro 플랜)
```html
<img src="https://cloudcdn.pro/p/img/logo.png?w=200&format=auto" alt="Logo" width="200" height="200">
```

### React
```jsx
function CdnImage({ project, path, alt, width, height, ...props }) {
  const base = `https://cloudcdn.pro/${project}/${path}`;
  return (
    <picture>
      <source srcSet={`${base.replace(/\.\w+$/, '.avif')}`} type="image/avif" />
      <source srcSet={`${base.replace(/\.\w+$/, '.webp')}`} type="image/webp" />
      <img src={base} alt={alt} width={width} height={height} loading="lazy" {...props} />
    </picture>
  );
}
```

### Next.js
```jsx
// next.config.js
module.exports = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'cloudcdn.pro' }],
  },
};

// 컴포넌트
import Image from 'next/image';
<Image src="https://cloudcdn.pro/프로젝트/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/프로젝트/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/프로젝트/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/프로젝트/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/프로젝트/images/logos/logo.webp)
```
