# Sobre o CloudCDN

## O que é o CloudCDN?
O CloudCDN é uma rede de entrega de ativos estáticos nativa do Git para desenvolvedores. Envie imagens para um repositório do GitHub e elas serão automaticamente otimizadas e servidas globalmente a partir da rede edge da Cloudflare: mais de 300 data centers, mais de 100 países, latência inferior a 100 ms.

Diferentemente dos CDNs de imagens tradicionais que exigem dashboards, APIs de upload ou integrações com SDK, o CloudCDN usa o fluxo de trabalho que os desenvolvedores já conhecem: `git push`.

## Como funciona
1. **Push:** adicione imagens ao repositório do GitHub e faça commit com uma chave assinada.
2. **Otimização:** o GitHub Actions comprime automaticamente as imagens e gera variantes WebP (qualidade 80, ~60% menores) e AVIF (qualidade 65, ~70% menores).
3. **Deploy:** os arquivos alterados são enviados ao Cloudflare Pages via deploy incremental (deduplicação por hash de conteúdo: apenas arquivos novos ou modificados são transferidos).
4. **Entrega:** os ativos são servidos com cabeçalhos de cache imutáveis (`max-age=31536000`) a partir do ponto edge mais próximo entre os mais de 300 disponíveis.

## Stack tecnológica
- **Rede edge:** Cloudflare Pages em mais de 300 PoPs globais. 95% da população mundial está a menos de 50 ms de um data center da Cloudflare.
- **Formatos de imagem:** PNG (original sem perdas), WebP (com perdas, qualidade 80), AVIF (com perdas, qualidade 65), SVG (sem processamento), ICO (sem processamento).
- **Negociação de formato:** o plano Pro entrega o formato ideal com base no cabeçalho `Accept` do navegador (AVIF > WebP > original).
- **Cache:** cache imutável no edge e no navegador com max-age de um ano. Invalidação de cache por meio de mudança de nome ou caminho do arquivo.
- **CI/CD:** GitHub Actions para compressão (Sharp), geração do manifesto e deploy no Cloudflare Pages (Wrangler).
- **Segurança:** commits assinados com SSH Ed25519 são obrigatórios. Proteção da branch `main`. Tokens de API criptografados via GitHub Secrets.
- **Concierge IA:** Cloudflare Workers AI (Llama 3.1) + Vectorize RAG para busca inteligente na documentação a partir da página inicial.

## Desempenho
- **TTFB:** mediana inferior a 50 ms na América do Norte/Europa, inferior a 100 ms globalmente (cache hit no edge da Cloudflare).
- **Taxa de acerto de cache:** superior a 95% para ativos em produção (cache imutável).
- **Velocidade de deploy:** uploads incrementais — apenas arquivos modificados são transferidos. Deploy típico: 5 a 30 segundos.
- **Compressão:** WebP economiza cerca de 60% em comparação ao PNG. AVIF economiza cerca de 70% em comparação ao PNG. Ambos são gerados automaticamente.

## Organização dos ativos
```
project-name/
  images/
    banners/    — Gráficos em formato wide (1200x630 recomendado)
    icons/      — Multi-resolução (de 16x16 a 512x512, com @2x/@3x)
    logos/      — Logos e marcas
    github/     — Imagens de visualização social
    titles/     — Gráficos de título e cabeçalhos
  README.md     — Descrição opcional do projeto
```

## Métricas-chave
- **Mais de 1.400 ativos otimizados** distribuídos em 54 zonas de inquilinos.
- **Uma única fonte por imagem** — as derivadas são geradas sob demanda via `/api/transform`.
- **Mais de 300 PoPs edge** em mais de 100 países.
- **TTFB global inferior a 100 ms** em cache hits no edge.
- **Sem etapa de build** — sem `npm install`, sem webpack, sem framework necessário.

## Quem usa o CloudCDN?
O CloudCDN serve ativos para:
- **Projetos open source:** logos, banners, ícones e gráficos de documentação.
- **Ferramentas para desenvolvedores:** branding de desenvolvedores Rust, Python e IA (rustdev, pythondev, llamadev).
- **Plataformas fintech:** bibliotecas de ativos para banking e computação quântica.
- **Aplicativos de áudio:** visualizações de forma de onda e componentes de UI.
- **Geradores de sites estáticos:** Shokunin, Kaishi e outros frameworks SSG.

## Por que não [concorrente]?

| vs Cloudinary | vs Imgix | vs Bunny CDN |
|---|---|---|
| Sem complexidade de sistema de créditos | Sem cobrança baseada em créditos | Suporte a AVIF incluído |
| Fluxo de trabalho nativo do Git | Fluxo de trabalho nativo do Git | Fluxo de trabalho nativo do Git |
| Plano gratuito, sem cartão de crédito | Plano gratuito disponível | Sem expiração de teste |
| Concierge IA integrado | Apenas documentação padrão | Apenas documentação padrão |

## Código aberto
A infraestrutura do CDN é open source sob a licença MIT. Repositório: github.com/sebastienrousseau/cloudcdn.pro.

## Contato
- **Suporte:** support@cloudcdn.pro
- **Vendas:** sales@cloudcdn.pro
- **GitHub:** github.com/sebastienrousseau/cloudcdn.pro
- **Status:** cloudcdn.pro (a página inicial exibe o status operacional)
