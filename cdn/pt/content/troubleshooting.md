# CloudCDN — Solução de problemas

## Ativo não carregando (404)

### Sintoma
`https://cloudcdn.pro/projeto/image.webp` retorna 404.

### Causas comuns
1. **Arquivo ainda não enviado.** Verifique `git status` — o arquivo está commitado e enviado?
2. **Deploy ainda em andamento.** O deploy do GitHub Actions leva 30-90 segundos. Verifique a aba Actions.
3. **Caminho errado.** As URLs diferenciam maiúsculas e minúsculas. `Logo.webp` não é `logo.webp`.
4. **WebP/AVIF ainda não gerado.** A conversão automática é executada no push. Se você enviou um PNG, as variantes `.webp` e `.avif` aparecem após a conclusão da Action compress-images.
5. **Arquivo acima de 25 MB.** Arquivos que excedem 25 MB são excluídos da entrega CDN. Verifique o tamanho do arquivo com `ls -lh`.

### Solução
```bash
# Verifique se o arquivo existe no repositório
git ls-files | grep your-file

# Verifique o status das Actions
gh run list --limit 5

# Teste a URL diretamente
curl -sI https://cloudcdn.pro/projeto/images/logo.webp
```

## Falha na assinatura do commit

### Sintoma
```
error: Signing failed: agent refused operation
```

### Causas comuns
1. **SSH agent não está em execução.** Inicie-o:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **Chave de hardware não tocada.** Se estiver usando uma YubiKey ou chave de segurança (Ed25519-SK), toque na chave quando solicitado.
3. **Chave de assinatura errada configurada.** Verifique:
   ```bash
   git config --global user.signingkey
   ```
4. **Chave SSH não adicionada ao GitHub.** Vá para GitHub → Settings → SSH and GPG keys. Garanta que sua chave esteja listada como **Signing Key** (não apenas Authentication).

## WebP/AVIF não gerado

### Sintoma
Você enviou um PNG, mas nenhuma variante `.webp` ou `.avif` apareceu.

### Causas comuns
1. **A Action de compressão não foi acionada.** O workflow só é acionado em arquivos PNG/JPEG novos. Se o arquivo já existia, não será reprocessado. Verifique a aba Actions.
2. **Arquivo não detectado como novo.** O workflow usa `git diff HEAD~1` para encontrar arquivos novos. Se você fez amend em um commit, o diff pode não detectá-lo.
3. **Conversão Sharp falhou.** Alguns PNGs malformados ou perfis de cor incomuns podem causar erros de conversão. Verifique os logs da Action.

### Solução
Execute o script de conversão local manualmente:
```bash
cd scripts && npm install
node convert.mjs ../../your-project
```

## Conteúdo desatualizado após o push

### Sintoma
Você enviou uma imagem atualizada, mas a versão antiga ainda é servida.

### Causa
Os ativos são cacheados com cabeçalhos `immutable` por 1 ano. Atualizar um arquivo na mesma URL não invalida os caches.

### Solução
**Mude o nome do arquivo ou o caminho.** Isso é por design — o cache imutável é a estratégia de entrega mais rápida.
```bash
# Em vez de atualizar logo.png, use nomes versionados:
logo-v2.png
# Ou baseados em data:
logo-2026-03.png
```

Clientes Pro/Enterprise podem purgar URLs específicas via painel da Cloudflare.

## Falha no deploy (GitHub Actions)

### Sintoma
A Action "Deploy to Cloudflare Pages" falha.

### Causas comuns
1. **Token de API inválido.** O token pode ter expirado ou sido rotacionado. Atualize `CLOUDFLARE_API_TOKEN` em GitHub Secrets.
2. **Permissões ausentes.** O token precisa de: Cloudflare Pages Edit, Workers Scripts Edit, Vectorize Edit, Workers KV Storage Edit, Workers AI Read.
3. **Arquivo acima de 25 MB.** O workflow de deploy remove automaticamente arquivos >25 MB, mas verifique os logs em busca de erros.
4. **Problema no serviço Cloudflare.** Verifique cloudflarestatus.com.

### Solução
```bash
# Re-execute o workflow que falhou
gh run rerun <run-id>

# Verifique os logs
gh run view <run-id> --log-failed
```

## Manifest não atualizando

### Sintoma
Novos ativos não aparecem em `manifest.json` ou no painel.

### Causa
O gerador de manifest é acionado em mudanças de caminho de imagem. Se você enviou arquivos fora dos caminhos esperados, ele pode não ser acionado.

### Solução
Acione manualmente:
```bash
gh workflow run generate-manifest
```
Ou regenere localmente:
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## Limite de banda atingido (nível gratuito)

### Sintoma
Os ativos retornam erros ou param de carregar no meio do mês.

### Causa
O nível gratuito tem 10 GB/mês de banda. Você receberá um e-mail aos 80% de uso.

### Solução
- Otimize as imagens ainda mais (use URLs AVIF em vez de PNG para uma redução de ~70%).
- Faça upgrade para Pro (US$ 29/mês) para 100 GB/mês.
- Aguarde o próximo mês — os limites resetam no dia 1°.

## Chat do Concierge não responde

### Sintoma
O widget de chat de IA na homepage não responde ou mostra erros.

### Causas comuns
1. **Limite mensal de consultas atingido (1.000/mês).** O Concierge se desativa quando o limite é atingido.
2. **Cloudflare Workers AI temporariamente indisponível.** Raro, mas a inferência de IA de edge pode passar por breves interrupções.
3. **Base de conhecimento não sincronizada.** Se os arquivos de conteúdo foram atualizados recentemente, o índice Vectorize pode precisar ser ressincronizado.

### Solução
Para problemas de sincronização da base de conhecimento:
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs cdn/content
```
