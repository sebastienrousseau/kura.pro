# CloudCDN 与 Bunny CDN 对比

## 速览

| 功能 | CloudCDN | Bunny CDN |
|------|----------|-----------|
| **起步价格** | $29/月（Pro） | $9.50/月固定 |
| **免费套餐** | 10 GB/月带宽 | 仅 14 天试用 |
| **计费模式** | 带宽分级 | 按 GB（按量定价，从 $0.01/GB 起） |
| **工作流** | Git 原生（git push） | 控制台/FTP/API |
| **自动优化** | 推送时生成 WebP + AVIF + JXL | Bunny Optimizer（独立附加项） |
| **存储 API** | 兼容 Bunny.net 的 JSON 架构 | 原生 |
| **AI 功能** | 语义搜索 + RAG 礼宾 + MCP 服务器 | 无 |
| **签名提交** | 必须（供应链完整性） | 不适用 |
| **边缘节点** | 300+（Cloudflare） | 114 个 PoP |
| **TTFB** | 中位数 <50ms（北美/欧洲） | 通常 ~40-80ms |
| **边缘计算** | Cloudflare Workers（完整 JS 运行时） | Bunny Script（受限） |
| **永久缓存** | 1 年不可变头部 | Perma-Cache 功能 |
| **JPEG XL** | 支持 | Optimizer 中不可用 |
| **资源溯源** | 加密（签名 Git 提交） | 无 |
| **MCP 服务器** | 内置 | 不可用 |

## 为何 CloudCDN 使用 Bunny 兼容 API

CloudCDN 的存储 API 返回与 Bunny.net 兼容的 JSON 架构（Guid、StorageZoneName、Path、ObjectName 等）。这意味着为 Bunny 构建的迁移工具和脚本可以直接与 CloudCDN 配合使用。

## 何时选择 CloudCDN

- 你想要 **Git 原生工作流**（无需 FTP，无需控制台上传）
- 你需要 **AI 驱动的搜索** 和 **代理集成**（MCP）
- 你需要每个资源的 **加密溯源**
- 你想要在 WebP 和 AVIF 之外自动生成 **JPEG XL**
- 你想要 **永久免费套餐**（Bunny 的试用会过期）

## 何时选择 Bunny CDN

- 你需要 **尽可能低的每 GB 价格**（某些地区低至 $0.01/GB）
- 你需要对存储的 **FTP/SFTP 访问**
- 你需要 **Bunny Stream** 用于视频托管
- 你有非常高的带宽（每月 100+ TB）并需要批量折扣
- 你需要 **DDoS 保护** 作为带自定义规则的附加项

## 成本对比

对于每月提供 50 GB 的网站：

- **CloudCDN Pro**：$29/月
- **Bunny CDN**：约 $2.50/月（欧洲/美国按 $0.05/GB）+ $0.50/月存储

对于每月 500 GB：

- **CloudCDN Pro**：$29 + (400 GB × $0.05) = $49/月
- **Bunny CDN**：约 $25/月（欧洲/美国）+ 存储

Bunny 在原始带宽成本上获胜。CloudCDN 在工作流、AI 功能、溯源和免费套餐方面获胜。
