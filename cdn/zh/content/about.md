# 关于 CloudCDN

## 什么是 CloudCDN？
CloudCDN 是一个面向开发者的 Git 原生静态资源分发网络。将图片推送到 GitHub 仓库,它们会被自动优化,并通过 Cloudflare 的边缘网络在全球范围内提供服务——300 多个数据中心,100 多个国家/地区,延迟低于 100 毫秒。

与需要仪表板、上传 API 或 SDK 集成的传统图像 CDN 不同,CloudCDN 使用开发者已经熟悉的工作流:`git push`。

## 工作原理
1. **推送:** 将图片添加到 GitHub 仓库,并使用签名密钥提交。
2. **优化:** GitHub Actions 自动压缩图片并生成 WebP(质量 80,缩小约 60%)和 AVIF(质量 65,缩小约 70%)变体。
3. **部署:** 修改的文件通过增量部署上传到 Cloudflare Pages(基于内容哈希的去重——只传输新增或修改的文件)。
4. **分发:** 资源通过不可变缓存头(`max-age=31536000`),从 300 多个边缘位置中最近的节点提供服务。

## 技术栈
- **边缘网络:** Cloudflare Pages 部署在全球 300 多个 PoP 上。世界上 95% 的人口距离 Cloudflare 数据中心不到 50 毫秒。
- **图像格式:** PNG(无损原始)、WebP(有损,质量 80)、AVIF(有损,质量 65)、SVG(直通)、ICO(直通)。
- **格式协商:** Pro 套餐根据浏览器的 `Accept` 头提供最佳格式(AVIF > WebP > 原始)。
- **缓存:** 不可变的边缘和浏览器缓存,max-age 为一年。通过修改文件名或路径来失效缓存。
- **CI/CD:** GitHub Actions 用于压缩(Sharp)、清单生成和 Cloudflare Pages 部署(Wrangler)。
- **安全:** 必须使用 SSH Ed25519 签名提交。`main` 分支保护。通过 GitHub Secrets 加密存储 API 令牌。
- **AI 礼宾:** Cloudflare Workers AI(Llama 3.1)+ Vectorize RAG,用于在主页提供智能文档搜索。

## 性能
- **TTFB:** 北美/欧洲中位数低于 50 毫秒,全球低于 100 毫秒(Cloudflare 边缘缓存命中)。
- **缓存命中率:** 生产资源超过 95%(不可变缓存)。
- **部署速度:** 增量上传——只传输修改的文件。典型部署时间:5-30 秒。
- **压缩:** WebP 比 PNG 节省约 60%。AVIF 比 PNG 节省约 70%。两者都自动生成。

## 资源组织
```
project-name/
  images/
    banners/    — 宽幅图形(推荐 1200x630)
    icons/      — 多分辨率(16x16 到 512x512,带 @2x/@3x)
    logos/      — 品牌标识与商标
    github/     — 社交预览图片
    titles/     — 标题图形和页眉
  README.md     — 可选的项目描述
```

## 关键指标
- **1,400 多个优化资源**,分布在 54 个租户区域中。
- **每个图像单一源** —— 派生通过 `/api/transform` 按需生成。
- 在 100 多个国家/地区拥有**300 多个边缘 PoP**。
- 边缘缓存命中时**全球 TTFB 低于 100 毫秒**。
- **零构建步骤** —— 无需 `npm install`、webpack 或框架。

## 谁在使用 CloudCDN?
CloudCDN 为以下场景提供资源服务:
- **开源项目:** 标志、横幅、图标和文档图形。
- **开发者工具:** Rust、Python 和 AI 开发者的品牌(rustdev、pythondev、llamadev)。
- **金融科技平台:** 银行业和量子计算资源库。
- **音频应用:** 波形可视化和 UI 组件。
- **静态站点生成器:** Shokunin、Kaishi 和其他 SSG 框架。

## 为什么不选择 [竞争对手]?

| vs Cloudinary | vs Imgix | vs Bunny CDN |
|---|---|---|
| 没有复杂的积分系统 | 没有基于积分的计费 | 包含 AVIF 支持 |
| Git 原生工作流 | Git 原生工作流 | Git 原生工作流 |
| 免费套餐,无需信用卡 | 提供免费套餐 | 没有试用期到期 |
| 内置 AI 礼宾 | 仅标准文档 | 仅标准文档 |

## 开源
CDN 基础设施在 MIT 许可证下开源。仓库:github.com/sebastienrousseau/cloudcdn.pro。

## 联系方式
- **支持:** support@cloudcdn.pro
- **销售:** sales@cloudcdn.pro
- **GitHub:** github.com/sebastienrousseau/cloudcdn.pro
- **状态:** cloudcdn.pro(主页显示运行状态)
