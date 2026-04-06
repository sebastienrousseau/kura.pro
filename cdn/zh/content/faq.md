# CloudCDN — 常见问题

## 入门

### 什么是 CloudCDN？
CloudCDN 是一个 Git 原生的图片 CDN。将图片推送到 GitHub 仓库，它们就会自动优化（WebP + AVIF），并通过 Cloudflare 的 300+ 边缘节点以低于 100ms 的延迟在全球范围内提供服务。

### CloudCDN 与 Cloudinary 或 Imgix 有何不同？
CloudCDN 使用 Git 原生工作流 — 没有控制台上传、没有 SDK、没有积分系统。你执行 `git push`，资源就上线了。Cloudinary 对付费套餐采用基于积分的计费，从 $89/月起。Imgix 使用积分包，从 $25/月起。CloudCDN 的 Pro 套餐为 $29/月，采用简单的带宽计费。

### CloudCDN 对开源项目免费吗？
是的。免费套餐永久免费，每月 10 GB 带宽。无需信用卡，无试用期到期。非常适合 OSS 项目的徽标、横幅、图标和文档资源。

### 我需要安装任何东西吗？
不需要。你只需要 Git（2.34+）和用于签名提交的 SSH 密钥。无需 Node.js、无需包管理器、无需构建工具。CI/CD 管道在服务器端处理所有图像优化。

## 文件格式

### 支持哪些文件格式？
上传：PNG、JPEG、SVG、ICO、WebP。管道会为所有 PNG 和 JPEG 上传自动生成 WebP 和 AVIF 变体。SVG 和 ICO 文件按原样提供。

### 自动转换使用哪些质量设置？
WebP：质量 80（接近无损，比 PNG 小约 60%）。AVIF：质量 65（高效率，比 PNG 小约 70%）。这些设置经过优化，以实现视觉质量和文件大小的最佳平衡。

### 我可以覆盖质量设置吗？
在 Pro 套餐上，图像转换 API 通过 URL 参数支持自定义质量：`?q=90` 表示更高质量，`?q=50` 表示更多压缩。免费套餐使用默认设置。

### JPEG XL 怎么样？
截至 2026 年，JPEG XL 在 Chrome 和 Firefox 中需要标志启用，Safari 部分支持。一旦浏览器支持率超过 80%，我们将添加 JPEG XL 自动转换。目前，AVIF 在更广泛的兼容性下提供更好的压缩（93%+ 浏览器支持）。

### 最大文件大小是多少？
每个文件 25 MB 用于 CDN 交付。超过 25 MB 的文件保留在 Git 仓库中，但被排除在边缘部署之外。作为参考，高质量的 4K PNG 通常为 5-15 MB。

## 性能

### 资源交付有多快？
北美和欧洲的中位 TTFB 低于 50ms，全球低于 100ms。资源以不可变缓存头（1 年 max-age）提供，因此重复访问直接从浏览器缓存提供。

### 缓存如何工作？
所有资源都以 `Cache-Control: public, max-age=31536000, immutable` 提供。浏览器和 CDN 边缘节点将文件缓存一年。要更新资源，请更改文件名（例如 `logo-v2.webp`）— 这是标准的缓存破坏方法。

### 缓存命中率是多少？
生产资源通常的缓存命中率超过 95%。manifest.json 文件缓存 5 分钟以保持新鲜。控制台从不缓存。

### 我可以手动清除缓存吗？
免费套餐：缓存清除在部署时自动发生。Pro/Enterprise：你可以通过 Cloudflare 控制台或 API 清除特定 URL 或通配符模式。

## 图像转换 API（Pro+）

### 转换 API 如何工作？
将 URL 参数附加到任何资源 URL：
```
https://cloudcdn.pro/项目/image.png?w=800&h=600&fit=cover&format=auto&q=80
```

### 有哪些参数可用？
- `w` — 宽度（像素）（例如 `?w=400`）
- `h` — 高度（像素）（例如 `?h=300`）
- `fit` — 缩放模式：`cover`、`contain`、`fill`、`inside`、`outside`
- `format` — 输出格式：`auto`（最适合浏览器）、`webp`、`avif`、`png`、`jpeg`
- `q` — 质量：1-100（默认值因格式而异）
- `blur` — 高斯模糊：1-250（例如 `?blur=20` 用于 LQIP 占位符）
- `sharpen` — 锐化：1-10
- `gravity` — 裁剪锚点：`center`、`north`、`south`、`east`、`west`、`face`（AI）

### CloudCDN 支持自动格式协商吗？
是的（Pro+）。当你使用 `?format=auto` 时，CloudCDN 读取浏览器的 `Accept` 头，并提供 AVIF（如果支持），然后是 WebP，然后是原始格式。这确保每个访问者都能获得尽可能小的文件。

## 设置和工作流

### 我如何上传资源？
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cp my-logo.png cloudcdn.pro/my-project/images/logos/
cd cloudcdn.pro
git add my-project/
git commit -S -m "add my-project logo"
git push origin main
```
1-2 分钟内，你的资源将在 `https://cloudcdn.pro/my-project/images/logos/my-logo.webp` 上线。

### 我可以使用自定义域名吗？
Pro 和 Enterprise 套餐支持自定义域名。自定义域名通过 Cloudflare DNS 获得自动 SSL 配置和 CNAME 设置。请联系 support@cloudcdn.pro 进行配置。

### 它可以在 macOS、Linux 和 WSL2 上工作吗？
是的。所有支持 Git 和 SSH 的平台。请参阅设置指南以获取特定于平台的说明，包括 SSH 密钥生成和 Git 签名配置。

## 安全

### 签名提交是强制性的吗？
是的。所有对 main 分支的推送都需要签名提交（SSH Ed25519 或 GPG）。这确保每个资源更改都经过加密验证。请参阅安全指南进行设置。

### 我的数据安全吗？
资源通过使用 TLS 1.3 的 HTTPS 提供。源仓库在带有分支保护的 GitHub 上。Cloudflare 在所有套餐上提供 DDoS 保护、WAF 和机器人缓解。

## 计费

### 带宽计费如何工作？
免费：每月 10 GB。Pro：包含每月 100 GB，超出部分 $0.05/GB。Enterprise：无限制。带宽 = 从边缘交付给最终用户的总字节数。源拉取和 CI/CD 传输不计入。

### 我可以随时升级或降级吗？
是的。升级立即生效（按比例计算）。降级在下一个计费周期生效。随时取消 — 没有合同。

### Pro 有免费试用吗？
是的。14 天完整访问试用。无需信用卡。如果不订阅，会自动恢复到免费套餐。

### 如果我超出免费套餐带宽会怎样？
资源在该月剩余时间内停止从 CDN 提供。它们保留在 Git 仓库中，并在下个月初恢复提供。当使用率达到 80% 时，你会收到一封电子邮件警告。

## 合规

### CloudCDN 符合 GDPR 吗？
是的。CloudCDN 使用 Cloudflare 的基础设施，该基础设施根据 GDPR 处理数据。我们为 Enterprise 客户提供数据处理协议（DPA）。不存储任何个人用户数据 — 我们只提供静态文件。

### 数据存储在哪里？
资源文件存储在 GitHub 仓库（美国），并在 Cloudflare 的 300+ 全球边缘位置缓存。缓存副本在 1 年后或新部署时过期。
