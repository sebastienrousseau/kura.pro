# CloudCDN vs Bunny CDN

## 한눈에 보기

| 기능 | CloudCDN | Bunny CDN |
|------|----------|-----------|
| **시작 가격** | 월 $29 (Pro) | 월 $9.50 정액 |
| **무료 플랜** | 월 10 GB 대역폭 | 14일 평가판만 제공 |
| **요금 모델** | 대역폭 단계별 | GB당 (볼륨 가격, $0.01/GB부터) |
| **워크플로** | Git 네이티브 (git push) | 대시보드/FTP/API |
| **자동 최적화** | 푸시 시 WebP + AVIF + JXL | Bunny Optimizer (별도 추가 기능) |
| **Storage API** | Bunny.net 호환 JSON 스키마 | 네이티브 |
| **AI 기능** | 시맨틱 검색 + RAG 컨시어지 + MCP 서버 | 없음 |
| **서명된 커밋** | 필수 (공급망 무결성) | 해당 없음 |
| **엣지 위치** | 300개 이상 (Cloudflare) | 114개 PoP |
| **TTFB** | 중앙값 50ms 미만 (NA/EU) | 일반적으로 40-80ms |
| **엣지 컴퓨팅** | Cloudflare Workers (전체 JS 런타임) | Bunny Script (제한적) |
| **Perma-Cache** | 불변 1년 헤더 | Perma-Cache 기능 |
| **JPEG XL** | 지원 | Optimizer에서 제공되지 않음 |
| **에셋 출처** | 암호화 (서명된 Git 커밋) | 없음 |
| **MCP 서버** | 내장 | 제공되지 않음 |

## CloudCDN이 Bunny 호환 API를 사용하는 이유

CloudCDN의 Storage API는 Bunny.net 호환 JSON 스키마(Guid, StorageZoneName, Path, ObjectName 등)를 반환합니다. 이는 Bunny용으로 만들어진 마이그레이션 도구와 스크립트가 CloudCDN과 즉시 호환됨을 의미합니다.

## CloudCDN을 선택해야 할 때

- **Git 네이티브 워크플로**(FTP 없음, 대시보드 업로드 없음)를 원할 때
- **AI 기반 검색**과 **에이전트 통합**(MCP)이 필요할 때
- 모든 에셋에 대한 **암호학적 출처**가 필요할 때
- WebP 및 AVIF와 함께 **JPEG XL** 자동 생성을 원할 때
- **영구 무료 플랜**을 원할 때 (Bunny의 평가판은 만료됨)

## Bunny CDN을 선택해야 할 때

- **가능한 가장 낮은 GB당 가격**이 필요할 때 (일부 지역에서 $0.01/GB)
- 스토리지에 대한 **FTP/SFTP 접근**이 필요할 때
- 비디오 호스팅을 위한 **Bunny Stream**이 필요할 때
- 매우 높은 대역폭(월 100TB 이상)이 있고 볼륨 할인이 필요할 때
- 사용자 정의 규칙이 있는 추가 기능으로 **DDoS 보호**가 필요할 때

## 비용 비교

월 50 GB를 제공하는 사이트의 경우:

- **CloudCDN Pro**: 월 $29
- **Bunny CDN**: 약 월 $2.50 (EU/US, $0.05/GB 기준) + 월 $0.50 스토리지

월 500 GB의 경우:

- **CloudCDN Pro**: $29 + (400 GB × $0.05) = 월 $49
- **Bunny CDN**: 약 월 $25 (EU/US) + 스토리지

Bunny는 순수 대역폭 비용에서 이깁니다. CloudCDN은 워크플로, AI 기능, 출처 및 무료 플랜에서 이깁니다.
