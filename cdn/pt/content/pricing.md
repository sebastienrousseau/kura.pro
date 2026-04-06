# Preços do CloudCDN (2026)

## Comparação de planos

| Recurso | Free | Pro (US$ 29/mês) | Enterprise (Personalizado) |
|---------|------|------------------|---------------------------|
| Banda | 10 GB/mês | 100 GB/mês | Ilimitada |
| Armazenamento | Arquivos ilimitados | Arquivos ilimitados | Armazenamento dedicado |
| Formatos de imagem | Conversão automática WebP + AVIF | WebP + AVIF + controles de qualidade | Suíte completa + lote |
| Transformações de imagem | Nenhuma | Resize, crop, format via URL | API completa + processamento em lote |
| Domínios personalizados | Não incluídos | Até 5 (SSL automático) | Ilimitados |
| Analytics | Nenhum | Painel básico | Tempo real por ativo/região |
| Suporte | Comunidade / GitHub Issues | E-mail prioritário (SLA 24h) | Gerente dedicado + Slack |
| SLA | Best-effort (~99,9%) | Garantia de 99,9% de uptime | 99,99% + créditos financeiros |
| Commits assinados | Obrigatórios | Obrigatórios | Obrigatórios |
| SSO/SAML | Não | Não | Sim |
| Logs de auditoria | Não | Não | Sim |

## Nível gratuito (open source)
- **Público-alvo:** projetos pessoais, software open source, hobbyistas.
- **Custo:** US$ 0/mês — gratuito para sempre, sem cartão de crédito.
- **Banda:** 10 GB/mês. Os ativos param de ser servidos via CDN se excedido (os arquivos permanecem no git).
- **Ativos:** arquivos estáticos ilimitados (PNG, WebP, AVIF, SVG, ICO).
- **Otimização automática:** todo PNG/JPEG enviado é automaticamente convertido para WebP (qualidade 80) e AVIF (qualidade 65).
- **Entrega:** TTFB abaixo de 100ms dos mais de 300 PoPs de edge da Cloudflare. Cache imutável (max-age de 1 ano).
- **Limitações:** sem domínios personalizados, sem API de transformação de imagens, sem painel de analytics.

## Nível Pro
- **Público-alvo:** projetos comerciais, startups, sites de alto tráfego.
- **Custo:** US$ 29/mês (ou US$ 278/ano — economize 20%).
- **Banda:** 100 GB/mês incluídos. Excedente: US$ 0,05/GB cobrado no fim do ciclo.
- **API de transformação de imagens:** redimensione, recorte e converta em tempo real via parâmetros de URL:
  ```
  https://cloudcdn.pro/projeto/image.png?w=800&h=600&fit=cover&format=auto&q=80
  ```
- **Negociação de formato:** entrega automática AVIF/WebP com base no cabeçalho `Accept` do navegador.
- **Domínios personalizados:** até 5 domínios com provisionamento SSL automático.
- **Suporte prioritário:** suporte por e-mail com garantia de resposta em 24 horas.
- **SLA:** 99,9% de uptime. Em caso de violação, 10% de crédito de serviço por cada 0,1% abaixo do limite.
- **Analytics:** banda, contagem de requisições, taxa de hit do cache, distribuição de formatos.
- **Teste gratuito de 14 dias** com acesso completo. Sem cartão de crédito.

## Nível Enterprise
- **Público-alvo:** plataformas globais, empresas de mídia, e-commerce em escala.
- **Custo:** preços personalizados — entre em contato com sales@cloudcdn.pro.
- **Banda:** ilimitada com alocação de edge dedicada.
- **Suíte de API completa:** todas as transformações Pro mais processamento em lote, notificações via webhook e uploads programáticos.
- **Domínios personalizados:** ilimitados com SSL wildcard.
- **Suporte dedicado:** gerente de conta nomeado, canal Slack privado, SLA de resposta de 1 hora.
- **SLA:** 99,99% de uptime. Créditos financeiros: 25% para <99,99%, 50% para <99,9%, 100% para <99,0%.
- **Segurança:** SSO/SAML, logs de auditoria com retenção de 12 meses, lista de IPs permitidos.
- **Analytics:** painel em tempo real com detalhamento por ativo, região e formato.
- **Conformidade:** DPA GDPR disponível, opções de residência de dados (UE/EUA).

## Como nos comparamos

| Provedor | Plano gratuito | Plano pago inicial | API de transformação |
|----------|----------------|--------------------|---------------------|
| **CloudCDN** | 10 GB/mês | US$ 29/mês (100 GB) | Sim (Pro+) |
| Cloudflare Images | 5K transformações/mês | Pay-as-you-go | Sim |
| ImageKit | 25 GB/mês | US$ 9/mês | Sim |
| Cloudinary | ~5K transformações/mês | US$ 89/mês | Sim (300+ parâmetros) |
| Bunny CDN | Teste de 14 dias | US$ 9,50/mês fixo | Limitado |
| Imgix | Nenhum | US$ 25/mês | Sim |

**Nossa vantagem:** zero etapa de build, workflow Git-nativo, conversão automática de formato no push, assistente de documentação com IA e a rede de edge de 300+ PoPs da Cloudflare — tudo incluído desde o nível gratuito.

## Cobrança
- Cobrança mensal por padrão. A cobrança anual economiza 20%.
- Nível gratuito: sem cartão de crédito, sem expiração de teste.
- Teste Pro: 14 dias, acesso total aos recursos, sem cartão de crédito.
- Excedente: cobrado no fim do ciclo, nunca interrupção de serviço no meio do ciclo.
- Cancele a qualquer momento. Sem contratos de longo prazo. Os dados permanecem acessíveis por 30 dias após o cancelamento.

## Política de uso justo
O CloudCDN foi projetado para entregar ativos estáticos: imagens, ícones, fontes e documentos. Não é destinado a streaming de vídeo (arquivos >25 MB), distribuição de binários de aplicativos ou hospedagem de arquivos. Contas que excederem o uso justo serão contatadas para discutir um plano apropriado. Nunca suspenderemos sem aviso.
