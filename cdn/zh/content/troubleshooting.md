# CloudCDN — 故障排除

## 资源未加载（404）

### 症状
`https://cloudcdn.pro/项目/image.webp` 返回 404。

### 常见原因
1. **文件尚未推送。** 检查 `git status` — 文件是否已提交并推送？
2. **部署仍在进行中。** GitHub Actions 部署需要 30-90 秒。检查 Actions 选项卡。
3. **路径错误。** URL 区分大小写。`Logo.webp` 不是 `logo.webp`。
4. **WebP/AVIF 尚未生成。** 自动转换在推送时运行。如果你推送了 PNG，`.webp` 和 `.avif` 变体会在 compress-images Action 完成后出现。
5. **文件超过 25 MB。** 超过 25 MB 的文件被排除在 CDN 交付之外。使用 `ls -lh` 检查文件大小。

### 修复
```bash
# 验证文件存在于仓库中
git ls-files | grep your-file

# 检查 Actions 状态
gh run list --limit 5

# 直接测试 URL
curl -sI https://cloudcdn.pro/项目/images/logo.webp
```

## 提交签名失败

### 症状
```
error: Signing failed: agent refused operation
```

### 常见原因
1. **SSH 代理未运行。** 启动它：
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **未触摸硬件密钥。** 如果使用 YubiKey 或安全密钥（Ed25519-SK），请在提示时触摸密钥。
3. **配置了错误的签名密钥。** 验证：
   ```bash
   git config --global user.signingkey
   ```
4. **SSH 密钥未添加到 GitHub。** 转到 GitHub → Settings → SSH and GPG keys。确保你的密钥被列为 **Signing Key**（而不仅仅是 Authentication）。

## WebP/AVIF 未生成

### 症状
你推送了 PNG，但没有出现 `.webp` 或 `.avif` 变体。

### 常见原因
1. **压缩 Action 未触发。** 工作流仅在新的 PNG/JPEG 文件上触发。如果文件已存在，则不会重新处理。检查 Actions 选项卡。
2. **文件未被检测为新文件。** 工作流使用 `git diff HEAD~1` 查找新文件。如果你修改了一个提交，diff 可能无法检测到它。
3. **Sharp 转换失败。** 一些格式错误的 PNG 或不寻常的颜色配置文件可能导致转换错误。检查 Action 日志。

### 修复
手动运行本地转换脚本：
```bash
cd scripts && npm install
node convert.mjs ../../your-project
```

## 推送后内容陈旧

### 症状
你推送了更新后的图像，但仍提供旧版本。

### 原因
资源使用 `immutable` 头缓存 1 年。在同一 URL 上更新文件不会使缓存失效。

### 修复
**更改文件名或路径。** 这是设计使然 — 不可变缓存是最快的交付策略。
```bash
# 不要更新 logo.png，而是使用版本化名称：
logo-v2.png
# 或基于日期的：
logo-2026-03.png
```

Pro/Enterprise 客户可以通过 Cloudflare 控制台清除特定 URL。

## 部署失败（GitHub Actions）

### 症状
"Deploy to Cloudflare Pages" Action 失败。

### 常见原因
1. **API 令牌无效。** 令牌可能已过期或被轮换。在 GitHub Secrets 中更新 `CLOUDFLARE_API_TOKEN`。
2. **缺少权限。** 令牌需要：Cloudflare Pages Edit、Workers Scripts Edit、Vectorize Edit、Workers KV Storage Edit、Workers AI Read。
3. **文件超过 25 MB。** 部署工作流会自动删除大于 25 MB 的文件，但请检查日志中的错误。
4. **Cloudflare 服务问题。** 检查 cloudflarestatus.com。

### 修复
```bash
# 重新运行失败的工作流
gh run rerun <run-id>

# 检查日志
gh run view <run-id> --log-failed
```

## 清单未更新

### 症状
新资源未出现在 `manifest.json` 或控制台中。

### 原因
清单生成器在图像路径更改时触发。如果你在预期路径之外推送了文件，可能不会触发。

### 修复
手动触发：
```bash
gh workflow run generate-manifest
```
或在本地重新生成：
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## 带宽限制达到（免费套餐）

### 症状
资源在月中返回错误或停止加载。

### 原因
免费套餐有 10 GB/月带宽。你将在 80% 使用率时收到电子邮件。

### 修复
- 进一步优化图像（使用 AVIF URL 而不是 PNG，可减少约 70%）。
- 升级到 Pro（$29/月）以获得 100 GB/月。
- 等待下个月 — 限制在 1 日重置。

## Concierge 聊天无响应

### 症状
主页上的 AI 聊天小部件无响应或显示错误。

### 常见原因
1. **达到月度查询限制（每月 1,000 次）。** 当达到限制时，Concierge 会自动禁用。
2. **Cloudflare Workers AI 暂时不可用。** 罕见，但边缘 AI 推理可能会经历短暂的中断。
3. **知识库未同步。** 如果内容文件最近已更新，Vectorize 索引可能需要重新同步。

### 修复
对于知识同步问题：
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs cdn/content
```
