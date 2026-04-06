# CloudCDN — 보안 가이드

## 개요
CloudCDN은 main 브랜치로의 모든 푸시에 서명된 커밋을 강제합니다. 이는 모든 에셋 변경이 암호학적으로 검증되고 특정 기여자에게 추적 가능하도록 보장합니다.

## 왜 서명된 커밋입니까?
- **무결성:** 에셋이 전송 중에 변조되지 않았음을 보장합니다.
- **감사 추적:** 모든 변경 사항이 검증된 ID에 연결됩니다.
- **공급망 보안:** CDN에서 제공되는 콘텐츠에 대한 무단 수정을 방지합니다.
- **컴플라이언스:** 에셋 출처에 대한 기업 보안 요구 사항을 충족합니다.

## SSH 키 설정 (권장)

### Ed25519 키 생성
```bash
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/id_ed25519
```

하드웨어 보안 키(YubiKey 등)의 경우:
```bash
ssh-keygen -t ed25519-sk -C "your@email.com"
```

### Git 구성
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### GitHub에 키 추가
1. 공개 키를 복사합니다: `cat ~/.ssh/id_ed25519.pub`
2. GitHub → Settings → SSH and GPG keys → New SSH key로 이동합니다
3. 키 유형으로 **Signing Key**를 선택합니다
4. 붙여넣고 저장합니다

### 확인
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## GPG 키 설정 (대안)

### GPG 키 생성
```bash
gpg --full-generate-key
```
RSA 4096비트를 선택하고 만료 날짜를 설정한 후 이메일을 입력하십시오.

### Git 구성
```bash
gpg --list-secret-keys --keyid-format=long
# 키 ID를 복사합니다 (예: 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### GitHub에 키 추가
```bash
gpg --armor --export 3AA5C34371567BD2
```
출력을 복사하고 GitHub → Settings → SSH and GPG keys → New GPG key에 추가합니다.

## 브랜치 보호
main 브랜치는 다음 규칙으로 보호됩니다:
- **서명된 커밋 필요:** 모든 커밋은 암호학적으로 서명되어야 합니다.
- **강제 푸시 금지:** 히스토리를 다시 작성할 수 없습니다.
- **브랜치 삭제 금지:** main 브랜치는 삭제할 수 없습니다.

## API 토큰 보안
CI/CD 워크플로의 경우 API 토큰은 GitHub Secrets로 저장됩니다:
- `CLOUDFLARE_API_TOKEN` — Cloudflare Pages 배포에 사용됩니다.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare 계정 식별자입니다.

API 토큰, 시크릿 또는 자격 증명을 리포지토리에 절대 커밋하지 마십시오. 모든 민감한 값에는 GitHub Secrets를 사용하십시오.

## 보안 모범 사례
1. 가능한 경우 하드웨어 보안 키(Ed25519-SK)를 사용하십시오.
2. API 토큰을 분기별로 교체하십시오.
3. 예상치 못한 액세스에 대해 GitHub 감사 로그를 검토하십시오.
4. GitHub 계정에서 이중 인증을 활성화하십시오.
5. 커밋 서명을 확인하려면 `git log --show-signature` 명령을 사용하십시오.
