# CloudCDN — 安全指南

## 概述
CloudCDN 对推送到 main 分支的所有提交强制要求签名提交。这确保每个资源更改都经过加密验证，并可追溯到特定的贡献者。

## 为什么需要签名提交？
- **完整性：** 保证资源在传输过程中未被篡改。
- **审计追踪：** 每个更改都链接到经过验证的身份。
- **供应链安全：** 防止对 CDN 提供的内容进行未经授权的修改。
- **合规：** 满足资源溯源的企业安全要求。

## SSH 密钥设置（推荐）

### 生成 Ed25519 密钥
```bash
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/id_ed25519
```

对于硬件安全密钥（YubiKey 等）：
```bash
ssh-keygen -t ed25519-sk -C "your@email.com"
```

### 配置 Git
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### 将密钥添加到 GitHub
1. 复制你的公钥：`cat ~/.ssh/id_ed25519.pub`
2. 转到 GitHub → Settings → SSH and GPG keys → New SSH key
3. 选择 **Signing Key** 作为密钥类型
4. 粘贴并保存

### 验证
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## GPG 密钥设置（替代方案）

### 生成 GPG 密钥
```bash
gpg --full-generate-key
```
选择 RSA 4096 位，设置过期时间，并输入你的电子邮件。

### 配置 Git
```bash
gpg --list-secret-keys --keyid-format=long
# 复制密钥 ID（例如 3AA5C34371567BD2）
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### 将密钥添加到 GitHub
```bash
gpg --armor --export 3AA5C34371567BD2
```
复制输出并添加到 GitHub → Settings → SSH and GPG keys → New GPG key。

## 分支保护
main 分支使用以下规则保护：
- **需要签名提交：** 所有提交必须经过加密签名。
- **无强制推送：** 历史记录无法重写。
- **无分支删除：** main 分支无法删除。

## API 令牌安全
对于 CI/CD 工作流，API 令牌存储为 GitHub Secrets：
- `CLOUDFLARE_API_TOKEN` — 用于 Cloudflare Pages 部署。
- `CLOUDFLARE_ACCOUNT_ID` — 你的 Cloudflare 帐户标识符。

切勿将 API 令牌、密钥或凭据提交到仓库。对所有敏感值使用 GitHub Secrets。

## 安全最佳实践
1. 尽可能使用硬件安全密钥（Ed25519-SK）。
2. 每季度轮换 API 令牌。
3. 检查 GitHub 审计日志以发现意外访问。
4. 在你的 GitHub 帐户上启用双因素身份验证。
5. 使用 `git log --show-signature` 命令验证提交签名。
