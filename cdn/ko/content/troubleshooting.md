# CloudCDN — 문제 해결

## 에셋 로드 안 됨 (404)

### 증상
`https://cloudcdn.pro/프로젝트/image.webp`가 404를 반환합니다.

### 일반적인 원인
1. **파일이 아직 푸시되지 않음.** `git status`를 확인하십시오 — 파일이 커밋되고 푸시되었습니까?
2. **배포가 아직 진행 중.** GitHub Actions 배포는 30-90초 걸립니다. Actions 탭을 확인하십시오.
3. **잘못된 경로.** URL은 대소문자를 구분합니다. `Logo.webp`는 `logo.webp`와 다릅니다.
4. **WebP/AVIF가 아직 생성되지 않음.** 자동 변환은 푸시 시 실행됩니다. PNG를 푸시한 경우 `.webp` 및 `.avif` 변형은 compress-images Action이 완료된 후에 나타납니다.
5. **파일이 25 MB 초과.** 25 MB를 초과하는 파일은 CDN 전송에서 제외됩니다. `ls -lh`로 파일 크기를 확인하십시오.

### 해결 방법
```bash
# 리포지토리에 파일이 존재하는지 확인
git ls-files | grep your-file

# Actions 상태 확인
gh run list --limit 5

# URL 직접 테스트
curl -sI https://cloudcdn.pro/프로젝트/images/logo.webp
```

## 커밋 서명 실패

### 증상
```
error: Signing failed: agent refused operation
```

### 일반적인 원인
1. **SSH 에이전트가 실행되지 않음.** 시작합니다:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **하드웨어 키가 터치되지 않음.** YubiKey 또는 보안 키(Ed25519-SK)를 사용하는 경우 메시지가 표시되면 키를 탭하십시오.
3. **잘못된 서명 키 구성됨.** 확인:
   ```bash
   git config --global user.signingkey
   ```
4. **GitHub에 SSH 키가 추가되지 않음.** GitHub → Settings → SSH and GPG keys로 이동합니다. 키가 **Signing Key**(인증뿐 아니라)로 나열되어 있는지 확인하십시오.

## WebP/AVIF가 생성되지 않음

### 증상
PNG를 푸시했지만 `.webp` 또는 `.avif` 변형이 나타나지 않습니다.

### 일반적인 원인
1. **압축 Action이 트리거되지 않음.** 워크플로는 새로운 PNG/JPEG 파일에서만 트리거됩니다. 파일이 이미 존재했다면 다시 처리되지 않습니다. Actions 탭을 확인하십시오.
2. **파일이 새로운 것으로 감지되지 않음.** 워크플로는 `git diff HEAD~1`을 사용하여 새 파일을 찾습니다. 커밋을 amend한 경우 diff가 감지하지 못할 수 있습니다.
3. **Sharp 변환 실패.** 일부 잘못된 PNG 또는 비정상적인 색상 프로필이 변환 오류를 일으킬 수 있습니다. Action 로그를 확인하십시오.

### 해결 방법
로컬 변환 스크립트를 수동으로 실행:
```bash
cd scripts && npm install
node convert.mjs ../../your-project
```

## 푸시 후 오래된 콘텐츠

### 증상
업데이트된 이미지를 푸시했지만 이전 버전이 여전히 제공됩니다.

### 원인
에셋은 1년 동안 `immutable` 헤더로 캐시됩니다. 동일한 URL에서 파일을 업데이트해도 캐시가 무효화되지 않습니다.

### 해결 방법
**파일명 또는 경로를 변경하십시오.** 이는 의도된 것입니다 — 불변 캐싱은 가장 빠른 전송 전략입니다.
```bash
# logo.png를 업데이트하는 대신 버전 지정 이름 사용:
logo-v2.png
# 또는 날짜 기반:
logo-2026-03.png
```

Pro/Enterprise 고객은 Cloudflare 대시보드를 통해 특정 URL을 퍼지할 수 있습니다.

## 배포 실패 (GitHub Actions)

### 증상
"Deploy to Cloudflare Pages" Action이 실패합니다.

### 일반적인 원인
1. **잘못된 API 토큰.** 토큰이 만료되었거나 교체되었을 수 있습니다. GitHub Secrets에서 `CLOUDFLARE_API_TOKEN`을 업데이트하십시오.
2. **권한 부족.** 토큰에 필요: Cloudflare Pages Edit, Workers Scripts Edit, Vectorize Edit, Workers KV Storage Edit, Workers AI Read.
3. **파일이 25 MB 초과.** 배포 워크플로는 25 MB 이상의 파일을 자동으로 제거하지만, 오류가 있는지 로그를 확인하십시오.
4. **Cloudflare 서비스 문제.** cloudflarestatus.com을 확인하십시오.

### 해결 방법
```bash
# 실패한 워크플로 재실행
gh run rerun <run-id>

# 로그 확인
gh run view <run-id> --log-failed
```

## 매니페스트가 업데이트되지 않음

### 증상
새로운 에셋이 `manifest.json` 또는 대시보드에 나타나지 않습니다.

### 원인
매니페스트 생성기는 이미지 경로 변경 시 트리거됩니다. 예상 경로 외부에 파일을 푸시한 경우 트리거되지 않을 수 있습니다.

### 해결 방법
수동으로 트리거:
```bash
gh workflow run generate-manifest
```
또는 로컬에서 재생성:
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## 대역폭 한도 도달 (무료 등급)

### 증상
에셋이 오류를 반환하거나 월 중간에 로드를 멈춥니다.

### 원인
무료 등급은 월 10 GB 대역폭이 있습니다. 80% 사용 시 이메일을 받게 됩니다.

### 해결 방법
- 이미지를 더 최적화하십시오 (PNG 대신 AVIF URL을 사용하여 ~70% 감소).
- 월 100 GB를 위해 Pro(월 $29)로 업그레이드하십시오.
- 다음 달까지 기다리십시오 — 한도는 1일에 재설정됩니다.

## Concierge 챗이 응답하지 않음

### 증상
홈페이지의 AI 챗 위젯이 응답하지 않거나 오류를 표시합니다.

### 일반적인 원인
1. **월간 쿼리 한도 도달 (월 1,000).** Concierge는 한도가 도달되면 자동으로 비활성화됩니다.
2. **Cloudflare Workers AI 일시적으로 사용 불가.** 드물지만, 엣지 AI 추론은 짧은 중단을 경험할 수 있습니다.
3. **지식 베이스가 동기화되지 않음.** 콘텐츠 파일이 최근에 업데이트된 경우 Vectorize 인덱스를 다시 동기화해야 할 수 있습니다.

### 해결 방법
지식 동기화 문제의 경우:
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs cdn/content
```
