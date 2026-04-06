# CloudCDN — セキュリティガイド

## 概要
CloudCDN は `main` ブランチへのすべてのプッシュで署名付きコミットを必須としています。これにより、すべてのアセット変更が暗号学的に検証され、特定の貢献者まで追跡可能になります。

## なぜ署名付きコミットが必要なのか?
- **整合性:** 転送中にアセットが改ざんされていないことを保証します。
- **監査証跡:** すべての変更が検証済みの ID にリンクされます。
- **サプライチェーンセキュリティ:** CDN で配信されるコンテンツへの不正な変更を防ぎます。
- **コンプライアンス:** アセットの来歴に関する企業のセキュリティ要件を満たします。

## SSH キーの設定(推奨)

### Ed25519 キーを生成する
```bash
ssh-keygen -t ed25519 -C "あなた@email.com" -f ~/.ssh/id_ed25519
```

ハードウェアセキュリティキー(YubiKey など)の場合:
```bash
ssh-keygen -t ed25519-sk -C "あなた@email.com"
```

### Git を設定する
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### GitHub にキーを追加する
1. 公開鍵をコピー: `cat ~/.ssh/id_ed25519.pub`
2. GitHub → Settings → SSH and GPG keys → New SSH key に移動
3. キータイプとして **Signing Key** を選択
4. 貼り付けて保存

### 検証する
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## GPG キーの設定(代替手段)

### GPG キーを生成する
```bash
gpg --full-generate-key
```
RSA 4096 ビットを選択し、有効期限を設定して、メールアドレスを入力します。

### Git を設定する
```bash
gpg --list-secret-keys --keyid-format=long
# キー ID をコピー(例: 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### GitHub にキーを追加する
```bash
gpg --armor --export 3AA5C34371567BD2
```
出力をコピーし、GitHub → Settings → SSH and GPG keys → New GPG key で追加します。

## ブランチ保護
`main` ブランチは次のルールで保護されています:
- **署名付きコミット必須:** すべてのコミットは暗号学的に署名されている必要があります。
- **force push 禁止:** 履歴を書き換えることはできません。
- **ブランチ削除禁止:** `main` ブランチを削除することはできません。

## API トークンのセキュリティ
CI/CD ワークフローでは、API トークンは GitHub Secrets として保存されます:
- `CLOUDFLARE_API_TOKEN` — Cloudflare Pages デプロイに使用。
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare アカウント識別子。

API トークン、シークレット、認証情報をリポジトリにコミットしてはいけません。すべての機密値には GitHub Secrets を使用してください。

## セキュリティのベストプラクティス
1. 可能な場合はハードウェアセキュリティキー(Ed25519-SK)を使用してください。
2. API トークンを四半期ごとにローテーションしてください。
3. 予期しないアクセスがないか GitHub の監査ログを確認してください。
4. GitHub アカウントで二要素認証を有効にしてください。
5. `git log --show-signature` コマンドを使用してコミット署名を検証してください。
