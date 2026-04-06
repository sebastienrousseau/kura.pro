# CloudCDN — 合规性与隐私

## 数据处理

### CloudCDN 处理哪些数据？
CloudCDN 提供静态文件（图像、图标、字体）。它不处理、存储或传输个人用户数据。唯一的数据流是：
1. 浏览器请求静态文件 URL。
2. Cloudflare 边缘提供缓存的文件。
3. 生成标准 HTTP 日志（IP、时间戳、URL、user-agent）。

### 数据存储在哪里？
- **源文件：** GitHub 仓库（由 GitHub/Microsoft 在美国托管）。
- **边缘缓存：** Cloudflare 的 300+ 全球 PoP。缓存副本分发到全球以提高性能。
- **AI 礼宾数据：** 不存储对话。聊天小部件仅使用内存中的会话状态——不进行用户查询的服务器端日志记录。
- **速率限制计数器：** 存储在 Cloudflare Workers KV 中（仅汇总计数，无个人数据）。

## GDPR 合规

### 状态
CloudCDN 符合 GDPR。我们使用 Cloudflare 作为基础设施提供商，Cloudflare 通过以下方式保持 GDPR 合规：
- EU-US Data Privacy Framework 认证。
- 用于国际数据传输的标准合同条款（SCC）。
- 应要求提供的数据处理协议。

### 数据最小化
- CloudCDN 不设置任何 cookie。
- 无用户跟踪或分析像素。
- 不收集、存储或处理任何个人数据。
- HTTP 访问日志由 Cloudflare 根据其隐私政策处理。

### 数据主体权利
由于 CloudCDN 不收集个人数据，因此没有可访问、更正或删除的个人数据。如果您认为您的个人数据被无意中包含在某个资源中（例如照片），请联系 support@cloudcdn.pro 进行删除。

### DPA（数据处理协议）
Enterprise 客户可以请求正式的 DPA。请联系 sales@cloudcdn.pro。

## CCPA / CPRA（加利福尼亚）
CloudCDN 不出售、共享或将个人信息用于定向广告。由于不收集个人数据，因此不需要选择退出机制。

## SOC 2 / ISO 27001
CloudCDN 利用 Cloudflare 的基础设施，Cloudflare 维持：
- SOC 2 Type II 认证。
- ISO 27001 认证。
- PCI DSS Level 1 合规。
这些认证涵盖 CloudCDN 使用的边缘交付基础设施。

## 安全措施
- **传输中加密：** 所有连接使用 TLS 1.3。
- **DDoS 保护：** 所有套餐均包含 Cloudflare 的自动 DDoS 缓解。
- **WAF：** Cloudflare Web 应用防火墙在所有端点上处于活动状态。
- **机器人缓解：** Cloudflare Bot Management 防止抓取和滥用。
- **签名提交：** 所有资源更改都需要加密验证。
- **分支保护：** 强制推送和历史重写被阻止。
- **密钥管理：** API 令牌存储为加密的 GitHub Secrets，绝不存储在代码中。

## 资源完整性
CloudCDN 提供的每个资源都可追溯到一个签名的 Git 提交。这提供了：
- **溯源：** 每个文件更改都链接到经过验证的贡献者。
- **审计追踪：** 包含签名提交验证的完整 Git 历史。
- **篡改检测：** 任何未经授权的修改都会破坏签名链。

## 可接受使用
CloudCDN 仅用于静态资源交付。禁止的用途包括：
- 托管恶意软件或网络钓鱼内容。
- 视频流或大文件分发（>25 MB）。
- 在资源中存储个人数据、凭据或敏感信息。
- 使用该服务规避其他服务的条款。

违规将导致账户暂停并提前 24 小时通知（非法内容除外，将立即删除）。

## 事件响应
- 根据 GDPR 要求，安全事件在 72 小时内报告。
- 联系 security@cloudcdn.pro 报告漏洞。
- Enterprise 客户通过其专用 Slack 频道接收直接通知。

## 联系方式
- **隐私咨询：** privacy@cloudcdn.pro
- **安全报告：** security@cloudcdn.pro
- **DPA 请求：** sales@cloudcdn.pro
