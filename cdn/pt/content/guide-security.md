# CloudCDN — Guia de segurança

## Visão geral
O CloudCDN exige commits assinados em todos os pushes para o branch main. Isso garante que cada alteração de ativo seja verificada criptograficamente e rastreável a um contribuidor específico.

## Por que commits assinados?
- **Integridade:** garante que os ativos não foram adulterados em trânsito.
- **Trilha de auditoria:** cada alteração está vinculada a uma identidade verificada.
- **Segurança da supply chain:** previne modificações não autorizadas no conteúdo servido pelo CDN.
- **Conformidade:** atende aos requisitos de segurança empresarial para procedência de ativos.

## Configuração de chave SSH (recomendado)

### Gerar uma chave Ed25519
```bash
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/id_ed25519
```

Para chaves de segurança de hardware (YubiKey, etc.):
```bash
ssh-keygen -t ed25519-sk -C "your@email.com"
```

### Configurar o Git
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Adicionar a chave ao GitHub
1. Copie sua chave pública: `cat ~/.ssh/id_ed25519.pub`
2. Vá para GitHub → Settings → SSH and GPG keys → New SSH key
3. Selecione **Signing Key** como tipo de chave
4. Cole e salve

### Verificar
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## Configuração de chave GPG (alternativa)

### Gerar uma chave GPG
```bash
gpg --full-generate-key
```
Selecione RSA 4096-bit, defina uma expiração e insira seu e-mail.

### Configurar o Git
```bash
gpg --list-secret-keys --keyid-format=long
# Copie o ID da chave (por exemplo, 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### Adicionar a chave ao GitHub
```bash
gpg --armor --export 3AA5C34371567BD2
```
Copie a saída e adicione em GitHub → Settings → SSH and GPG keys → New GPG key.

## Proteção de branch
O branch main está protegido com as seguintes regras:
- **Commits assinados obrigatórios:** todos os commits devem ser criptograficamente assinados.
- **Sem force pushes:** o histórico não pode ser reescrito.
- **Sem exclusão de branch:** o branch main não pode ser excluído.

## Segurança de tokens de API
Para workflows CI/CD, tokens de API são armazenados como GitHub Secrets:
- `CLOUDFLARE_API_TOKEN` — Usado para o deployment do Cloudflare Pages.
- `CLOUDFLARE_ACCOUNT_ID` — O identificador da sua conta Cloudflare.

Nunca commite tokens de API, segredos ou credenciais no repositório. Use GitHub Secrets para todos os valores sensíveis.

## Boas práticas de segurança
1. Use chaves de segurança de hardware (Ed25519-SK) sempre que possível.
2. Rotacione tokens de API trimestralmente.
3. Revise o log de auditoria do GitHub para acessos inesperados.
4. Habilite a autenticação de dois fatores na sua conta GitHub.
5. Use o comando `git log --show-signature` para verificar assinaturas de commits.
