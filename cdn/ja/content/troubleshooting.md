# CloudCDN — トラブルシューティング

## アセットが読み込まれない(404)

### 症状
`https://cloudcdn.pro/project/image.webp` が 404 を返します。

### よくある原因
1. **ファイルがまだプッシュされていない。** `git status` を確認してください — ファイルはコミット&プッシュされていますか?
2. **デプロイがまだ進行中。** GitHub Actions のデプロイには 30〜90 秒かかります。Actions タブを確認してください。
3. **パスが間違っている。** URL は大文字小文字を区別します。`Logo.webp` は `logo.webp` とは別物です。
4. **WebP/AVIF がまだ生成されていない。** 自動変換はプッシュ時に実行されます。PNG をプッシュした場合、`.webp` および `.avif` バリアントは compress-images Action 完了後に表示されます。
5. **ファイルが 25 MB を超えている。** 25 MB を超えるファイルは CDN 配信から除外されます。`ls -lh` でファイルサイズを確認してください。

### 解決策
```bash
# リポジトリにファイルが存在するか確認
git ls-files | grep your-file

# Actions の状態を確認
gh run list --limit 5

# URL を直接テスト
curl -sI https://cloudcdn.pro/project/images/logo.webp
```

## コミット署名が失敗する

### 症状
```
error: Signing failed: agent refused operation
```

### よくある原因
1. **SSH エージェントが起動していない。** 起動してください:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **ハードウェアキーがタッチされていない。** YubiKey やセキュリティキー(Ed25519-SK)を使用している場合は、プロンプトが表示されたらキーをタップしてください。
3. **設定された署名キーが間違っている。** 確認してください:
   ```bash
   git config --global user.signingkey
   ```
4. **SSH キーが GitHub に追加されていない。** GitHub → Settings → SSH and GPG keys に移動してください。キーが **Signing Key**(認証用だけでなく)としてリストされていることを確認してください。

## WebP/AVIF が生成されない

### 症状
PNG をプッシュしましたが、`.webp` や `.avif` バリアントが表示されません。

### よくある原因
1. **圧縮 Action がトリガーされなかった。** ワークフローは新しい PNG/JPEG ファイルでのみトリガーされます。ファイルがすでに存在していた場合は再処理されません。Actions タブを確認してください。
2. **ファイルが新規として検出されなかった。** ワークフローは `git diff HEAD~1` を使用して新しいファイルを検索します。コミットを amend した場合、diff で検出されないことがあります。
3. **Sharp の変換が失敗した。** 一部の不正な PNG や珍しいカラープロファイルでは変換エラーが発生することがあります。Action のログを確認してください。

### 解決策
ローカルで変換スクリプトを実行します:
```bash
cd scripts && npm install
node convert.mjs ../../your-project
```

## プッシュ後にコンテンツが古いまま

### 症状
更新した画像をプッシュしましたが、古いバージョンが配信され続けます。

### 原因
アセットは `immutable` ヘッダーで 1 年間キャッシュされます。同じ URL でファイルを更新してもキャッシュは無効化されません。

### 解決策
**ファイル名またはパスを変更してください。** これは設計上の仕様です — 不変キャッシュが最速の配信戦略だからです。
```bash
# logo.png を更新する代わりに、バージョン付きの名前を使用:
logo-v2.png
# または日付ベース:
logo-2026-03.png
```

Pro/Enterprise のお客様は Cloudflare ダッシュボード経由で特定の URL をパージできます。

## デプロイ失敗(GitHub Actions)

### 症状
「Deploy to Cloudflare Pages」Action が失敗します。

### よくある原因
1. **無効な API トークン。** トークンが期限切れまたはローテーションされた可能性があります。GitHub Secrets の `CLOUDFLARE_API_TOKEN` を更新してください。
2. **権限不足。** トークンには次の権限が必要です: Cloudflare Pages Edit、Workers Scripts Edit、Vectorize Edit、Workers KV Storage Edit、Workers AI Read。
3. **ファイルが 25 MB を超えている。** デプロイワークフローは 25 MB を超えるファイルを自動削除しますが、ログでエラーを確認してください。
4. **Cloudflare サービスの問題。** cloudflarestatus.com を確認してください。

### 解決策
```bash
# 失敗したワークフローを再実行
gh run rerun <run-id>

# ログを確認
gh run view <run-id> --log-failed
```

## マニフェストが更新されない

### 症状
新しいアセットが `manifest.json` やダッシュボードに表示されません。

### 原因
マニフェストジェネレーターは画像パスの変更でトリガーされます。期待されるパスの外でファイルをプッシュすると、トリガーされない場合があります。

### 解決策
手動でトリガー:
```bash
gh workflow run generate-manifest
```
またはローカルで再生成:
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## 帯域幅制限到達(無料プラン)

### 症状
アセットがエラーを返すか、月の途中で読み込みが停止します。

### 原因
無料プランの帯域幅は 10 GB/月です。使用量が 80% に達するとメールが届きます。

### 解決策
- 画像をさらに最適化してください(PNG の代わりに AVIF URL を使用すれば約 70% 削減)。
- Pro(29 ドル/月)にアップグレードして月 100 GB に。
- 翌月まで待ってください — 制限は 1 日にリセットされます。

## Concierge チャットが応答しない

### 症状
ホームページの AI チャットウィジェットが応答しないか、エラーを表示します。

### よくある原因
1. **月間クエリ制限到達(1,000/月)。** Concierge は制限に達すると自動的に無効になります。
2. **Cloudflare Workers AI が一時的に利用不可。** まれですが、エッジ AI 推論で短時間の障害が発生することがあります。
3. **ナレッジベースが未同期。** コンテンツファイルが最近更新された場合、Vectorize インデックスを再同期する必要がある可能性があります。

### 解決策
ナレッジ同期の問題の場合:
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs cdn/content
```
